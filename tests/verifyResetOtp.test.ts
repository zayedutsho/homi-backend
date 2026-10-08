import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import test, { after, mock } from "node:test";
import bcrypt from "bcryptjs";
import app from "../src/app";
import { prisma } from "../src/app/lib/prisma";
import { getRedis, redis } from "../src/app/lib/redis";
import { AuthService } from "../src/app/module/auth/auth.service";

after(() => { if (redis.isOpen) redis.destroy(); });

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
 const client=await getRedis(); const id=randomUUID();
 const otp=randomInt(100000,1000000).toString();
 const key=`homi:otp:PASSWORD_RESET:${id}`;
 const user={id,password:"credential-password-hash",emailVerified:true,status:"ACTIVE",isDeleted:false};
 const find=prisma.user.findUnique;
 prisma.user.findUnique=(async()=>user) as typeof find;
 const grants: string[]=[];
 t.after(async()=>{prisma.user.findUnique=find;await client.del([key,...grants]);});
 await client.set(key,JSON.stringify({userId:id,purpose:"PASSWORD_RESET",hash:await bcrypt.hash(otp,10),attempts:0}),{EX:60});
 async function verify(code=otp) {
  const result=await AuthService.verifyResetOtp({email:"test@example.com",otp:code});
  grants.push(`homi:password-reset:grant:${createHash("sha256").update(result.resetToken).digest("hex")}`);
  return result;
 }
 return {client,key,otp,user,verify,grants};
}

test("correct OTP is consumed once and issues a hashed 5-minute single-purpose grant",async t=>{
 const f=await fixture(t);const result=await f.verify();
 assert.match(result.resetToken,/^[a-f0-9]{64}$/);assert.equal(result.resetTokenExpiresInSeconds,300);
 assert.equal(await f.client.exists(f.key),0);
 const stored=await f.client.get(f.grants[0]);assert.ok(stored);
 const grant=JSON.parse(stored);assert.equal(grant.userId,f.user.id);assert.equal(grant.purpose,"PASSWORD_RESET");
 assert.equal(grant.passwordFingerprint,createHash("sha256").update(f.user.password).digest("hex"));
 assert.ok(!stored.includes(result.resetToken));assert.ok(await f.client.ttl(f.grants[0])>290);
 assert.deepEqual(Object.keys(result).sort(),["resetToken","resetTokenExpiresInSeconds"]);
 await assert.rejects(f.verify(),{statusCode:400});
});

test("five wrong attempts preserve expiry then block even a correct OTP",async t=>{
 const f=await fixture(t);const wrong=f.otp==="000000"?"111111":"000000";
 for(let i=0;i<5;i++)await assert.rejects(f.verify(wrong),{statusCode:400});
 assert.ok(await f.client.ttl(f.key)>0);assert.equal(JSON.parse((await f.client.get(f.key))!).attempts,5);
 await assert.rejects(f.verify(),{statusCode:429});assert.equal(f.grants.length,0);
});

test("concurrent correct submissions have exactly one successful grant",async t=>{
 const f=await fixture(t);const results=await Promise.allSettled([f.verify(),f.verify()]);
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(f.grants.length,1);assert.equal(await f.client.exists(f.key),0);
});

test("expired and wrong-purpose records are rejected without grants",async t=>{
 const f=await fixture(t);await f.client.del(f.key);await assert.rejects(f.verify(),{statusCode:400});
 await f.client.set(f.key,JSON.stringify({userId:f.user.id,purpose:"EMAIL_VERIFICATION",hash:await bcrypt.hash(f.otp,10),attempts:0}),{EX:60});
 await assert.rejects(f.verify(),{statusCode:400});assert.equal(f.grants.length,0);
});

for(const state of ["missing","google-only","unverified","blocked","deleted"]) {
 test(`${state} account receives generic invalid-code error`,async t=>{
  const f=await fixture(t);
  if(state==="missing")prisma.user.findUnique=(async()=>null) as typeof prisma.user.findUnique;
  if(state==="google-only")f.user.password="";
  if(state==="unverified")f.user.emailVerified=false;
  if(state==="blocked")f.user.status="BLOCKED";
  if(state==="deleted")f.user.isDeleted=true;
  await assert.rejects(f.verify(),{statusCode:400,message:"Invalid or expired password reset code"});
  assert.equal(f.grants.length,0);
 });
}

test("Redis grant failure leaves OTP available and returns safe storage error",async t=>{
 const f=await fixture(t);const original=f.client.eval.bind(f.client);
 const m=mock.method(f.client,"eval",async(script: string,options: any)=>{
  if(options.keys.length===2)throw Error("Simulated Redis failure");
  return original(script,options);
 });
 try {await assert.rejects(f.verify(),{statusCode:503});assert.equal(await f.client.exists(f.key),1);}
 finally {m.mock.restore();}
});

test("HTTP validates OTP format, returns standard response without auth cookies",async t=>{
 const f=await fixture(t);const original=f.client.eval.bind(f.client);
 const m=mock.method(f.client,"eval",async(script:string,options:any)=>options.keys[0].startsWith("homi:rate:")?1:original(script,options));
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
 const address=server.address();assert.ok(address && typeof address!=="string");
 const url=`http://127.0.0.1:${address.port}/api/v1/auth/verify-reset-otp`;
 try {
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"test@example.com",otp:f.otp})});
  assert.equal(response.status,200);const body=await response.json();
  f.grants.push(`homi:password-reset:grant:${createHash("sha256").update(body.data.resetToken).digest("hex")}`);
  assert.equal(body.message,"Password reset code verified successfully");assert.equal(response.headers.getSetCookie().length,0);
  for(const otp of [123456,"12345","abcdef"]){
   const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"test@example.com",otp})});assert.equal(r.status,400);assert.equal((await r.json()).message,"Validation failed");
  }
 }finally {m.mock.restore();await new Promise<void>(r=>server.close(()=>r()));}
});
