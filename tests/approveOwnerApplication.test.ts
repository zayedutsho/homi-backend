import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import jwt from "jsonwebtoken";
import app from "../src/app";
import config from "../src/app/config";
import { prisma } from "../src/app/lib/prisma";
import { OwnerApplicationService } from "../src/app/module/ownerApplication/ownerApplication.service";

after(async()=>{await prisma.$disconnect();});
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const marker=randomUUID();
 const admin=await prisma.user.create({data:{name:"Approval admin",email:`homi-approve-admin-${marker}@example.invalid`,role:"ADMIN",password:null,emailVerified:true}});
 const tenant=await prisma.user.create({data:{name:"Approval tenant",email:`homi-approve-tenant-${marker}@example.invalid`,password:null,emailVerified:true}});
 const application=await OwnerApplicationService.submitApplication(tenant.id,{reason:"I would like to list rental properties on Homi.",contactNumber:"+8801700000000",address:"Dhaka"});
 t.after(async()=>{await prisma.auditLog.deleteMany({where:{userId:{in:[admin.id,tenant.id]}}});await prisma.ownerApplication.deleteMany({where:{userId:{in:[admin.id,tenant.id]}}});await prisma.user.deleteMany({where:{id:{in:[admin.id,tenant.id]}}});});
 return {admin,tenant,application,approve:()=>OwnerApplicationService.approveApplication(admin.id,application.id)};
}

test("approval promotes tenant and stores reviewer, history and audit exactly once",async t=>{
 const f=await fixture(t);const result=await f.approve();
 assert.equal(result.status,"APPROVED");assert.equal(result.user.role,"OWNER");assert.equal(result.reviewedById,f.admin.id);assert.ok(result.reviewedAt);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.tenant.id}})).role,"OWNER");
 const reviews=await prisma.ownerApplicationReview.findMany({where:{applicationId:f.application.id}});assert.equal(reviews.length,1);assert.equal(reviews[0].decision,"APPROVED");assert.equal(reviews[0].reviewerId,f.admin.id);
 assert.equal(await prisma.auditLog.count({where:{entityId:f.application.id,action:"OWNER_APPLICATION_APPROVED"}}),1);
 await assert.rejects(f.approve(),{statusCode:409});
});

test("concurrent approval has one winner without duplicate review or audit",async t=>{
 const f=await fixture(t);const results=await Promise.allSettled([f.approve(),f.approve()]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(await prisma.ownerApplicationReview.count({where:{applicationId:f.application.id}}),1);
 assert.equal(await prisma.auditLog.count({where:{entityId:f.application.id,action:"OWNER_APPLICATION_APPROVED"}}),1);
});

test("missing/rejected applications and ineligible applicants are rejected",async t=>{
 const f=await fixture(t);await assert.rejects(OwnerApplicationService.approveApplication(f.admin.id,randomUUID()),{statusCode:404});
 await prisma.ownerApplication.update({where:{id:f.application.id},data:{status:"REJECTED"}});await assert.rejects(f.approve(),{statusCode:409});
 await prisma.ownerApplication.update({where:{id:f.application.id},data:{status:"PENDING"}});
 for(const data of [{status:"BLOCKED" as const},{status:"ACTIVE" as const,isDeleted:true},{isDeleted:false,emailVerified:false},{emailVerified:true,role:"OWNER" as const}]){
  await prisma.user.update({where:{id:f.tenant.id},data});await assert.rejects(f.approve(),{statusCode:409});
 }
 assert.equal((await prisma.ownerApplication.findUniqueOrThrow({where:{id:f.application.id}})).status,"PENDING");assert.equal(await prisma.ownerApplicationReview.count({where:{applicationId:f.application.id}}),0);
});

test("service rechecks admin eligibility and prevents self approval",async t=>{
 const f=await fixture(t);
 await assert.rejects(OwnerApplicationService.approveApplication(f.tenant.id,f.application.id),{statusCode:403});
 await prisma.user.update({where:{id:f.admin.id},data:{status:"BLOCKED"}});await assert.rejects(f.approve(),{statusCode:403});
 await prisma.user.update({where:{id:f.tenant.id},data:{role:"ADMIN"}});
 await assert.rejects(OwnerApplicationService.approveApplication(f.tenant.id,f.application.id),{statusCode:403,message:"You cannot approve your own owner application"});
});

test("audit failure rolls back promotion, application update and review history",async t=>{
 const f=await fixture(t);const original=prisma.$transaction;
 prisma.$transaction=(async(callback:any,options:any)=>original.call(prisma,async(tx:any)=>{tx.auditLog.create=async()=>{throw Error("Simulated approval audit failure");};return callback(tx);},options)) as typeof original;
 try{await assert.rejects(f.approve(),{message:"Simulated approval audit failure"});}finally{prisma.$transaction=original;}
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.tenant.id}})).role,"TENANT");assert.equal((await prisma.ownerApplication.findUniqueOrThrow({where:{id:f.application.id}})).status,"PENDING");assert.equal(await prisma.ownerApplicationReview.count({where:{applicationId:f.application.id}}),0);
});

test("HTTP enforces admin, validates id/body and returns safe approved response",async t=>{
 const f=await fixture(t);const adminToken=jwt.sign({userId:f.admin.id},config.jwt_access_secret,{expiresIn:"15m"});const tenantToken=jwt.sign({userId:f.tenant.id,role:"ADMIN"},config.jwt_access_secret,{expiresIn:"15m"});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));const a=server.address();assert.ok(a && typeof a!=="string");const base=`http://127.0.0.1:${a.port}/api/v1/owner-applications`;
 async function patch(id=f.application.id,body:unknown={},token=adminToken){return fetch(`${base}/${id}/approve`,{method:"PATCH",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});}
 try{
  assert.equal((await patch(f.application.id,{},"")).status,401);assert.equal((await patch(f.application.id,{},tenantToken)).status,403);
  assert.equal((await patch("invalid-id")).status,400);assert.equal((await patch(f.application.id,{role:"ADMIN"})).status,400);
  const response=await patch();assert.equal(response.status,200);const body=await response.json();assert.equal(body.message,"Owner application approved successfully");assert.equal(body.data.user.role,"OWNER");assert.ok(!("password" in body.data.user));
  assert.equal((await patch()).status,409);
  const profile=await fetch(`http://127.0.0.1:${a.port}/api/v1/auth/me`,{headers:{Authorization:`Bearer ${tenantToken}`}});assert.equal((await profile.json()).data.role,"OWNER");
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
