import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import jwt from "jsonwebtoken";
import app from "../src/app";
import config from "../src/app/config";
import { prisma } from "../src/app/lib/prisma";

test("current-user HTTP endpoint checks tokens and account status and returns selected profile fields", async () => {
	const originalFind = prisma.user.findUnique;
	const originalSecret = config.jwt_access_secret;
	config.jwt_access_secret = randomBytes(32).toString("hex");
	const user = {
		id: "test-user",
		name: "Current name",
		email: "current@example.com",
		role: "TENANT",
		status: "ACTIVE",
		emailVerified: true,
		isDeleted: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		tenant: {
			id: "tenant-id",
			contactNumber: null,
			address: null,
			isDeleted: false,
		},
	};
	let missing = false;
	prisma.user.findUnique = (async (args: {
		select: Record<string, unknown>;
		where: { id: string };
	}) => {
		assert.deepEqual(args.where, { id: user.id });
		assert.ok(!("password" in args.select));
		if (missing) return null;
		return Object.fromEntries(
			Object.keys(args.select).map((key) => [
				key,
				user[key as keyof typeof user],
			]),
		);
	}) as typeof originalFind;
	const token = jwt.sign(
		{
			userId: user.id,
			name: "Old name",
			email: "old@example.com",
			role: "ADMIN",
		},
		config.jwt_access_secret,
		{ expiresIn: "15m" },
	);
	const server = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}/api/v1/auth/me`;
	const request = (authorization?: string, cookie?: string) =>
		fetch(url, {
			headers: {
				...(authorization ? { Authorization: authorization } : {}),
				...(cookie ? { Cookie: cookie } : {}),
			},
		});
	try {
		assert.equal((await request()).status, 401);
		assert.equal((await request(token)).status, 401);
		assert.equal(
			(await request("Bearer invalid", `accessToken=${token}`)).status,
			401,
		);
		const wrongKey = jwt.sign(
			{ userId: user.id },
			randomBytes(32).toString("hex"),
			{ expiresIn: "15m" },
		);
		assert.equal((await request(`Bearer ${wrongKey}`)).status, 401);
		const expired = jwt.sign({ userId: user.id }, config.jwt_access_secret, {
			expiresIn: -1,
		});
		assert.equal((await request(`Bearer ${expired}`)).status, 401);
		const success = await request(`Bearer ${token}`);
		assert.equal(success.status, 200);
		const body = await success.json();
		assert.equal(body.data.name, "Current name");
		assert.equal(body.data.role, "TENANT");
		assert.ok(!("password" in body.data));
		assert.ok(!("isDeleted" in body.data));
		assert.ok(!("isDeleted" in body.data.tenant));
		user.tenant.isDeleted = true;
		assert.equal(
			(await (await request(`Bearer ${token}`)).json()).data.tenant,
			null,
		);
		user.status = "BLOCKED";
		assert.equal((await request(`Bearer ${token}`)).status, 403);
		user.status = "ACTIVE";
		user.isDeleted = true;
		assert.equal((await request(`Bearer ${token}`)).status, 403);
		user.isDeleted = false;
		user.emailVerified = false;
		assert.equal((await request(`Bearer ${token}`)).status, 403);
		user.emailVerified = true;
		missing = true;
		assert.equal((await request(`Bearer ${token}`)).status, 401);
	} finally {
		prisma.user.findUnique = originalFind;
		config.jwt_access_secret = originalSecret;
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
	}
});
