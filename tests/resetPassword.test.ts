import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test, { after, mock } from "node:test";
import bcrypt from "bcryptjs";
import app from "../src/app";
import { prisma } from "../src/app/lib/prisma";
import { getRedis, redis } from "../src/app/lib/redis";
import { AuthService } from "../src/app/module/auth/auth.service";
import { resetPasswordSchema } from "../src/app/module/auth/auth.validation";

after(async()=>{mock.restoreAll();await prisma.$disconnect();if(redis.isOpen)redis.destroy();});
const newPassword="NewStrongPassword456!";

async function fixture(t: {after:(fn:()=>Promise<void>)=>void}) {
 const client=await getRedis();const email=`homi-reset-test-${randomUUID()}@example.invalid`;
 const oldPassword=`OldPassword-${randomUUID()}!`;
 const user=await prisma.user.create({data:{name:"Password reset integration",email,password:await bcrypt.hash(oldPassword,10),emailVerified:true}});
 const tokens=await AuthService.loginUser({email,password:oldPassword});
 const resetToken=randomBytes(32).toString("hex");
 const key=`homi:password-reset:grant:${createHash("sha256").update(resetToken).digest("hex")}`;
 const value=JSON.stringify({userId:user.id,purpose:"PASSWORD_RESET",passwordFingerprint:createHash("sha256").update(user.password!).digest("hex")});
 t.after(async()=>{await client.del(key);await prisma.user.deleteMany({where:{id:user.id}});});
 await client.set(key,value,{EX:300});
 return {client,user,email,oldPassword,tokens,resetToken,key,value,reset:()=>AuthService.resetPassword({resetToken,password:newPassword})};
}

test("reset hashes new password, revokes all refresh sessions and rejects token replay",async t=>{
 const f=await fixture(t);await AuthService.loginUser({email:f.email,password:f.oldPassword});
 await f.reset();const user=await prisma.user.findUniqueOrThrow({where:{id:f.user.id}});
 assert.ok(await bcrypt.compare(newPassword,user.password!));assert.ok(!await bcrypt.compare(f.oldPassword,user.password!));
 assert.equal(await prisma.refreshSession.count({where:{userId:f.user.id,revokedAt:null}}),0);
 assert.equal(await f.client.exists(f.key),0);
 await assert.rejects(f.reset(),{statusCode:400});
 await assert.rejects(AuthService.loginUser({email:f.email,password:f.oldPassword}),{statusCode:401});
 await AuthService.loginUser({email:f.email,password:newPassword});
 await assert.rejects(AuthService.refreshToken(f.tokens.refreshToken),{statusCode:401});
});

test("competing resets produce one winner",async t=>{
 const f=await fixture(t);const results=await Promise.allSettled([f.reset(),f.reset()]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(await prisma.refreshSession.count({where:{userId:f.user.id,revokedAt:null}}),0);
});

test("expired, wrong-purpose and stale-password grants cannot change password",async t=>{
 const f=await fixture(t);await f.client.del(f.key);await assert.rejects(f.reset(),{statusCode:400});
 const grant=JSON.parse(f.value);grant.purpose="EMAIL_VERIFICATION";
 await f.client.set(f.key,JSON.stringify(grant),{EX:300});await assert.rejects(f.reset(),{statusCode:400});
 grant.purpose="PASSWORD_RESET";grant.passwordFingerprint="0".repeat(64);
 await f.client.set(f.key,JSON.stringify(grant),{EX:300});await assert.rejects(f.reset(),{statusCode:400});
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.user.id}})).password,f.user.password);
 assert.equal(await prisma.refreshSession.count({where:{userId:f.user.id,revokedAt:null}}),1);
});

test("banned, deleted, unverified and Google-only accounts cannot reset",async t=>{
 const f=await fixture(t);
 for(const data of [{status:"BLOCKED" as const},{status:"ACTIVE" as const,isDeleted:true},{isDeleted:false,emailVerified:false},{emailVerified:true,password:null}]) {
  await prisma.user.update({where:{id:f.user.id},data});await assert.rejects(f.reset(),{statusCode:400});
 }
 assert.equal(await f.client.exists(f.key),1);
});

test("revocation failure rolls back password write; consumed grant requires fresh recovery",async t=>{
 const f=await fixture(t);const original=prisma.$transaction;
 prisma.$transaction=(async(callback:any,options:any)=>original.call(prisma,async(transaction:any)=>{
  transaction.refreshSession.updateMany=async()=>{throw new Error("Simulated revocation failure");};
  return callback(transaction);
 },options)) as typeof original;
 try{await assert.rejects(f.reset(),{message:"Simulated revocation failure"});}
 finally{prisma.$transaction=original;}
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.user.id}})).password,f.user.password);
 assert.equal(await prisma.refreshSession.count({where:{userId:f.user.id,revokedAt:null}}),1);
 assert.equal(await f.client.exists(f.key),0);
});

test("HTTP reset validates passwords, clears cookies and returns no credentials",async t=>{
 const f=await fixture(t);const original=f.client.eval.bind(f.client);
 const m=mock.method(f.client,"eval",async(script:string,options:any)=>options.keys[0].startsWith("homi:rate:")?1:original(script,options));
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
 const address=server.address();assert.ok(address && typeof address!=="string");const url=`http://127.0.0.1:${address.port}/api/v1/auth/reset-password`;
 try {
  const bad=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({resetToken:f.resetToken,password:"weak"})});assert.equal(bad.status,400);
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({resetToken:f.resetToken,password:newPassword})});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true,statusCode:200,message:"Password reset successfully. Please log in with your new password.",data:null});
  const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2);for(const cookie of cookies)assert.match(cookie,/Expires=Thu, 01 Jan 1970/);
 }finally{m.mock.restore();await new Promise<void>(r=>server.close(()=>r()));}
});

test("Zod enforces token shape, strong passwords, strict fields and bcrypt byte limit",()=>{
 for(const payload of [{resetToken:"bad",password:newPassword},{resetToken:"a".repeat(64),password:"weak"},{resetToken:"a".repeat(64),password:"A1!"+"é".repeat(40)},{resetToken:"a".repeat(64),password:newPassword,role:"ADMIN"}])assert.equal(resetPasswordSchema.safeParse(payload).success,false);
 assert.equal(resetPasswordSchema.safeParse({resetToken:"a".repeat(64),password:newPassword}).success,true);
});
