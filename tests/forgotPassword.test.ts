import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after, mock } from "node:test";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import app from "../src/app";
import { prisma } from "../src/app/lib/prisma";
import { getRedis, redis } from "../src/app/lib/redis";
import { AuthService } from "../src/app/module/auth/auth.service";
import { forgotPasswordSchema } from "../src/app/module/auth/auth.validation";

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
	const key = `homi:otp:PASSWORD_RESET:${id}`;
	const cooldown = `homi:otp:reset:cooldown:${id}`;
	const user = {
		id,
		name: "Test",
		emailVerified: true,
		password: "stored-credential-hash",
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
			purpose: "PASSWORD_RESET",
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
		requestReset: () => AuthService.forgotPassword({ email: "test@example.com" }),
	};
}

test("requestReset replaces the hash, resets attempts and expiry, sends branded email and limits retries", async (t) => {
	const f = await fixture(t);
	assert.equal((await f.requestReset()).otpExpiresInSeconds, 600);
	const record = JSON.parse((await f.client.get(f.key)) || "{}");
	assert.notEqual(record.hash, f.oldHash);
	assert.equal(record.attempts, 0);
	assert.equal(record.purpose, "PASSWORD_RESET");
	assert.equal(record.userId, f.user.id);
	assert.equal(record.hash.includes(f.otp()), false);
	assert.ok(await bcrypt.compare(f.otp(), record.hash));
	assert.ok((await f.client.ttl(f.key)) > 580);
	assert.equal((await f.requestReset()).otpExpiresInSeconds, 600);
	assert.equal(f.emails(), 1);
});

test("failed email removes this request's code and cooldown", async (t) => {
	const f = await fixture(t, true);
	assert.equal((await f.requestReset()).otpExpiresInSeconds, 600);
	assert.equal(await f.client.exists(f.key), 0);
	assert.equal(await f.client.exists(f.cooldown), 0);
});

test("unverified users get generic success without an email", async (t) => {
	const f = await fixture(t);
	f.user.emailVerified = false;
	assert.equal((await f.requestReset()).otpExpiresInSeconds, 600);
	assert.equal(f.emails(), 0);
	assert.equal(await f.client.exists(f.cooldown), 0);
});

test("requestReset validates and normalizes email", () => {
	assert.equal(
		forgotPasswordSchema.parse({ email: " TEST@EXAMPLE.COM " }).email,
		"test@example.com",
	);
	assert.equal(forgotPasswordSchema.safeParse({ email: "invalid" }).success, false);
});

for (const state of ["missing", "google-only", "blocked", "deleted"]) {
	test(`${state} accounts get the same response without email or reset record`, async (t) => {
		const f = await fixture(t);
		if (state === "missing") prisma.user.findUnique = (async () => null) as typeof prisma.user.findUnique;
		if (state === "google-only") f.user.password = "";
		if (state === "blocked") f.user.status = "BLOCKED";
		if (state === "deleted") f.user.isDeleted = true;
		assert.deepEqual(await f.requestReset(), { otpExpiresInSeconds: 600 });
		assert.equal(f.emails(), 0);
		assert.equal(await f.client.exists(f.cooldown), 0);
	});
}

test("forgot-password HTTP uses generic response and Zod errors without login cookies", async (t) => {
	const f = await fixture(t);
	const evalMock = mock.method(redis, "eval", async () => 1);
	const server = app.listen(0, "127.0.0.1");
	await new Promise<void>(resolve => server.once("listening", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}/api/v1/auth/forgot-password`;
	try {
		const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "test@example.com" }) });
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.message, "If this account is eligible for password recovery, a code has been sent");
		assert.deepEqual(body.data, { otpExpiresInSeconds: 600 });
		assert.equal(response.headers.getSetCookie().length, 0);
		assert.equal(f.emails(), 1);
		const invalid = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "invalid" }) });
		assert.equal(invalid.status, 400);
		assert.equal((await invalid.json()).message, "Validation failed");
	} finally {
		evalMock.mock.restore();
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});
