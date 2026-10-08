import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, mock } from "node:test";
import { LoginTicket } from "google-auth-library";
import config from "../src/app/config";
import { googleClient } from "../src/app/lib/google";
import { prisma } from "../src/app/lib/prisma";
import { AuthService } from "../src/app/module/auth/auth.service";

after(async () => { mock.restoreAll(); await prisma.$disconnect(); });

test("Google identity persists transactionally and works with refresh rotation and logout", async () => {
  const subject=randomUUID();
  const email=`homi-google-test-${subject}@example.invalid`;
  const identity={sub:subject,email,name:"Google integration test",email_verified:true,aud:config.google_client_id,iss:"https://accounts.google.com",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};
  mock.method(googleClient,"verifyIdToken",async()=>new LoginTicket(undefined,identity));
  try {
    const first=await AuthService.googleLogin({idToken:"integration-fixture"});
    const user=await prisma.user.findUniqueOrThrow({where:{email},include:{authAccounts:true,tenant:true,refreshSessions:true}});
    assert.equal(user.password,null); assert.equal(user.emailVerified,true); assert.equal(user.role,"TENANT");
    assert.equal(user.authAccounts[0]?.providerAccountId,subject); assert.ok(user.tenant); assert.equal(user.refreshSessions.length,1);
    const returned=await AuthService.googleLogin({idToken:"integration-fixture"});
    assert.equal(await prisma.authAccount.count({where:{providerAccountId:subject}}),1);
    const rotated=await AuthService.refreshToken(first.refreshToken);
    await AuthService.logout(rotated.refreshToken);
    await assert.rejects(AuthService.refreshToken(rotated.refreshToken),{statusCode:401});
    // A separate Google login retains its independent session family.
    await AuthService.refreshToken(returned.refreshToken);
    await prisma.user.update({where:{id:user.id},data:{status:"BLOCKED"}});
    await assert.rejects(AuthService.googleLogin({idToken:"integration-fixture"}),{statusCode:403});
  } finally {
    await prisma.user.deleteMany({where:{email}});
    mock.restoreAll();
  }
});

test("failed Google session insertion rolls back user, tenant and provider identity", async () => {
  const subject=randomUUID(); const email=`homi-google-rollback-${subject}@example.invalid`;
  mock.method(googleClient,"verifyIdToken",async()=>new LoginTicket(undefined,{sub:subject,email,name:"Rollback test",email_verified:true,aud:config.google_client_id,iss:"https://accounts.google.com",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}));
  const originalTransaction=prisma.$transaction.bind(prisma);
  prisma.$transaction=(async (callback: any, options: any) => originalTransaction(async transaction=>{
    const originalCreate=transaction.refreshSession.create;
    transaction.refreshSession.create=(async()=>{throw new Error("Simulated session insert failure");}) as typeof originalCreate;
    return callback(transaction);
  },options)) as typeof prisma.$transaction;
  try {
    await assert.rejects(AuthService.googleLogin({idToken:"integration-fixture"}),{message:"Simulated session insert failure"});
    assert.equal(await prisma.user.count({where:{email}}),0);
    assert.equal(await prisma.authAccount.count({where:{providerAccountId:subject}}),0);
    assert.equal(await prisma.tenant.count({where:{email}}),0);
  } finally {
    prisma.$transaction=originalTransaction;
    await prisma.user.deleteMany({where:{email}}); mock.restoreAll();
  }
});
