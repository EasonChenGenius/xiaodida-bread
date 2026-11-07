import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApplication} from '../server.mjs';
import {createWebAuth} from '../web-auth.mjs';
import {buildRelease} from '../scripts/build-release.mjs';
async function app(){const dir=mkdtempSync(join(tmpdir(),'xiaodida-portals-'));const server=createApplication({mode:'web',file:join(dir,'state.sqlite')});server.listen(0,'127.0.0.1');await once(server,'listening');return{server,base:'http://127.0.0.1:'+server.address().port,close:async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}};}
test('三入口直达和刷新均可用，资源使用绝对路径，操作员入口不提供客户注册',async()=>{
 const a=await app();try{
  for(const role of ['customer','merchant','courier']){
   const response=await fetch(a.base+'/'+role+'/');assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes('data-portal="'+role+'"'));assert.ok(html.includes('href="/style.css"'));assert.ok(html.includes('src="/app.js"'));assert.ok(!html.includes('<!--PORTAL_INTRO-->'));
   assert.equal(/value="register" class="secondary" hidden/.test(html),role!=='customer');
   assert.ok(html.includes('href="/customer/"'));assert.ok(html.includes('href="/merchant/"'));assert.ok(html.includes('href="/courier/"'));
   const redirect=await fetch(a.base+'/'+role,{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/'+role+'/');
  }
  assert.equal((await fetch(a.base+'/')).status,200);
  for(const asset of ['/app.js','/style.css','/logo.png'])assert.equal((await fetch(a.base+asset)).status,200);
  assert.equal((await fetch(a.base+'/merchant/',{method:'POST'})).status,405);assert.equal((await fetch(a.base+'/customer/../missing/')).status,404);
 }finally{await a.close();}
});
test('服务端校验入口与账号角色，错入口不撤销原会话，公开注册不能得到工作台权限',async()=>{
 const a=await app();try{
  const store=await a.server.ready;await store.transact(async db=>{const auth=createWebAuth();await auth.register(db,{username:'portal_merchant',password:'TEST-merchant-123'},'merchant');await auth.register(db,{username:'portal_courier',password:'TEST-courier-123'},'courier');});
  const call=async(path,body,token)=>{const r=await fetch(a.base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||''),'X-Demo-Actor':'merchant'},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};};
  const buyer=await call('auth/register',{username:'portal_buyer',password:'Test6!',portal:'customer',role:'merchant'});assert.equal(buyer.status,200);assert.equal((await call('state',null,buyer.data.token)).data.me.role,'buyer');
  const wrong=await call('auth/password',{username:'portal_buyer',password:'Test6!',portal:'merchant'});assert.equal(wrong.status,403);assert.match(wrong.data.error,/不属于当前入口/);assert.equal((await call('state',null,buyer.data.token)).status,200);
  assert.equal((await call('auth/register',{username:'forged_operator',password:'TEST-not-operator',portal:'merchant'})).status,400);
  const merchant=await call('auth/password',{username:'portal_merchant',password:'TEST-merchant-123',portal:'merchant'});assert.equal(merchant.status,200);assert.equal((await call('state',null,merchant.data.token)).data.me.role,'merchant');
  const courier=await call('auth/password',{username:'portal_courier',password:'TEST-courier-123',portal:'courier'});assert.equal(courier.status,200);assert.equal((await call('state',null,courier.data.token)).data.me.role,'courier');
  assert.equal((await call('auth/password',{username:'portal_merchant',password:'TEST-merchant-123',portal:'courier'})).status,403);
  assert.equal((await call('action/product',{name:'TEST-injected',price:1,allergens:'TEST'},buyer.data.token)).status,400);
  await call('auth/logout',{},buyer.data.token);assert.equal((await call('state',null,buyer.data.token)).status,401);assert.equal((await call('state',null,merchant.data.token)).status,200);assert.equal((await call('state',null,courier.data.token)).status,200);
 }finally{await a.close();}
});
test('更新包包含三个角色入口文件，保持共用后台与资源',()=>{const dir=mkdtempSync(join(tmpdir(),'xiaodida-portal-package-'));try{buildRelease(join(dir,'release'));const m=JSON.parse(readFileSync(join(dir,'release/MANIFEST.json')));for(const role of ['customer','merchant','courier'])assert.ok(m.files.some(f=>f.path==='backend/web/'+role+'/index.html'));assert.equal(m.files.filter(f=>f.path==='backend/server.mjs').length,1);}finally{rmSync(dir,{recursive:true,force:true});}});
