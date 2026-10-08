import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { afterEach, mock } from "node:test";
import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";
import app from "../src/app";
import config from "../src/app/config";
import { prisma } from "../src/app/lib/prisma";
import { redis } from "../src/app/lib/redis";
import { AuthService } from "../src/app/module/auth/auth.service";

const originalConfig = { ...config };
const originalFind = prisma.user.findUnique;
const originalCreateSession = prisma.refreshSession.create;
const originalTransaction = prisma.$transaction;
afterEach(() => {
	prisma.user.findUnique = originalFind;
	prisma.refreshSession.create = originalCreateSession;
	prisma.$transaction = originalTransaction;
	mock.restoreAll();
	Object.assign(config, originalConfig);
});

async function fixture() {
	prisma.$transaction = (async (callback: (transaction: unknown) => unknown) => callback({
		$queryRaw: async () => [],
		user: prisma.user,
		refreshSession: prisma.refreshSession,
	})) as typeof originalTransaction;
	prisma.refreshSession.create = (async ({
		data,
	}: {
		data: { tokenHash: string; expiresAt: Date };
	}) => {
		assert.match(data.tokenHash, /^[a-f0-9]{64}$/);
		assert.ok(data.expiresAt > new Date());
		return data;
	}) as typeof originalCreateSession;
	config.jwt_access_secret = randomBytes(32).toString("hex");
	config.jwt_refresh_secret = randomBytes(32).toString("hex");
	config.jwt_access_expires_in = "15m";
	config.jwt_refresh_expires_in = "7d";
	const user = {
		id: "test-user",
		name: "Test",
		email: "test@example.com",
		password: await bcrypt.hash("StrongPassword123!", 10),
		role: "TENANT",
		emailVerified: true,
		status: "ACTIVE",
		isDeleted: false,
	};
	prisma.user.findUnique = (async () => user) as typeof originalFind;
	return user;
}

test("verified login issues signed expiring tokens with distinct refresh IDs", async () => {
	await fixture();
	const result = await AuthService.loginUser({
		email: " TEST@EXAMPLE.COM ",
		password: "StrongPassword123!",
	});
	const access = jwt.verify(
		result.accessToken,
		config.jwt_access_secret,
	) as JwtPayload;
	const refresh = jwt.verify(
		result.refreshToken,
		config.jwt_refresh_secret,
	) as JwtPayload;
	assert.equal(access.role, "TENANT");
	assert.equal(access.exp! - access.iat!, 900);
	assert.equal(refresh.exp! - refresh.iat!, 604800);
	assert.ok(refresh.jti);
	assert.ok(!("password" in access));
	assert.deepEqual(Object.keys(result).sort(), ["accessToken", "refreshToken"]);
	const second = await AuthService.loginUser({
		email: "test@example.com",
		password: "StrongPassword123!",
	});
	assert.notEqual(second.refreshToken, result.refreshToken);
});

test("unknown email and wrong password use the same 401 error", async () => {
	await fixture();
	await assert.rejects(
		AuthService.loginUser({ email: "test@example.com", password: "wrong" }),
		{ statusCode: 401, message: "Invalid email or password" },
	);
	prisma.user.findUnique = (async () => null) as typeof originalFind;
	await assert.rejects(
		AuthService.loginUser({ email: "missing@example.com", password: "wrong" }),
		{ statusCode: 401, message: "Invalid email or password" },
	);
});

test("login cannot issue a session after a concurrent password change", async () => {
	const user = await fixture();
	let reads = 0;
	let sessions = 0;
	prisma.user.findUnique = (async () => ({ ...user, password: ++reads === 1 ? user.password : "changed-password-hash" })) as typeof originalFind;
	prisma.refreshSession.create = (async () => { sessions++; }) as unknown as typeof originalCreateSession;
	await assert.rejects(AuthService.loginUser({ email: user.email, password: "StrongPassword123!" }), { statusCode: 401 });
	assert.equal(sessions, 0);
});

for (const state of ["unverified", "blocked", "deleted"] as const) {
	test(`${state} accounts cannot receive tokens`, async () => {
		const user = await fixture();
		if (state === "unverified") user.emailVerified = false;
		if (state === "blocked") user.status = "BLOCKED";
		if (state === "deleted") user.isDeleted = true;
		await assert.rejects(
			AuthService.loginUser({
				email: user.email,
				password: "StrongPassword123!",
			}),
			{ statusCode: 403 },
		);
	});
}

test("HTTP login validates input and returns safe cookies and tokens", async () => {
	await fixture();
	config.node_env = "development";
	mock.method(redis, "connect", async () => redis);
	mock.method(redis, "eval", async () => 1);
	const server = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}/api/v1/auth/login`;
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "test@example.com",
				password: "StrongPassword123!",
			}),
		});
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.success, true);
		assert.ok(body.data.accessToken && body.data.refreshToken);
		const cookies = response.headers.getSetCookie();
		assert.equal(cookies.length, 2);
		for (const cookie of cookies) {
			assert.match(cookie, /HttpOnly/);
			assert.match(cookie, /SameSite=Lax/);
		}
		assert.match(cookies[0], /Max-Age=89\d|Max-Age=900/);
		const invalid = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "invalid", password: "x" }),
		});
		assert.equal(invalid.status, 400);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
	}
});

test("login rejects placeholder secrets and missing expiry configuration", async () => {
	await fixture();
	config.jwt_access_secret = "replace-with-a-random-secret";
	await assert.rejects(
		AuthService.loginUser({
			email: "test@example.com",
			password: "StrongPassword123!",
		}),
		{ statusCode: 503 },
	);
	config.jwt_access_secret = randomBytes(32).toString("hex");
	config.jwt_access_expires_in = "";
	await assert.rejects(
		AuthService.loginUser({
			email: "test@example.com",
			password: "StrongPassword123!",
		}),
		{ statusCode: 503 },
	);
});
