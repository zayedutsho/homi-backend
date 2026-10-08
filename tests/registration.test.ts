import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import bcrypt from "bcryptjs";
import app from "../src/app";
import config from "../src/app/config";
import { redis } from "../src/app/lib/redis";
import { AuthService } from "../src/app/module/auth/auth.service";
import { prisma } from "../src/app/lib/prisma";
import nodemailer from "nodemailer";
import { registerSchema } from "../src/app/module/auth/auth.validation";
import { AppError } from "../src/app/utils/AppError";

const originalConfig = { ...config };
const originalFindUnique = prisma.user.findUnique;
const originalTransaction = prisma.$transaction;
afterEach(() => {
	mock.restoreAll();
	prisma.user.findUnique = originalFindUnique;
	prisma.$transaction = originalTransaction;
	Object.assign(config, originalConfig);
});

// Explicit dependency stubs: these tests do not claim real PostgreSQL/Redis/SMTP coverage.
function fixture(failure?: "duplicate" | "email" | "redis" | "race") {
	const state = {
		committed: false,
		rolledBack: false,
		deleted: false,
		key: "",
		record: "",
		ttl: 0,
		otp: "",
		passwordHash: "",
	};
	const database = {
		user: {
			findUnique: async () =>
				failure === "duplicate" ? { id: "existing" } : null,
		},
		$transaction: async (run: (tx: unknown) => Promise<unknown>) => {
			try {
				const value = await run({
					user: {
						create: async ({
							data,
						}: {
							data: {
								password: string;
								role: string;
								emailVerified: boolean;
								tenant: unknown;
							};
						}) => {
							if (failure === "race")
								throw new AppError(409, "User with this email already exists");
							assert.equal(data.role, "TENANT");
							assert.equal(data.emailVerified, false);
							assert.ok(data.tenant);
							state.passwordHash = data.password;
							return {
								id: "user-123",
								name: "Test Tenant",
								email: "tenant@example.com",
								role: "TENANT",
								emailVerified: false,
							};
						},
					},
				});
				state.committed = true;
				return value;
			} catch (error) {
				state.rolledBack = true;
				throw error;
			}
		},
	};
	const dependencies = {
		database,
		getRedis: async () => ({
			set: async (key: string, record: string, options: { EX: number }) => {
				if (failure === "redis") throw new AppError(503, "Redis unavailable");
				state.key = key;
				state.record = record;
				state.ttl = options.EX;
			},
			del: async () => {
				state.deleted = true;
			},
		}),
		sendEmail: async (_email: string, otp: string) => {
			if (failure === "email") throw new AppError(503, "Email unavailable");
			state.otp = otp;
		},
	};
	config.redis_url = "redis://localhost:6379";
	config.smtp_host = "smtp.example.com";
	config.smtp_user = "test-user";
	config.smtp_password = "test-only-password";
	config.email_sender = "test@example.com";
	prisma.user.findUnique = database.user
		.findUnique as typeof prisma.user.findUnique;
	prisma.$transaction = database.$transaction as typeof prisma.$transaction;
	mock.method(redis, "connect", async () => redis);
	mock.method(redis, "set", async (...args: Parameters<typeof redis.set>) => {
		const client = await dependencies.getRedis();
		return client.set(
			args[0] as string,
			args[1] as string,
			args[2] as { EX: number },
		);
	});
	mock.method(redis, "del", async () => (await dependencies.getRedis()).del());
	mock.method(nodemailer, "createTransport", () => ({
		sendMail: async (message: { text: string; html: string; to: string }) => {
			const otp = message.text.match(/code is (\d{6})/)?.[1];
			assert.ok(otp);
			assert.ok(message.html.includes(otp));
			assert.match(message.html, /Hi Test Tenant/);
			assert.match(message.text, /10 minutes/);
			await dependencies.sendEmail(message.to, otp);
			return { accepted: [message.to], rejected: [] };
		},
		close: () => {},
	}));
	return { state, register: AuthService.registerUser };
}

const payload = {
	name: "Test Tenant",
	email: "tenant@example.com",
	password: "StrongPassword123!",
};

test("registration stores hashes with a TTL and returns no credentials or tokens", async () => {
	const { state, register } = fixture();
	const result = await register(payload);
	assert.equal(state.committed, true);
	assert.equal(state.ttl, 600);
	assert.equal(state.key, "homi:otp:EMAIL_VERIFICATION:user-123");
	assert.match(state.otp, /^\d{6}$/);
	const record = JSON.parse(state.record);
	assert.equal(record.purpose, "EMAIL_VERIFICATION");
	assert.equal(record.attempts, 0);
	assert.ok(await bcrypt.compare(state.otp, record.hash));
	assert.ok(await bcrypt.compare(payload.password, state.passwordHash));
	assert.ok(!state.record.includes(state.otp));
	assert.equal(result.verificationRequired, true);
	assert.equal(result.user.emailVerified, false);
	assert.ok(!("password" in result.user));
	assert.ok(!("accessToken" in result));
	assert.ok(!("refreshToken" in result));
});

test("duplicate email never creates a user or sends mail", async () => {
	const { state, register } = fixture("duplicate");
	await assert.rejects(register(payload), { statusCode: 409 });
	assert.equal(state.committed, false);
	assert.equal(state.otp, "");
});

for (const failure of ["email", "redis", "race"] as const) {
	test(`${failure} failure rolls back and cleans up only this registration OTP`, async () => {
		const { state, register } = fixture(failure);
		await assert.rejects(register(payload));
		assert.equal(state.committed, false);
		assert.equal(state.rolledBack, true);
		assert.equal(state.deleted, failure !== "race");
	});
}

test("validation normalizes input and prevents role injection and bcrypt truncation", () => {
	assert.deepEqual(
		registerSchema.parse({
			...payload,
			name: "  Test Tenant ",
			email: " TENANT@EXAMPLE.COM ",
		}),
		payload,
	);
	for (const body of [
		{ ...payload, role: "ADMIN" },
		{ ...payload, password: "short" },
		{ ...payload, email: "bad" },
		{ ...payload, password: `Aa1!${"é".repeat(35)}` },
	]) {
		assert.equal(registerSchema.safeParse(body).success, false);
	}
});

test("HTTP registration returns 201 with no cookies; invalid requests return standard 400", async () => {
	const { register } = fixture();
	const originalUrl = config.redis_url;
	config.redis_url = "redis://localhost:6379";
	const registerMock = mock.method(AuthService, "registerUser", register);
	const connectMock = mock.method(redis, "connect", async () => redis);
	let count = 0;
	const evalMock = mock.method(redis, "eval", async () => ++count);
	const server = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}/api/v1/auth/register`;
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		assert.equal(response.status, 201);
		assert.equal(response.headers.get("set-cookie"), null);
		const body = await response.json();
		assert.equal(body.data.verificationRequired, true);
		assert.match(body.message, /verification code/);
		assert.ok(!("accessToken" in body.data));
		const bad = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...payload, role: "OWNER" }),
		});
		assert.equal(bad.status, 400);
		assert.equal((await bad.json()).success, false);
		count = 10;
		const limited = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		assert.equal(limited.status, 429);
		assert.equal(limited.headers.get("retry-after"), "900");
	} finally {
		registerMock.mock.restore();
		connectMock.mock.restore();
		evalMock.mock.restore();
		config.redis_url = originalUrl;
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
