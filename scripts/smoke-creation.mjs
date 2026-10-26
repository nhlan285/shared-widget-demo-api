// Explicitly owned synthetic fixtures in the isolated demo database only.
// No registration/OTP acceptance is implied. Never prints JWTs or signing keys.
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {deflateSync,crc32} from "node:zlib";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import WebSocket from "ws";
const origin="https://shared-widget-demo-api.nguyennhatlan285.workers.dev";
const config=JSON.parse(fs.readFileSync("wrangler.jsonc","utf8").replace(/^\uFEFF/,""));
assert.equal(config.name,"shared-widget-demo-api");
assert.equal(config.account_id,"4bce5751f79111fc1541214fecffd713");
assert.equal(config.d1_databases[0].database_id,"59e3b722-e516-44e9-a228-5e6a450db40b");
const secrets=JSON.parse(fs.readFileSync(".local/demo-secrets.json","utf8").replace(/^\uFEFF/,""));
const stamp=Date.now();
const fixturePath=".local/smoke-session.json";
let fixture=fs.existsSync(fixturePath)?JSON.parse(fs.readFileSync(fixturePath,"utf8")):null;
if(!fixture && fs.existsSync(".local/fixture.sql")){
  const previous=fs.readFileSync(".local/fixture.sql","utf8");
  const users=[...previous.matchAll(/INSERT INTO user_sessions[\s\S]*?VALUES\('([^']+)','([^']+)'/g)]
    .map((m,i)=>({userId:m[1],sessionId:m[2],name:i===0?"Demo Bạn":"Demo Người ấy"}));
  const pair=previous.match(/INSERT OR IGNORE INTO pairs[\s\S]*?VALUES\('([^']+)'/);
  if(users.length===2 && pair)fixture={users,pairId:pair[1]};
}
if(!fixture){
  fixture={pairId:randomUUID(),users:[{userId:randomUUID(),sessionId:randomUUID(),
    name:"Demo Bạn"},{userId:randomUUID(),sessionId:randomUUID(),name:"Demo Người ấy"}]};
}
const quote=(v)=>"'"+String(v).replaceAll("'","''")+"'";
function sql(command){
  fs.writeFileSync(".local/fixture.sql",command);
  const result=execFileSync(process.execPath,["node_modules/wrangler/bin/wrangler.js",
    "d1","execute","DB","--remote","--config","wrangler.jsonc","--file",".local/fixture.sql","--json"],
    {encoding:"utf8",windowsHide:true,stdio:"pipe",timeout:60000});
  // Wrangler prints progress lines before JSON for remote file imports.
  // Exit status is sufficient here; the fixture is checked through real APIs.
  return result.length;
}
const statements=[];
for(const user of fixture.users){
  statements.push(`INSERT OR IGNORE INTO users(user_id,email,password,display_name,is_active,created_at)
    VALUES(${quote(user.userId)},${quote(user.userId+"@example.invalid")},'NOT_A_LOGIN_PASSWORD',
    ${quote(user.name)},1,${quote(new Date(stamp).toISOString())});`);
  statements.push(`INSERT INTO user_sessions(user_id,session_id,device_id,refresh_token_hash,created_at,expires_at)
    VALUES(${quote(user.userId)},${quote(user.sessionId)},'demo-device','fixture-no-refresh',${stamp},${stamp+7200000})
    ON CONFLICT(user_id)DO UPDATE SET session_id=excluded.session_id,
      created_at=excluded.created_at,expires_at=excluded.expires_at;`);
  user.accessToken=jwt.sign({userId:user.userId,sessionId:user.sessionId,
    email:user.userId+"@example.invalid",tokenUse:"access"},secrets.JWT_SECRET,
    {algorithm:"HS256",expiresIn:7200,jwtid:randomUUID()});
}
statements.push(`INSERT OR IGNORE INTO pairs(pair_id,created_by,status,created_at,updated_at)
 VALUES(${quote(fixture.pairId)},${quote(fixture.users[0].userId)},'forming',${stamp},${stamp});`);
for(const [i,u]of fixture.users.entries()){
  statements.push(`INSERT INTO pair_members(membership_id,pair_id,user_id,slot,joined_at)
    SELECT ${quote(randomUUID())},${quote(fixture.pairId)},${quote(u.userId)},${i+1},${stamp}
    WHERE NOT EXISTS(SELECT 1 FROM pair_members WHERE pair_id=${quote(fixture.pairId)} AND user_id=${quote(u.userId)});`);
}
statements.push(`UPDATE pairs SET status='active' WHERE pair_id=${quote(fixture.pairId)} AND status='forming';`);
fixture.origin=origin;fs.writeFileSync(fixturePath,JSON.stringify(fixture,null,2));
sql(statements.join("\n"));
if(process.argv.includes("--refresh-session-only")){
  console.log(JSON.stringify({refreshedSyntheticSession:true,origin,
    preservedArtwork:true,privateFixture:fixturePath}));
  process.exit(0);
}
const [a,b]=fixture.users;
async function api(method,path,user,body,headers={}){
  const res=await fetch(origin+"/v1"+path,{method,headers:{
    ...(user?{Authorization:"Bearer "+user.accessToken}:{}),...headers,
    ...(body && !(body instanceof FormData)?{"Content-Type":"application/json"}:{})},
    body:body instanceof FormData?body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(20000)});
  const value=await res.json();return {status:res.status,body:value};
}
function png(width,height){
  const chunk=(name,data)=>{
    const type=Buffer.from(name),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([type,data]))>>>0);
    return Buffer.concat([len,type,data,crc]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);
  header[8]=8;header[9]=6;
  const pixels=Buffer.alloc((width*4+1)*height,255);
  for(let y=0;y<height;y++)pixels[y*(width*4+1)]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR",header),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
}
function form(bytes,fields){
  const body=new FormData();body.append("file",new Blob([bytes],{type:"image/png"}),"demo.png");
  for(const[k,v]of Object.entries(fields))body.append(k,String(v));return body;
}
async function room(user){
  const ticket=await api("POST","/postcards/realtime-ticket",user,{});
  assert.equal(ticket.status,201);
  const ws=new WebSocket(ticket.body.data.websocketUrl),events=[],pending=[];
  ws.on("message",raw=>{
    const value=JSON.parse(raw);const i=pending.findIndex(p=>p.type===value.type);
    if(i<0)events.push(value);else{const p=pending.splice(i,1)[0];clearTimeout(p.timer);p.resolve(value);}
  });
  const next=(type)=>{
    const i=events.findIndex(e=>e.type===type);if(i>=0)return Promise.resolve(events.splice(i,1)[0]);
    return new Promise((resolve,reject)=>{
      const waiter={type,resolve,timer:setTimeout(()=>reject(new Error("Room event timeout: "+type)),15000)};
      pending.push(waiter);
    });
  };
  await new Promise((resolve,reject)=>{ws.once("open",resolve);ws.once("error",reject);});
  await next("room.snapshot");
  return {ws,next};
}
assert.equal((await api("GET","/postcards",null)).status,401);
assert.equal((await api("GET","/postcards/capabilities",a)).body.data.privateDoodles,true);
const initial=await api("GET","/postcards/active-canvas",a);
if(initial.body.data){
  const owner=fixture.users.find(u=>u.userId===initial.body.data.senderId);
  await api("DELETE","/postcards/"+initial.body.data.postcardId,owner);
}
const aa=await room(a),bb=await room(b);
try{
  const raced=await Promise.all([a,b].map(u=>api("POST","/postcards/drafts",u,
    {width:1080,height:1440,backgroundColor:"#ffffff",kind:"shared_canvas"})));
  assert.deepEqual(raced.map(r=>r.status).sort(),[201,409]);
  const canvas=raced.find(r=>r.status===201).body.data;
  const owner=fixture.users.find(u=>u.userId===canvas.senderId),other=owner===a?b:a;
  const ownerRoom=owner===a?aa:bb,otherRoom=owner===a?bb:aa;
  ownerRoom.ws.send(JSON.stringify({type:"stroke.start",postcardId:canvas.postcardId,
    eventId:randomUUID(),baseRevision:0,strokeId:"demo-stroke",tool:"pen",color:"#ff6699",
    width:.01,point:{x:.2,y:.3}}));
  assert.equal((await otherRoom.next("stroke.start")).revision,1);
  ownerRoom.ws.send(JSON.stringify({type:"stroke.end",postcardId:canvas.postcardId,
    eventId:randomUUID(),baseRevision:1,strokeId:"demo-stroke"}));
  assert.equal((await otherRoom.next("stroke.end")).revision,2);
  assert.equal((await api("POST",`/postcards/${canvas.postcardId}/lock`,other,{revision:2})).status,403);
  const locked=await api("POST",`/postcards/${canvas.postcardId}/lock`,owner,{revision:2});
  assert.equal(locked.status,200);
  const closed=await api("POST",`/postcards/${canvas.postcardId}/close`,owner,
    form(png(1080,1440),{title:"Demo Tranh đôi",revision:2,lockId:locked.body.data.lockId}));
  assert.equal(closed.status,200);assert.equal(closed.body.data.status,"saved");
  const key=randomUUID(),image=png(1080,1080);
  const doodles=await Promise.all([1,2].map(()=>api("POST","/postcards/doodles",a,
    form(image,{source:"blank",caption:"Demo Doodle"}),{"Idempotency-Key":key})));
  assert(doodles.every(r=>[200,201].includes(r.status)));
  assert.equal(doodles[0].body.data.postcardId,doodles[1].body.data.postcardId);
  const doodle=doodles[0].body.data;
  const bytes=await fetch(origin+doodle.imageUrl,{headers:{Authorization:"Bearer "+b.accessToken}});
  assert.equal(bytes.status,200);assert(Buffer.from(await bytes.arrayBuffer()).equals(image));
  const latest=(await api("GET","/postcards/widget-state",b)).body.data;
  assert.equal(latest.doodle.postcardId,doodle.postcardId);
  assert.equal(latest.canvas.postcardId,canvas.postcardId);
  const report={origin,checkedAt:new Date().toISOString(),authenticated:true,
    singletonRace:true,ownerOnly:true,twoWebSocketDelivery:true,idempotentDoodle:true,
    privateR2Bytes:true,latestWidgetMetadata:true,fixtureOnly:true};
  fs.writeFileSync(".local/remote-smoke-report.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{aa.ws.close();bb.ws.close();}
