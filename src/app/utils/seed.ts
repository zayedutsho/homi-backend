import bcrypt from "bcryptjs";
import { Role } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";

export const seedAdmin = async () => {
	const {
		ADMIN_NAME: name,
		ADMIN_EMAIL: rawEmail,
		ADMIN_PASSWORD: password,
	} = process.env;
	if (!name || !rawEmail || !password || password.length < 12) {
		throw new Error(
			"Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters)",
		);
	}
	const email = rawEmail.trim().toLowerCase();
	const existing = await prisma.user.findUnique({
		where: { email },
		select: { role: true },
	});
	if (existing) {
		if (existing.role !== Role.ADMIN)
			throw new Error(
				"Existing account is not an admin; seed will not promote it",
			);
		return;
	}
	await prisma.user.create({
		data: {
			name,
			email,
			password: await bcrypt.hash(password, 12),
			role: Role.ADMIN,
			emailVerified: true,
		},
	});
};
