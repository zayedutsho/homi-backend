import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import jwt from "jsonwebtoken";
import app from "../src/app";
import config from "../src/app/config";
import { prisma } from "../src/app/lib/prisma";
import { OwnerApplicationService } from "../src/app/module/ownerApplication/ownerApplication.service";

const payload={reason:"I manage housing and want to list my properties on Homi.",contactNumber:"+8801700000000",address:"Uttara, Dhaka"};
after(async()=>{await prisma.$disconnect();});
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const user=await prisma.user.create({data:{name:"Owner application integration",email:`homi-owner-test-${randomUUID()}@example.invalid`,password:null,emailVerified:true}});
 t.after(async()=>{await prisma.auditLog.deleteMany({where:{userId:user.id}});await prisma.ownerApplication.deleteMany({where:{userId:user.id}});await prisma.user.deleteMany({where:{id:user.id}});});
 return user;
}

test("submission creates pending application and audit together without promoting tenant",async t=>{
 const user=await fixture(t);const result=await OwnerApplicationService.submitApplication(user.id,payload);
 assert.equal(result.status,"PENDING");assert.equal(result.userId,user.id);assert.equal(result.reviewedAt,null);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).role,"TENANT");
 const logs=await prisma.auditLog.findMany({where:{entityId:result.id}});assert.equal(logs.length,1);assert.equal(logs[0].action,"OWNER_APPLICATION_SUBMITTED");
 await assert.rejects(OwnerApplicationService.submitApplication(user.id,payload),{statusCode:409});
});

test("concurrent submissions have one winner and database index rejects direct duplicates",async t=>{
 const user=await fixture(t);const results=await Promise.allSettled([OwnerApplicationService.submitApplication(user.id,payload),OwnerApplicationService.submitApplication(user.id,payload)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(await prisma.ownerApplication.count({where:{userId:user.id,status:"PENDING"}}),1);
 await assert.rejects(prisma.ownerApplication.create({data:{userId:user.id,...payload}}),{code:"P2002"});
});

test("rejected history is retained while a new pending application is allowed",async t=>{
 const user=await fixture(t);const old=await OwnerApplicationService.submitApplication(user.id,payload);
 // Test fixture simulates a completed review; no admin endpoint is implemented here.
 await prisma.ownerApplication.update({where:{id:old.id},data:{status:"REJECTED",rejectionReason:"Test review",reviewedAt:new Date()}});
 const next=await OwnerApplicationService.submitApplication(user.id,payload);assert.notEqual(next.id,old.id);
 assert.equal(await prisma.ownerApplication.count({where:{userId:user.id}}),2);
});

test("owner, admin, blocked, unverified and deleted users cannot apply",async t=>{
 const user=await fixture(t);
 for(const data of [{role:"OWNER" as const},{role:"ADMIN" as const},{role:"TENANT" as const,status:"BLOCKED" as const},{status:"ACTIVE" as const,emailVerified:false},{emailVerified:true,isDeleted:true}]){
  await prisma.user.update({where:{id:user.id},data});await assert.rejects(OwnerApplicationService.submitApplication(user.id,payload),{statusCode:403});
 }
 assert.equal(await prisma.ownerApplication.count({where:{userId:user.id}}),0);
});

test("audit insert failure rolls back application",async t=>{
 const user=await fixture(t);const original=prisma.$transaction;
 prisma.$transaction=(async(callback:any,options:any)=>original.call(prisma,async(tx:any)=>{tx.auditLog.create=async()=>{throw Error("Simulated audit failure");};return callback(tx);},options)) as typeof original;
 try{await assert.rejects(OwnerApplicationService.submitApplication(user.id,payload),{message:"Simulated audit failure"});}finally{prisma.$transaction=original;}
 assert.equal(await prisma.ownerApplication.count({where:{userId:user.id}}),0);
});

test("HTTP enforces Bearer auth, database role and strict validation",async t=>{
 const user=await fixture(t);const token=jwt.sign({userId:user.id,role:"ADMIN"},config.jwt_access_secret,{expiresIn:"15m"});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));const a=server.address();assert.ok(a && typeof a!=="string");const url=`http://127.0.0.1:${a.port}/api/v1/owner-applications`;
 async function send(body:unknown,authorized=true){return fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(authorized?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});}
 try{
  assert.equal((await send(payload,false)).status,401);
  assert.equal((await send({...payload,status:"APPROVED",userId:randomUUID()})).status,400);
  assert.equal((await send({...payload,reason:"short"})).status,400);
  const response=await send(payload);assert.equal(response.status,201);const body=await response.json();assert.equal(body.data.userId,user.id);assert.equal(body.data.status,"PENDING");
  assert.equal((await send(payload)).status,409);
  await prisma.user.update({where:{id:user.id},data:{role:"OWNER"}});assert.equal((await send(payload)).status,403);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
