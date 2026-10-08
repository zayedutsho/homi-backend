import "dotenv/config";
import { seedAdmin } from "../src/app/utils/seed";
import { prisma } from "../src/app/lib/prisma";

try {
	if (!process.env.ADMIN_NAME || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
		console.error("Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in .env.");
		process.exitCode = 1;
	} else {
		await seedAdmin();
		console.info("Admin seed completed. Existing non-admin accounts are never promoted.");
	}
} catch {
	console.error("Admin seed failed. Check database connectivity and use an email that is not registered as a tenant or owner.");
	process.exitCode = 1;
} finally {
	await prisma.$disconnect();
}
