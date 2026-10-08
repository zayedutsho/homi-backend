import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import jwt from "jsonwebtoken";
import app from "../src/app";
import config from "../src/app/config";
import { prisma } from "../src/app/lib/prisma";
import { OwnerApplicationService } from "../src/app/module/ownerApplication/ownerApplication.service";
import { listOwnerApplicationsSchema } from "../src/app/module/ownerApplication/ownerApplication.validation";

after(async()=>{await prisma.$disconnect();});

test("admin HTTP listing supports status/pagination, safe fields and database role guards",async t=>{
 const marker=randomUUID();
 const admin=await prisma.user.create({data:{name:"List test admin",email:`homi-list-admin-${marker}@example.invalid`,role:"ADMIN",password:null,emailVerified:true}});
 const tenant=await prisma.user.create({data:{name:"List test tenant",email:`homi-list-tenant-${marker}@example.invalid`,password:"never-expose-test-hash",emailVerified:true}});
 const ids: string[]=[];
 t.after(async()=>{await prisma.ownerApplication.deleteMany({where:{id:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:[admin.id,tenant.id]}}});});
 for(const status of ["REJECTED","APPROVED","PENDING"] as const){const application=await prisma.ownerApplication.create({data:{userId:tenant.id,reason:`List integration ${marker}`,contactNumber:"+8801700000000",address:"Dhaka",status}});ids.push(application.id);}
 const token=jwt.sign({userId:admin.id,role:"TENANT"},config.jwt_access_secret,{expiresIn:"15m"});
 const tenantToken=jwt.sign({userId:tenant.id,role:"ADMIN"},config.jwt_access_secret,{expiresIn:"15m"});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));const address=server.address();assert.ok(address && typeof address!=="string");const url=`http://127.0.0.1:${address.port}/api/v1/owner-applications`;
 async function get(query="",access=token){return fetch(url+query,{headers:access?{Authorization:`Bearer ${access}`}:{}});}
 try{
  assert.equal((await get("","")).status,401);assert.equal((await get("",tenantToken)).status,403);
  const response=await get("?status=PENDING&page=1&limit=100");assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.message,"Owner applications fetched successfully");assert.equal(body.meta.page,1);assert.equal(body.meta.limit,100);
  assert.ok(body.data.some((a:any)=>a.id===ids[2]));assert.ok(body.data.every((a:any)=>a.status==="PENDING"));
  for(const application of body.data){assert.ok(!("password" in application.user));assert.ok(!("refreshSessions" in application.user));assert.ok(!("authAccounts" in application.user));}
  const count=await prisma.ownerApplication.count({where:{status:"PENDING"}});assert.equal(body.meta.total,count);assert.equal(body.meta.totalPages,Math.ceil(count/100));
  const all=await get("?page=1&limit=1");const allBody=await all.json();assert.equal(allBody.data.length,1);assert.equal(allBody.meta.total,await prisma.ownerApplication.count());
  const empty=await get("?page=1000000&limit=100");assert.deepEqual((await empty.json()).data,[]);
  for(const query of ["?status=INVALID","?page=0","?limit=101","?page=1.5","?page=1&page=2","?userId=someone"]){const invalid=await get(query);assert.equal(invalid.status,400);assert.equal((await invalid.json()).message,"Validation failed");}
  await prisma.user.update({where:{id:admin.id},data:{status:"BLOCKED"}});assert.equal((await get()).status,403);
  await prisma.user.update({where:{id:admin.id},data:{status:"ACTIVE",emailVerified:false}});assert.equal((await get()).status,403);
  await prisma.user.update({where:{id:admin.id},data:{emailVerified:true,isDeleted:true}});assert.equal((await get()).status,403);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});

test("query defaults and bounds reject arrays and unsafe numeric strings",()=>{
 assert.deepEqual(listOwnerApplicationsSchema.parse({}),{page:1,limit:10});
 assert.deepEqual(listOwnerApplicationsSchema.parse({page:"2",limit:"25",status:"REJECTED"}),{page:2,limit:25,status:"REJECTED"});
 for(const page of ["-1","1e3","Infinity","9007199254740993",["1","2"]])assert.equal(listOwnerApplicationsSchema.safeParse({page}).success,false);
});

test("listing uses deterministic order and repeatable read count without writes",async()=>{
 const result=await OwnerApplicationService.listApplications({page:1,limit:100,status:"REJECTED"});
 assert.equal(result.meta.total,await prisma.ownerApplication.count({where:{status:"REJECTED"}}));
 for(let i=1;i<result.applications.length;i++){
  const previous=result.applications[i-1];const current=result.applications[i];
  assert.ok(previous.createdAt>=current.createdAt);
  if(previous.createdAt.getTime()===current.createdAt.getTime())assert.ok(previous.id>=current.id);
 }
});
