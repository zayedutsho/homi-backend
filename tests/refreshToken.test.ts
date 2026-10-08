import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after, mock } from "node:test";
import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { prisma } from "../src/app/lib/prisma";
import { AuthService } from "../src/app/module/auth/auth.service";
import { refreshTokenSchema } from "../src/app/module/auth/auth.validation";
import app from "../src/app";
import { redis } from "../src/app/lib/redis";

// Live PostgreSQL tests create only isolated random test users and delete them afterward.
after(async () => {
	await prisma.$disconnect();
});
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
	const email = `homi-refresh-test-${randomUUID()}@example.invalid`;
	const password = `Test-${randomUUID()}!`;
	const user = await prisma.user.create({
		data: {
			name: "Refresh integration test",
			email,
			password: await bcrypt.hash(password, 10),
			emailVerified: true,
		},
	});
	t.after(async () => {
		await prisma.user.delete({ where: { id: user.id } });
	});
	const tokens = await AuthService.loginUser({ email, password });
	const id = (jwt.decode(tokens.refreshToken) as JwtPayload).jti as string;
	return { user, tokens, id, password };
}

test("login stores only a hash; rotation creates a replacement; replay revokes its family", async (t) => {
	const f = await fixture(t);
	const old = await prisma.refreshSession.findUniqueOrThrow({
		where: { id: f.id },
	});
	assert.equal(
		old.tokenHash,
		createHash("sha256").update(f.tokens.refreshToken).digest("hex"),
	);
	assert.ok(old.tokenHash !== f.tokens.refreshToken);
	const next = await AuthService.refreshToken(f.tokens.refreshToken);
	assert.ok(next.refreshToken !== f.tokens.refreshToken);
	assert.ok(
		(await prisma.refreshSession.findUniqueOrThrow({ where: { id: f.id } }))
			.revokedAt,
	);
	const nextId = (jwt.decode(next.refreshToken) as JwtPayload).jti as string;
	assert.equal(
		(await prisma.refreshSession.findUniqueOrThrow({ where: { id: nextId } }))
			.familyId,
		old.familyId,
	);
	await assert.rejects(AuthService.refreshToken(f.tokens.refreshToken), {
		statusCode: 401,
	});
	await assert.rejects(AuthService.refreshToken(next.refreshToken), {
		statusCode: 401,
	});
});

test("concurrent refreshes have only one winner and reused tokens revoke the family", async (t) => {
	const f = await fixture(t);
	const outcomes = await Promise.allSettled([
		AuthService.refreshToken(f.tokens.refreshToken),
		AuthService.refreshToken(f.tokens.refreshToken),
	]);
	assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(
		await prisma.refreshSession.count({
			where: { userId: f.user.id, revokedAt: null },
		}),
		0,
	);
});

test("expired database sessions and banned users cannot refresh", async (t) => {
	const f = await fixture(t);
	await prisma.refreshSession.update({
		where: { id: f.id },
		data: { expiresAt: new Date(0) },
	});
	await assert.rejects(AuthService.refreshToken(f.tokens.refreshToken), {
		statusCode: 401,
	});
	await prisma.refreshSession.update({
		where: { id: f.id },
		data: { expiresAt: new Date(Date.now() + 60000) },
	});
	await prisma.user.update({
		where: { id: f.user.id },
		data: { status: "BLOCKED" },
	});
	await assert.rejects(AuthService.refreshToken(f.tokens.refreshToken), {
		statusCode: 403,
	});
	assert.ok(
		(await prisma.refreshSession.findUniqueOrThrow({ where: { id: f.id } }))
			.revokedAt,
	);
});

