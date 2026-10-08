import { randomInt, randomUUID } from "node:crypto";
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

const resendOtp = async (payload: { email: string }) => {
	const email = payload.email.trim().toLowerCase();
	const otpExpiresInSeconds = 10 * 60;
	const response = { otpExpiresInSeconds };
	const user = await prisma.user.findUnique({
		where: { email },
		select: {
			id: true,
			name: true,
			emailVerified: true,
			status: true,
			isDeleted: true,
		},
	});
	// Keep the response generic for unknown, verified and inactive accounts.
	if (
		!user ||
		user.emailVerified ||
		user.status !== UserStatus.ACTIVE ||
		user.isDeleted
	)
		return response;

	const client = await getRedis();
	const otpKey = `homi:otp:EMAIL_VERIFICATION:${user.id}`;
	const cooldownKey = `homi:otp:cooldown:${user.id}`;
	const requestId = randomUUID();
	let locked: string | null;
	try {
		locked = await client.set(cooldownKey, requestId, { NX: true, EX: 60 });
	} catch {
		throw new AppError(503, "Verification storage is unavailable");
	}
	if (!locked)
		throw new AppError(
			429,
			"Please wait 60 seconds before requesting another code",
		);

	const otp = randomInt(100000, 1000000).toString();
	let hashedOtp: string | undefined;
	try {
		hashedOtp = await bcrypt.hash(otp, 12);
		// Replacing the record immediately invalidates the previous code and resets attempts.
		try {
			await client.set(
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
			throw new AppError(503, "Verification storage is unavailable");
		}
		await sendVerificationEmail(email, {
			name: user.name,
			otp,
			expiresInSeconds: otpExpiresInSeconds,
		});
		return response;
	} catch (error) {
		// Delete only this request's code/cooldown, preserving any newer request's records.
		try {
			await client.eval(
				`
        local value = redis.call('GET', KEYS[1])
        if value and cjson.decode(value).hash == ARGV[1] then redis.call('DEL', KEYS[1]) end
        if redis.call('GET', KEYS[2]) == ARGV[2] then redis.call('DEL', KEYS[2]) end
        return 1
      `,
				{
					keys: [otpKey, cooldownKey],
					arguments: [hashedOtp || "", requestId],
				},
			);
		} catch {
			console.error("Resend OTP cleanup failed; records will expire");
		}
		throw error;
	}
};

const verifyEmail = async (payload: { email: string; otp: string }) => {
	const email = payload.email.trim().toLowerCase();
	const user = await prisma.user.findUnique({
		where: { email },
		select: {
			id: true,
			name: true,
			email: true,
			role: true,
			emailVerified: true,
			status: true,
			isDeleted: true,
		},
	});
	if (!user) throw new AppError(400, "Invalid or expired verification code");
	if (user.emailVerified) throw new AppError(409, "Email is already verified");
	if (user.status !== UserStatus.ACTIVE || user.isDeleted)
		throw new AppError(403, "Account is inactive");

	const client = await getRedis();
	const key = `homi:otp:EMAIL_VERIFICATION:${user.id}`;
	// Redis atomically counts attempts, including concurrent requests, while keeping the expiry.
	let record: string;
	try {
		record = String(
			await client.eval(
				`
      local value = redis.call('GET', KEYS[1])
      if not value then return 'EXPIRED' end
      local otp = cjson.decode(value)
      if otp.purpose ~= 'EMAIL_VERIFICATION' or otp.userId ~= ARGV[1] then return 'EXPIRED' end
      if (otp.attempts or 0) >= 5 then return 'LIMIT' end
      otp.attempts = (otp.attempts or 0) + 1
      local updated = cjson.encode(otp)
      redis.call('SET', KEYS[1], updated, 'KEEPTTL')
      return updated
    `,
				{ keys: [key], arguments: [user.id] },
			),
		);
	} catch {
		throw new AppError(503, "Verification storage is unavailable");
	}
	if (record === "LIMIT")
		throw new AppError(429, "Too many OTP attempts. Request a new code.");
	if (record === "EXPIRED")
		throw new AppError(400, "Invalid or expired verification code");
	const storedOtp = JSON.parse(record) as { hash: string };
	if (!(await bcrypt.compare(payload.otp, storedOtp.hash)))
		throw new AppError(400, "Invalid or expired verification code");

	// The conditional database update ensures only one concurrent verification succeeds.
	await prisma.$transaction(
		async (transaction) => {
			const updated = await transaction.user.updateMany({
				where: {
					id: user.id,
					emailVerified: false,
					status: UserStatus.ACTIVE,
					isDeleted: false,
				},
				data: { emailVerified: true },
			});
			if (updated.count !== 1)
				throw new AppError(409, "Email verification is no longer available");
			let consumed: number;
			try {
				consumed = Number(
					await client.eval(
						`
        local value = redis.call('GET', KEYS[1])
        if not value then return 0 end
        local otp = cjson.decode(value)
        if otp.hash ~= ARGV[1] or otp.userId ~= ARGV[2] or otp.purpose ~= 'EMAIL_VERIFICATION' then return 0 end
        return redis.call('DEL', KEYS[1])
      `,
						{ keys: [key], arguments: [storedOtp.hash, user.id] },
					),
				);
			} catch {
				throw new AppError(503, "Verification storage is unavailable");
			}
			if (consumed !== 1)
				throw new AppError(400, "Invalid or expired verification code");
		},
		{ timeout: 10000 },
	);
	return {
		user: {
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			emailVerified: true,
		},
	};
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
	resendOtp,
	verifyEmail,
	registerUser,
	loginUser,
	getMe,
	refreshToken,
};
