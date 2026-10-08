import { createClient } from "redis";
import config from "../config";
import { AppError } from "../utils/AppError";

// rediss:// enables TLS. REDIS_TLS=true also enables it for a redis:// URL.
const redisUrl = config.redis_url ? new URL(config.redis_url) : undefined;
if (redisUrl && config.redis_tls) redisUrl.protocol = "rediss:";

export const redis = createClient({
	url: redisUrl?.toString(),
	username: config.redis_url ? undefined : config.redis_user,
	password: config.redis_url ? undefined : config.redis_password,
	socket: {
		...(config.redis_url
			? {}
			: {
					host: config.redis_host,
					port: Number(config.redis_port || 6379),
					...(config.redis_tls ? { tls: true as const } : {}),
				}),
		connectTimeout: 5000,
		reconnectStrategy: false,
	},
	disableOfflineQueue: true,
});
redis.on("error", () => console.error("Redis connection error"));
let connecting: Promise<unknown> | undefined;

export const getRedis = async () => {
	if (!config.redis_url && !config.redis_host) {
		throw new AppError(503, "Redis is not configured");
	}
	try {
		if (!redis.isReady) {
			connecting ??= redis.connect().finally(() => {
				connecting = undefined;
			});
			await connecting;
		}
		return redis;
	} catch {
		throw new AppError(
			503,
			"Verification storage is unavailable. Please try again later.",
		);
	}
};
