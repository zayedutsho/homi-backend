import {
	randomInt,
	randomUUID,
	randomBytes,
	createHash,
	timingSafeEqual,
} from "node:crypto";
import { getRedis } from "../../lib/redis";
import { sendVerificationEmail, sendResetPasswordEmail } from "../../lib/email";
import bcrypt from "bcryptjs";
import { googleClient } from "../../lib/google";
import type { TokenPayload } from "google-auth-library";
import { z } from "zod";
import type { Prisma, User } from "../../../generated/prisma/client";
import { AppError } from "../../utils/AppError";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
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

const forgotPassword = async (payload: { email: string }) => {
	const email = payload.email.trim().toLowerCase();
	const otpExpiresInSeconds = 10 * 60;
	const response = { otpExpiresInSeconds };
	const client = await getRedis();
	const user = await prisma.user.findUnique({
		where: { email },
		select: {
			id: true,
			name: true,
			password: true,
			emailVerified: true,
			status: true,
			isDeleted: true,
		},
	});
	// Keep the response generic for unknown, Google-only and ineligible accounts.
	if (
		!user?.emailVerified ||
		!user.password ||
		user.status !== UserStatus.ACTIVE ||
		user.isDeleted
	)
		return response;

	const otpKey = `homi:otp:PASSWORD_RESET:${user.id}`;
	const cooldownKey = `homi:otp:reset:cooldown:${user.id}`;
	const requestId = randomUUID();
	let locked: string | null;
	try {
		locked = await client.set(cooldownKey, requestId, { NX: true, EX: 60 });
	} catch {
		console.error("Password recovery cooldown storage failed");
		return response;
	}
	if (!locked) return response;

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
					purpose: "PASSWORD_RESET",
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
		await sendResetPasswordEmail(email, {
			name: user.name,
			otp,
			expiresInSeconds: otpExpiresInSeconds,
		});
		return response;
	} catch {
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
			console.error(
				"Password recovery OTP cleanup failed; records will expire",
			);
		}
		// Keep SMTP/storage failures generic too; never log the email, OTP or raw error.
		console.error("Password recovery delivery failed; request cleaned up");
		return response;
	}
};

