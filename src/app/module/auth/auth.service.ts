import { randomInt } from "node:crypto";
import { getRedis } from "../../lib/redis";
import { sendVerificationEmail } from "../../lib/email";
import bcrypt from "bcryptjs";
import { AppError } from "../../utils/AppError";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import { Role, UserStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { jwtUtils } from "../../utils/jwt";
import type {
	ILoginUserPayload,
	IRegisterUserPayload,
	IRequestUser,
} from "./auth.interface";

const registerUser = async (payload: IRegisterUserPayload) => {
	const { name, password } = payload;
	const email = payload.email.trim().toLowerCase();
	const otpExpiresInSeconds = 10 * 60;

	// 1. Check the password hashing configuration and duplicate email.
	const saltRounds = Number(config.bcrypt_salt_rounds || 12);
	if (!Number.isInteger(saltRounds) || saltRounds < 10 || saltRounds > 15) {
		throw new AppError(
			503,
			"BCRYPT_SALT_ROUNDS must be an integer between 10 and 15",
		);
	}
	const existingUser = await prisma.user.findUnique({
		where: { email },
		select: { id: true },
	});
	if (existingUser) {
		throw new AppError(409, "User with this email already exists");
	}
	// 2. Generate the OTP and hash both secrets before saving anything.
	const redisClient = await getRedis();
	const otp = randomInt(100000, 1000000).toString();
	const hashedPassword = await bcrypt.hash(password, saltRounds);
	const hashedOtp = await bcrypt.hash(otp, 12);
	// Keep the key so we can remove the OTP if registration fails.
	let otpKey: string | undefined;
	try {
		// 3. Create the user and tenant profile together.
		const user = await prisma.$transaction(
			async (transaction) => {
				const user = await transaction.user.create({
					data: {
						name,
						email,
						password: hashedPassword,
						role: Role.TENANT,
						status: UserStatus.ACTIVE,
						emailVerified: false,
						tenant: { create: { name, email } },
					},
					select: {
						id: true,
						name: true,
						email: true,
						role: true,
						emailVerified: true,
					},
				});
				// 4. Save only the OTP hash in Redis, with a 10-minute expiry.
				otpKey = `homi:otp:EMAIL_VERIFICATION:${user.id}`;
				try {
					await redisClient.set(
						otpKey,
						JSON.stringify({
							userId: user.id,
							purpose: "EMAIL_VERIFICATION",
							hash: hashedOtp,
							attempts: 0,
							createdAt: new Date().toISOString(),
							expiresAt: new Date(
								Date.now() + otpExpiresInSeconds * 1000,
							).toISOString(),
						}),
						{ EX: otpExpiresInSeconds },
					);
				} catch {
					throw new AppError(
						503,
						"Verification storage is unavailable. Please try again later.",
					);
				}
				// 5. Send the email before committing the database transaction.
				await sendVerificationEmail(email, {
					name,
					otp,
					expiresInSeconds: otpExpiresInSeconds,
				});
				return user;
			},
			{ maxWait: 5000, timeout: 30000 },
		);

		// 6. Return safe user details. Login tokens require email verification.
		return { user, verificationRequired: true, otpExpiresInSeconds };
	} catch (error) {
		// Prisma rolls back the user/profile; we also clean up the Redis OTP.
		if (otpKey) {
			try {
				await redisClient.del(otpKey);
			} catch {
				console.error("Registration OTP cleanup failed; key will expire");
			}
		}
		throw error;
	}
};

const loginUser = async (payload: ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new Error("User not found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User is blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	const isPasswordMatched = await bcrypt.compare(password, user.password);

	if (!isPasswordMatched) {
		throw new Error("Invalid credentials");
	}

	if (!user.emailVerified) {
		throw new AppError(403, "Please verify your email before logging in");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			tenant: true,
		},
		omit: {
			password: true,
		},
	});

	if (!isUserExists) {
		throw new Error("User not found");
	}

	return isUserExists;
};

const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new Error(
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new Error("User is inactive or not found");
	}

	if (!user.emailVerified) {
		throw new AppError(403, "Please verify your email before logging in");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

export const AuthService = {
	registerUser,
	loginUser,
	getMe,
	refreshToken,
};
