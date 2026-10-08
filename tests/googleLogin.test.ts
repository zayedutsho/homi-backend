import assert from "node:assert/strict";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import test, { afterEach, mock } from "node:test";
import jwt from "jsonwebtoken";
import { LoginTicket } from "google-auth-library";
import app from "../src/app";
import config from "../src/app/config";
import { googleClient } from "../src/app/lib/google";
import { prisma } from "../src/app/lib/prisma";
import { redis } from "../src/app/lib/redis";
import { AuthService } from "../src/app/module/auth/auth.service";

const originalConfig = { ...config };
const originalTransaction = prisma.$transaction;
afterEach(() => { prisma.$transaction = originalTransaction; mock.restoreAll(); Object.assign(config, originalConfig); });

function fixture() {
  config.google_client_id = "test.apps.googleusercontent.com";
  config.jwt_access_secret = randomBytes(32).toString("hex");
  config.jwt_refresh_secret = randomBytes(32).toString("hex");
  config.jwt_access_expires_in = "15m";
  config.jwt_refresh_expires_in = "7d";
  const identity = { sub: "google-stable-sub", email: "new@example.com", name: "Google User", email_verified: true, aud: config.google_client_id, iss: "https://accounts.google.com", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 };
  const user = { id: "google-user", name: identity.name, email: identity.email, password: null, role: "TENANT", emailVerified: true, status: "ACTIVE", isDeleted: false };
  let linked = false;
  let conflict = false;
  let created = false;
  let sessions = 0;
  const database = {
    authAccount: { findUnique: async (args: any) => {
      assert.deepEqual(args.where.provider_providerAccountId, { provider: "GOOGLE", providerAccountId: identity.sub });
      return linked ? { userId: user.id } : null;
    } },
    user: {
      findUnique: async (args: any) => args.where.id ? user : conflict ? { id: "credential-user" } : null,
      create: async (args: any) => {
        assert.equal(args.data.password, null);
        assert.equal(args.data.emailVerified, true);
        assert.equal(args.data.role, "TENANT");
        assert.equal(args.data.authAccounts.create.providerAccountId, identity.sub);
        assert.ok(args.data.tenant.create);
        created = true; return user;
      },
    },
    refreshSession: { create: async (args: any) => {
      assert.match(args.data.tokenHash, /^[a-f0-9]{64}$/);
      assert.ok(args.data.expiresAt > new Date()); sessions++; return args.data;
    } },
    $queryRaw: async () => [],
  };
  prisma.$transaction = (async (callback: any) => callback(database)) as typeof originalTransaction;
  mock.method(googleClient, "verifyIdToken", async (options: any) => {
    assert.equal(options.audience, config.google_client_id);
    return new LoginTicket(undefined, identity);
  });
  return { identity, user, database, link: () => { linked=true; }, conflict: () => { conflict=true; }, created: () => created, sessions: () => sessions };
}

test("new verified Google user gets tenant identity and application session without OTP", async () => {
  const f = fixture();
  mock.method(redis, "connect", async () => { throw new Error("Google service must not request OTP storage"); });
  const result = await AuthService.googleLogin({ idToken: "fixture-token" });
  assert.ok(f.created()); assert.equal(f.sessions(), 1);
  const claims = jwt.verify(result.accessToken, config.jwt_access_secret) as jwt.JwtPayload;
  assert.equal(claims.userId, f.user.id); assert.equal(claims.role, "TENANT");
  assert.ok((jwt.verify(result.refreshToken, config.jwt_refresh_secret) as jwt.JwtPayload).jti);
  assert.deepEqual(Object.keys(result).sort(), ["accessToken", "refreshToken"]);
});

test("returning Google user is found by stable sub despite email change", async () => {
  const f=fixture(); f.link(); f.identity.email="changed@example.com";
  await AuthService.googleLogin({ idToken: "fixture-token" });
  assert.equal(f.created(), false); assert.equal(f.sessions(), 1);
});

test("Google requires boolean true email verification", async () => {
  const f=fixture();
  for (const value of [false, undefined, "true"]) {
    (f.identity as any).email_verified=value;
    await assert.rejects(AuthService.googleLogin({ idToken: "fixture-token" }), { statusCode: 403 });
  }
  assert.equal(f.sessions(), 0); assert.equal(f.created(), false);
});

test("existing credential email conflicts without linking or issuing tokens", async () => {
  const f=fixture(); f.conflict();
  await assert.rejects(AuthService.googleLogin({ idToken: "fixture-token" }), { statusCode: 409, message: /Sign in with your password/ });
  assert.equal(f.created(), false); assert.equal(f.sessions(), 0);
});

for (const state of ["BLOCKED", "DELETED", "soft-deleted", "unverified"]) {
  test(`linked ${state} account is rejected`, async () => {
    const f=fixture(); f.link();
    if(state==="soft-deleted") f.user.isDeleted=true;
    else if(state==="unverified") f.user.emailVerified=false;
    else f.user.status=state;
    await assert.rejects(AuthService.googleLogin({ idToken: "fixture-token" }), { statusCode: 403 });
    assert.equal(f.sessions(), 0);
  });
}

test("real Google verifier rejects forged signature, wrong audience/issuer and expired tokens", async () => {
  fixture(); mock.restoreAll();
  const keys=generateKeyPairSync("rsa", { modulusLength: 2048 });
  const attacker=generateKeyPairSync("rsa", { modulusLength: 2048 });
  mock.method(googleClient, "getFederatedSignonCertsAsync", async () => ({ certs: { test: keys.publicKey.export({ type: "spki", format: "pem" }) } }));
  const base={ sub:"sub", email:"test@example.com", email_verified:true, aud:config.google_client_id, iss:"https://accounts.google.com", iat:Math.floor(Date.now()/1000)-1000, exp:Math.floor(Date.now()/1000)+3600 };
  for(const claims of [{...base,aud:"other-client"},{...base,iss:"attacker.example"},{...base,exp:Math.floor(Date.now()/1000)-600}]) {
    const idToken=jwt.sign(claims,keys.privateKey,{ algorithm:"RS256", keyid:"test" });
    await assert.rejects(AuthService.googleLogin({idToken}),{statusCode:401,message:"Invalid or expired Google ID token"});
  }
  const forged=jwt.sign(base,attacker.privateKey,{algorithm:"RS256",keyid:"test"});
  await assert.rejects(AuthService.googleLogin({idToken:forged}),{statusCode:401});
  await assert.rejects(AuthService.googleLogin({idToken:"invalid"}),{statusCode:401});
});

test("HTTP Google login returns standard response/cookies and validates input", async () => {
  fixture(); mock.method(redis,"connect",async()=>redis); mock.method(redis,"eval",async()=>1);
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  const address=server.address(); assert.ok(address && typeof address!=="string");
  const url=`http://127.0.0.1:${address.port}/api/v1/auth/google`;
  try {
    const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:"fixture-token"})});
    assert.equal(response.status,200); const body=await response.json();
    assert.equal(body.message,"Google login successful"); assert.equal(body.success,true);
    assert.equal(response.headers.getSetCookie().length,2);
    for(const cookie of response.headers.getSetCookie()) assert.match(cookie,/HttpOnly.*SameSite=Lax/);
    for(const payload of [{},{idToken:""},{idToken:"x",role:"ADMIN"}]) {
      const invalid=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      assert.equal(invalid.status,400); assert.equal((await invalid.json()).success,false);
    }
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