const verifyResetOtp = async (payload: { email: string; otp: string }) => {
	const email = payload.email.trim().toLowerCase();
	const invalidCode = "Invalid or expired password reset code";
	const user = await prisma.user.findUnique({
		where: { email },
		select: {
			id: true,
			password: true,
			emailVerified: true,
			status: true,
			isDeleted: true,
		},
	});
	if (
		!user?.password ||
		!user.emailVerified ||
		user.status !== UserStatus.ACTIVE ||
		user.isDeleted
	)
		throw new AppError(400, invalidCode);
	const client = await getRedis();
	const otpKey = `homi:otp:PASSWORD_RESET:${user.id}`;
	let record: string;
	try {
		record = String(
			await client.eval(
				`
   local value = redis.call('GET', KEYS[1])
   if not value then return 'EXPIRED' end
   local otp = cjson.decode(value)
   if otp.purpose ~= 'PASSWORD_RESET' or otp.userId ~= ARGV[1] then return 'EXPIRED' end
   if (otp.attempts or 0) >= 5 then return 'LIMIT' end
   otp.attempts = (otp.attempts or 0) + 1
   local updated = cjson.encode(otp)
   redis.call('SET', KEYS[1], updated, 'KEEPTTL')
   return updated
  `,
				{ keys: [otpKey], arguments: [user.id] },
			),
		);
	} catch {
		throw new AppError(503, "Password recovery storage is unavailable");
	}
	if (record === "EXPIRED") throw new AppError(400, invalidCode);
	if (record === "LIMIT")
		throw new AppError(429, "Too many reset OTP attempts. Request a new code.");
	const stored = JSON.parse(record) as { hash: string };
	if (!(await bcrypt.compare(payload.otp, stored.hash)))
		throw new AppError(400, invalidCode);

	// Opaque reset tokens cannot be used as access or refresh JWTs.
	const resetToken = randomBytes(32).toString("hex");
	const tokenHash = createHash("sha256").update(resetToken).digest("hex");
	const resetTokenExpiresInSeconds = 300;
	const grantKey = `homi:password-reset:grant:${tokenHash}`;
	const grant = JSON.stringify({
		userId: user.id,
		purpose: "PASSWORD_RESET",
		passwordFingerprint: createHash("sha256")
			.update(user.password)
			.digest("hex"),
	});
	let consumed: number;
	try {
		// Grant creation and OTP consumption are atomic: one concurrent request wins.
		consumed = Number(
			await client.eval(
				`
   local value = redis.call('GET', KEYS[1])
   if not value then return 0 end
   local otp = cjson.decode(value)
   if otp.hash ~= ARGV[1] or otp.userId ~= ARGV[2] or otp.purpose ~= 'PASSWORD_RESET' then return 0 end
   if not redis.call('SET', KEYS[2], ARGV[3], 'NX', 'EX', ARGV[4]) then return 0 end
   redis.call('DEL', KEYS[1])
   return 1
  `,
				{
					keys: [otpKey, grantKey],
					arguments: [
						stored.hash,
						user.id,
						grant,
						String(resetTokenExpiresInSeconds),
					],
				},
			),
		);
	} catch {
		throw new AppError(503, "Password recovery storage is unavailable");
	}
	if (consumed !== 1) throw new AppError(400, invalidCode);
	return { resetToken, resetTokenExpiresInSeconds };
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

const validateTokenConfig = () => {
	const secrets = [config.jwt_access_secret, config.jwt_refresh_secret];
	if (
		secrets.some(
			(secret) =>
				!secret || secret.length < 32 || secret.startsWith("replace-"),
		) ||
		secrets[0] === secrets[1]
	) {
		throw new AppError(
			503,
			"Configure distinct JWT secrets of at least 32 characters",
		);
	}
	const tokenLifetime = /^[1-9]\d*(s|m|h|d)$/;
	if (
		!tokenLifetime.test(config.jwt_access_expires_in || "") ||
		!tokenLifetime.test(config.jwt_refresh_expires_in || "")
	) {
		throw new AppError(
			503,
			"Configure JWT lifetimes using seconds, minutes, hours or days, such as 15m and 7d",
		);
	}
};

const loginUser = async (payload: ILoginUserPayload) => {
	const email = payload.email.trim().toLowerCase();
	const user = await prisma.user.findUnique({
		where: { email },
		select: {
			id: true,
			name: true,
			email: true,
			password: true,
			role: true,
			emailVerified: true,
			status: true,
			isDeleted: true,
		},
	});
	// Use the same error for an unknown email and an incorrect password.
	if (
		!user?.password ||
		!(await bcrypt.compare(payload.password, user.password))
	) {
		throw new AppError(401, "Invalid email or password");
	}
	if (user.status !== UserStatus.ACTIVE || user.isDeleted)
		throw new AppError(403, "Account is inactive");
	if (!user.emailVerified)
		throw new AppError(403, "Please verify your email before logging in");

	return issueLoginTokens(user, prisma);
};

const issueLoginTokens = async (
	user: { id: string; name: string; email: string; role: Role },
	database: Pick<Prisma.TransactionClient, "refreshSession">,
) => {
	validateTokenConfig();
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};
	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions["expiresIn"],
	);
	const refreshToken = jwtUtils.createToken(
		{ ...jwtPayload, jti: randomUUID() },
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions["expiresIn"],
	);
	const refreshClaims = jwt.decode(refreshToken) as JwtPayload;
	await database.refreshSession.create({
		data: {
			id: refreshClaims.jti as string,
			userId: user.id,
			familyId: randomUUID(),
			tokenHash: createHash("sha256").update(refreshToken).digest("hex"),
			expiresAt: new Date((refreshClaims.exp as number) * 1000),
		},
	});
	return { accessToken, refreshToken };
};