test("failed replacement insertion rolls back consumption of the old session", async (t) => {
	const f = await fixture(t);
	const original = prisma.$transaction.bind(prisma);
	prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) =>
		original(async (tx) => {
			tx.refreshSession.create = (async () => {
				throw new Error("Test replacement failure");
			}) as typeof tx.refreshSession.create;
			return run(tx);
		})) as typeof prisma.$transaction;
	try {
		await assert.rejects(AuthService.refreshToken(f.tokens.refreshToken));
	} finally {
		prisma.$transaction = original;
	}
	assert.equal(
		(await prisma.refreshSession.findUniqueOrThrow({ where: { id: f.id } }))
			.revokedAt,
		null,
	);
	assert.equal(
		await prisma.refreshSession.count({ where: { userId: f.user.id } }),
		1,
	);
});

test("invalid tokens are rejected and request validation rejects non-string tokens", async () => {
	await assert.rejects(AuthService.refreshToken("invalid"), {
		statusCode: 401,
	});
	assert.equal(
		refreshTokenSchema.safeParse({ refreshToken: 123 }).success,
		false,
	);
	assert.equal(refreshTokenSchema.safeParse({}).success, true); // Cookie fallback.
});

test("HTTP refresh supports body and cookies, explicit-body precedence and validation", async (t) => {
	const f = await fixture(t);
	const connectMock = mock.method(redis, "connect", async () => redis);
	const rateMock = mock.method(redis, "eval", async () => 1);
	const server = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}/api/v1/auth/refresh-token`;
	const request = (body: object, cookie?: string) =>
		fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify(body),
		});
	try {
		const first = await request({ refreshToken: f.tokens.refreshToken });
		assert.equal(first.status, 200);
		assert.equal(first.headers.getSetCookie().length, 2);
		const body = await first.json();
		assert.ok(body.data.accessToken && body.data.refreshToken);
		const cookie = `refreshToken=${body.data.refreshToken}`;
		assert.equal(
			(await request({ refreshToken: "invalid" }, cookie)).status,
			401,
		);
		assert.equal((await request({ refreshToken: 123 })).status, 400);
		assert.equal((await request({})).status, 401);
		assert.equal((await request({}, cookie)).status, 200);
	} finally {
		connectMock.mock.restore();
		rateMock.mock.restore();
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
	}
});

test("logout revokes the rotated family, preserves independent logins and is repeatable", async (t) => {
	const f = await fixture(t);
	const independent = await AuthService.loginUser({
		email: f.user.email,
		password: f.password,
	});
	const rotated = await AuthService.refreshToken(f.tokens.refreshToken);
	await AuthService.logout(f.tokens.refreshToken); // An older token identifies the same family.
	await AuthService.logout(f.tokens.refreshToken);
	await AuthService.logout("invalid");
	await AuthService.logout();
	await assert.rejects(AuthService.refreshToken(rotated.refreshToken), {
		statusCode: 401,
	});
	const remaining = await AuthService.refreshToken(independent.refreshToken);
	assert.ok(remaining.refreshToken);
	assert.equal(
		await prisma.refreshSession.count({
			where: { userId: f.user.id, revokedAt: null },
		}),
		1,
	);
});

test("HTTP logout uses its cookie, clears cookies and rejects malformed input", async (t) => {
	const f = await fixture(t);
	const connectMock = mock.method(redis, "connect", async () => redis);
	const rateMock = mock.method(redis, "eval", async () => 1);
	const server = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}/api/v1/auth/logout`;
	try {
		const result = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: `refreshToken=${f.tokens.refreshToken}`,
			},
			body: "{}",
		});
		assert.equal(result.status, 200);
		assert.equal((await result.json()).data, null);
		const cookies = result.headers.getSetCookie();
		assert.equal(cookies.length, 2);
		for (const cookie of cookies) {
			assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
			assert.match(cookie, /Path=\//);
		}
		assert.ok(
			(await prisma.refreshSession.findUniqueOrThrow({ where: { id: f.id } }))
				.revokedAt,
		);
		const bad = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refreshToken: 123 }),
		});
		assert.equal(bad.status, 400);
	} finally {
		connectMock.mock.restore();
		rateMock.mock.restore();
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
	}
});
