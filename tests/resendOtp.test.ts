import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after, mock } from "node:test";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { prisma } from "../src/app/lib/prisma";
import { getRedis, redis } from "../src/app/lib/redis";
import { AuthService } from "../src/app/module/auth/auth.service";
import { resendOtpSchema } from "../src/app/module/auth/auth.validation";

after(() => {
	if (redis.isOpen) redis.destroy();
});

// Real Redis, isolated random keys, stubbed database reads and SMTP delivery.
async function fixture(
	t: { after: (fn: () => Promise<void>) => void },
	failEmail = false,
) {
	const client = await getRedis();
	const id = randomUUID();
	const key = `homi:otp:EMAIL_VERIFICATION:${id}`;
	const cooldown = `homi:otp:cooldown:${id}`;
	const user = {
		id,
		name: "Test",
		emailVerified: false,
		status: "ACTIVE",
		isDeleted: false,
	};
	const find = prisma.user.findUnique;
	prisma.user.findUnique = (async () => user) as typeof find;
	let emails = 0;
	let deliveredOtp = "";
	const transportMock = mock.method(nodemailer, "createTransport", () => ({
		sendMail: async (message: { text: string; html: string; to: string }) => {
			if (failEmail) throw new Error("Delivery rejected");
			emails++;
			deliveredOtp = message.text.match(/code is (\d{6})/)?.[1] || "";
			assert.match(deliveredOtp, /^\d{6}$/);
			assert.ok(message.html.includes(deliveredOtp));
			return { accepted: [message.to], rejected: [] };
		},
		close: () => {},
	}));
	t.after(async () => {
		prisma.user.findUnique = find;
		transportMock.mock.restore();
		await client.del([key, cooldown]);
	});
	const oldHash = await bcrypt.hash(randomInt(100000, 1000000).toString(), 10);
	await client.set(
		key,
		JSON.stringify({
			userId: id,
			purpose: "EMAIL_VERIFICATION",
			hash: oldHash,
			attempts: 4,
		}),
		{ EX: 60 },
	);
	return {
		client,
		key,
		cooldown,
		oldHash,
		user,
		emails: () => emails,
		otp: () => deliveredOtp,
		resend: () => AuthService.resendOtp({ email: "test@example.com" }),
	};
}

test("resend replaces the hash, resets attempts and expiry, sends branded email and limits retries", async (t) => {
	const f = await fixture(t);
	assert.equal((await f.resend()).otpExpiresInSeconds, 600);
	const record = JSON.parse((await f.client.get(f.key)) || "{}");
	assert.notEqual(record.hash, f.oldHash);
	assert.equal(record.attempts, 0);
	assert.ok(await bcrypt.compare(f.otp(), record.hash));
	assert.ok((await f.client.ttl(f.key)) > 580);
	await assert.rejects(f.resend(), { statusCode: 429 });
	assert.equal(f.emails(), 1);
});

test("failed email removes this request's code and cooldown", async (t) => {
	const f = await fixture(t, true);
	await assert.rejects(f.resend(), { statusCode: 503 });
	assert.equal(await f.client.exists(f.key), 0);
	assert.equal(await f.client.exists(f.cooldown), 0);
});

test("verified users get generic success without an email", async (t) => {
	const f = await fixture(t);
	f.user.emailVerified = true;
	assert.equal((await f.resend()).otpExpiresInSeconds, 600);
	assert.equal(f.emails(), 0);
	assert.equal(await f.client.exists(f.cooldown), 0);
});

test("resend validates and normalizes email", () => {
	assert.equal(
		resendOtpSchema.parse({ email: " TEST@EXAMPLE.COM " }).email,
		"test@example.com",
	);
	assert.equal(resendOtpSchema.safeParse({ email: "invalid" }).success, false);
});
