import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/app/lib/prisma";
import { getRedis, redis } from "../src/app/lib/redis";
import { AuthService } from "../src/app/module/auth/auth.service";
import { verifyEmailSchema } from "../src/app/module/auth/auth.validation";

// Real Redis with isolated random keys; PostgreSQL writes are explicitly stubbed.
after(() => {
	if (redis.isOpen) redis.destroy();
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
	const client = await getRedis();
	const id = randomUUID();
	const key = `homi:otp:EMAIL_VERIFICATION:${id}`;
	const otp = randomInt(100000, 1000000).toString();
	const user = {
		id,
		name: "Test",
		email: "test@example.com",
		role: "TENANT",
		emailVerified: false,
		status: "ACTIVE",
		isDeleted: false,
	};
	const find = prisma.user.findUnique;
	const transaction = prisma.$transaction;
	prisma.user.findUnique = (async () => ({ ...user })) as typeof find;
	prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) =>
		run({
			user: {
				updateMany: async () => {
					if (user.emailVerified) return { count: 0 };
					user.emailVerified = true;
					return { count: 1 };
				},
			},
		})) as typeof transaction;
	t.after(async () => {
		prisma.user.findUnique = find;
		prisma.$transaction = transaction;
		await client.del(key);
	});
	await client.set(
		key,
		JSON.stringify({
			userId: id,
			purpose: "EMAIL_VERIFICATION",
			hash: await bcrypt.hash(otp, 10),
			attempts: 0,
		}),
		{ EX: 60 },
	);
	return {
		client,
		key,
		otp,
		user,
		verify: () => AuthService.verifyEmail({ email: user.email, otp }),
	};
}

test("valid code verifies, consumes the Redis key and rejects replay", async (t) => {
	const f = await fixture(t);
	const result = await f.verify();
	assert.equal(result.user.emailVerified, true);
	assert.equal(await f.client.exists(f.key), 0);
	assert.ok(!("accessToken" in result));
	await assert.rejects(f.verify(), { statusCode: 409 });
});

test("five incorrect attempts preserve TTL and block the correct code", async (t) => {
	const f = await fixture(t);
	const wrongOtp = f.otp === "000000" ? "111111" : "000000";
	for (let i = 0; i < 5; i++)
		await assert.rejects(
			AuthService.verifyEmail({ email: f.user.email, otp: wrongOtp }),
			{ statusCode: 400 },
		);
	await assert.rejects(f.verify(), { statusCode: 429 });
	assert.equal(f.user.emailVerified, false);
	const ttl = await f.client.ttl(f.key);
	assert.ok(ttl > 0 && ttl <= 60);
});

test("expired code cannot verify a user", async (t) => {
	const f = await fixture(t);
	await f.client.del(f.key);
	await assert.rejects(f.verify(), { statusCode: 400 });
	assert.equal(f.user.emailVerified, false);
});

test("concurrent verification allows only one success", async (t) => {
	const f = await fixture(t);
	const results = await Promise.allSettled([f.verify(), f.verify()]);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(await f.client.exists(f.key), 0);
});

test("verification validation rejects malformed codes and normalizes email", () => {
	const otp = randomInt(100000, 1000000).toString();
	assert.equal(
		verifyEmailSchema.parse({ email: " TEST@EXAMPLE.COM ", otp }).email,
		"test@example.com",
	);
	assert.equal(
		verifyEmailSchema.safeParse({ email: "test@example.com", otp: "short" })
			.success,
		false,
	);
});
