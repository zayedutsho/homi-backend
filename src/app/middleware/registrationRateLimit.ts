import { createHash } from "node:crypto";
import { getRedis } from "../lib/redis";
import { AppError } from "../utils/AppError";
import { catchAsync } from "../utils/catchAsync";

const otpRateLimit = (
	action:
		| "register"
		| "resend"
		| "login"
		| "refresh"
		| "logout"
		| "google"
		| "forgot",
) =>
	catchAsync(async (req, res, next) => {
		const client = await getRedis();
		const ipHash = createHash("sha256")
			.update(req.ip || "unknown")
			.digest("hex");
		let count: number;
		try {
			count = Number(
				await client.eval(
					"local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n",
					{ keys: [`homi:rate:${action}:${ipHash}`], arguments: ["900"] },
				),
			);
		} catch {
			throw new AppError(
				503,
				"Verification storage is unavailable. Please try again later.",
			);
		}
		if (count > 10) {
			res.setHeader("Retry-After", "900");
			throw new AppError(
				429,
				"Too many authentication requests. Please try again later.",
			);
		}
		next();
	});

export const registrationRateLimit = otpRateLimit("register");
export const resendOtpRateLimit = otpRateLimit("resend");

export const loginRateLimit = otpRateLimit("login");

export const refreshRateLimit = otpRateLimit("refresh");

export const logoutRateLimit = otpRateLimit("logout");
export const googleRateLimit = otpRateLimit("google");
export const forgotPasswordRateLimit = otpRateLimit("forgot");