const googleLogin = async (payload: { idToken: string }) => {
	if (!config.google_client_id)
		throw new AppError(503, "Google login is not configured");
	let identity: TokenPayload | undefined;
	try {
		// Checks Google's signature, configured audience, allowed issuers and expiry.
		const ticket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_client_id,
		});
		identity = ticket.getPayload();
	} catch {
		throw new AppError(401, "Invalid or expired Google ID token");
	}
	if (
		!identity ||
		identity.aud !== config.google_client_id ||
		!["accounts.google.com", "https://accounts.google.com"].includes(
			identity.iss,
		) ||
		!Number.isFinite(identity.exp) ||
		identity.exp <= Date.now() / 1000 ||
		typeof identity.sub !== "string" ||
		!identity.sub ||
		identity.sub.length > 255
	)
		throw new AppError(401, "Invalid or expired Google ID token");
	if (identity.email_verified !== true)
		throw new AppError(403, "Google email must be verified before logging in");
	const emailResult = z
		.string()
		.trim()
		.toLowerCase()
		.max(254)
		.pipe(z.email())
		.safeParse(identity.email);
	if (!emailResult.success)
		throw new AppError(401, "Google account must provide a valid email");
	const email = emailResult.data;
	const subject = identity.sub;
	const name =
		(typeof identity.name === "string" && identity.name.trim().slice(0, 100)) ||
		"Homi user";
	validateTokenConfig();
	const conflictMessage =
		"An account with this email already exists. Sign in with your password; Google linking requires a separate secure account-linking process.";
	try {
		return await prisma.$transaction(
			async (transaction) => {
				// Google's stable subject identifies returning users, even if their email changes.
				const account = await transaction.authAccount.findUnique({
					where: {
						provider_providerAccountId: {
							provider: "GOOGLE",
							providerAccountId: subject,
						},
					},
				});
				let user: User | null;
				if (account) {
					await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${account.userId} FOR UPDATE`;
					user = await transaction.user.findUnique({
						where: { id: account.userId },
					});
					if (
						!user ||
						user.isDeleted ||
						user.status !== UserStatus.ACTIVE ||
						!user.emailVerified
					)
						throw new AppError(
							403,
							"Account is inactive or ineligible for Google login",
						);
				} else {
					const existing = await transaction.user.findUnique({
						where: { email },
						select: { id: true },
					});
					if (existing) throw new AppError(409, conflictMessage);
					user = await transaction.user.create({
						data: {
							name,
							email,
							password: null,
							role: Role.TENANT,
							emailVerified: true,
							status: UserStatus.ACTIVE,
							tenant: { create: { name, email } },
							authAccounts: {
								create: { provider: "GOOGLE", providerAccountId: subject },
							},
						},
					});
				}
				// User, provider identity, tenant and hashed refresh session commit together.
				return issueLoginTokens(user, transaction);
			},
			{ maxWait: 10000, timeout: 15000 },
		);
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "P2002"
		)
			throw new AppError(
				409,
				"Google account or email already registered. Retry Google sign-in; if the conflict remains, sign in with your password and request secure account linking.",
			);
		throw error;
	}
};

const getMe = async (user: IRequestUser) => {
	const profile = await prisma.user.findUnique({
		where: { id: user.userId },
		select: {
			id: true,
			name: true,
			email: true,
			role: true,
			emailVerified: true,
			status: true,
			isDeleted: true,
			createdAt: true,
			updatedAt: true,
			tenant: {
				select: {
					id: true,
					contactNumber: true,
					address: true,
					isDeleted: true,
				},
			},
		},
	});
	if (!profile) throw new AppError(401, "User not found. Please log in again.");
	// Recheck eligibility in case account status changed after the middleware query.
	if (
		profile.status !== UserStatus.ACTIVE ||
		profile.isDeleted ||
		!profile.emailVerified
	) {
		throw new AppError(403, "Your account must be active and email verified.");
	}
	const { isDeleted, tenant, ...safeProfile } = profile;
	return {
		...safeProfile,
		tenant:
			tenant && !tenant.isDeleted
				? {
						id: tenant.id,
						contactNumber: tenant.contactNumber,
						address: tenant.address,
					}
				: null,
	};
};

const refreshToken = async (token: string) => {
	const verified = jwtUtils.verifyToken(token, config.jwt_refresh_secret);
	if (
		!verified.success ||
		!verified.data ||
		typeof verified.data === "string" ||
		typeof verified.data.userId !== "string" ||
		typeof verified.data.jti !== "string" ||
		typeof verified.data.exp !== "number"
	) {
		throw new AppError(401, "Invalid or expired refresh token");
	}
	validateTokenConfig();
	const claims = verified.data;
	const tokenHash = createHash("sha256").update(token).digest("hex");
	// Return failures from the transaction so replay revocation is committed, not rolled back.
	const result = await prisma.$transaction(
		async (transaction) => {
			// Serialize refreshes for this user, including replay checks against older sessions.
			await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${claims.userId} FOR UPDATE`;
			const session = await transaction.refreshSession.findUnique({
				where: { id: claims.jti },
				include: {
					user: {
						select: {
							id: true,
							name: true,
							email: true,
							role: true,
							status: true,
							isDeleted: true,
							emailVerified: true,
						},
					},
				},
			});
			if (
				!session ||
				session.userId !== claims.userId ||
				session.tokenHash.length !== tokenHash.length ||
				!timingSafeEqual(Buffer.from(session.tokenHash), Buffer.from(tokenHash))
			)
				return { error: "Invalid or expired refresh token", status: 401 };
			if (session.revokedAt) {
				await transaction.refreshSession.updateMany({
					where: { familyId: session.familyId, revokedAt: null },
					data: { revokedAt: new Date() },
				});
				return {
					error: "Refresh token already used. Please log in again.",
					status: 401,
				};
			}
			if (session.expiresAt <= new Date())
				return { error: "Invalid or expired refresh token", status: 401 };
			const user = session.user;
			if (
				user.status !== UserStatus.ACTIVE ||
				user.isDeleted ||
				!user.emailVerified
			) {
				await transaction.refreshSession.updateMany({
					where: { userId: user.id, revokedAt: null },
					data: { revokedAt: new Date() },
				});
				return {
					error: "Your account must be active and email verified",
					status: 403,
				};
			}
			// Only one concurrent request can consume this session.
			const consumed = await transaction.refreshSession.updateMany({
				where: {
					id: session.id,
					revokedAt: null,
					expiresAt: { gt: new Date() },
				},
				data: { revokedAt: new Date() },
			});
			if (consumed.count !== 1) {
				await transaction.refreshSession.updateMany({
					where: { familyId: session.familyId, revokedAt: null },
					data: { revokedAt: new Date() },
				});
				return {
					error: "Refresh token already used. Please log in again.",
					status: 401,
				};
			}
			const payload = {
				userId: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			};
			const accessToken = jwtUtils.createToken(
				payload,
				config.jwt_access_secret,
				config.jwt_access_expires_in as SignOptions["expiresIn"],
			);
			const sessionId = randomUUID();
			const refreshToken = jwtUtils.createToken(
				{ ...payload, jti: sessionId },
				config.jwt_refresh_secret,
				config.jwt_refresh_expires_in as SignOptions["expiresIn"],
			);
			const nextClaims = jwt.decode(refreshToken) as JwtPayload;
			await transaction.refreshSession.create({
				data: {
					id: sessionId,
					userId: user.id,
					familyId: session.familyId,
					tokenHash: createHash("sha256").update(refreshToken).digest("hex"),
					expiresAt: new Date((nextClaims.exp as number) * 1000),
				},
			});
			return { accessToken, refreshToken };
		},
		{ maxWait: 10000, timeout: 15000 },
	);
	if ("error" in result)
		throw new AppError(result.status as number, result.error as string);
	return result;
};

const logout = async (token?: string) => {
	if (!token) return;
	let claims: JwtPayload;
	try {
		// An expired but correctly signed token can still identify a session to revoke.
		const decoded = jwt.verify(token, config.jwt_refresh_secret, {
			algorithms: ["HS256"],
			ignoreExpiration: true,
		});
		if (
			typeof decoded === "string" ||
			typeof decoded.userId !== "string" ||
			typeof decoded.jti !== "string"
		)
			return;
		claims = decoded;
	} catch {
		return;
	}
	const tokenHash = createHash("sha256").update(token).digest("hex");
	await prisma.$transaction(
		async (transaction) => {
			await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${claims.userId} FOR UPDATE`;
			const session = await transaction.refreshSession.findUnique({
				where: { id: claims.jti },
			});
			if (
				!session ||
				session.userId !== claims.userId ||
				session.tokenHash.length !== tokenHash.length ||
				!timingSafeEqual(Buffer.from(session.tokenHash), Buffer.from(tokenHash))
			)
				return;
			await transaction.refreshSession.updateMany({
				where: { familyId: session.familyId, revokedAt: null },
				data: { revokedAt: new Date() },
			});
		},
		{ maxWait: 10000, timeout: 15000 },
	);
};

export const AuthService = {
	verifyResetOtp,
	forgotPassword,
	googleLogin,
	logout,
	resendOtp,
	verifyEmail,
	registerUser,
	loginUser,
	getMe,
	refreshToken,
};
