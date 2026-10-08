import { getRedis, redis } from "../src/app/lib/redis";
import { createEmailTransporter } from "../src/app/lib/email";
import { prisma } from "../src/app/lib/prisma";

// Print only connection status, never connection URLs or raw errors.
let failed = false;
await Promise.all([
	(async () => {
		try {
			const client = await getRedis();
			if ((await client.ping()) !== "PONG")
				throw new Error("Unexpected ping response");
			console.log("Redis Cloud PING: PONG");
		} catch {
			failed = true;
			console.log("Redis Cloud PING: FAILED");
		} finally {
			if (redis.isOpen) redis.destroy();
		}
	})(),
	(async () => {
		let transporter: ReturnType<typeof createEmailTransporter> | undefined;
		try {
			transporter = createEmailTransporter();
			await transporter.verify();
			console.log("Gmail SMTP authentication: PASSED (no email sent)");
		} catch {
			failed = true;
			console.log("Gmail SMTP authentication: FAILED");
		} finally {
			transporter?.close();
		}
	})(),
	(async () => {
		try {
			await prisma.user.findFirst({ select: { id: true } });
			await prisma.tenant.findFirst({ select: { id: true } });
			console.log("PostgreSQL registration tables: READY");
		} catch {
			failed = true;
			console.log(
				"PostgreSQL registration tables: FAILED (check connection/migrations)",
			);
		} finally {
			await prisma.$disconnect();
		}
	})(),
]);
process.exitCode = failed ? 1 : 0;
