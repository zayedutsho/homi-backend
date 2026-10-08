import { createHash } from "node:crypto";
import { getRedis } from "../lib/redis";
import { AppError } from "../utils/AppError";
import { catchAsync } from "../utils/catchAsync";

export const registrationRateLimit = catchAsync(async (req, res, next) => {
	const client = await getRedis();
	const ipHash = createHash("sha256")
		.update(req.ip || "unknown")
		.digest("hex");
	let count: number;
	try {
		count = Number(
			await client.eval(
				"local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n",
				{ keys: [`homi:rate:register:${ipHash}`], arguments: ["900"] },
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
			"Too many registration attempts. Please try again later.",
		);
	}
	next();
});
