import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApplication} from '../server.mjs';
import {initial} from '../domain.mjs';

// These exercise real local HTTP and SQLite; only WeChat's remote identity
// exchange is replaced. They do not establish live WeChat or MySQL acceptance.
const authOptions={appId:'test-cloud-app',appSecret:'test-only-cloud-secret',merchantOpenId:'test-openid-merchant',courierOpenId:'test-openid-courier',fetchImpl:async url=>({ok:true,json:async()=>({openid:'test-openid-'+url.searchParams.get('js_code'),session_key:'test-never-persist-session-key'})})};
async function launch(options){
 const server=createApplication({mode:'wechat',authOptions,notifierOptions:{templates:{}},...options});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 return {server,async stop(){await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));},async call(path,{token,body}={}){
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json()};
 }};
}

test('HTTP服务重启保留已提交会话、客户资料，公开响应不泄漏身份和会话哈希',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'xiaodida-http-restart-')),file=join(directory,'state.sqlite');
 let app;
 try{
  app=await launch({file});
  const buyer=await app.call('/api/auth/wechat',{body:{code:'buyer'}}),merchant=await app.call('/api/auth/wechat',{body:{code:'merchant'}});
  assert.equal(buyer.status,200);assert.equal(merchant.status,200);
  const token=buyer.data.token,merchantToken=merchant.data.token;
  assert.equal((await app.call('/api/action/profile',{token,body:{name:'测试同学重启验证'}})).status,200);
  const before=await app.call('/api/state',{token});assert.equal(before.data.me.name,'测试同学重启验证');
  const store=await app.server.ready,persisted=await store.getState();
  assert.equal(persisted.authSessions.length,2);
  assert.ok(!JSON.stringify(persisted).includes(token));
  await app.stop();app=undefined;
  app=await launch({file});
  const after=await app.call('/api/state',{token}),operator=await app.call('/api/state',{token:merchantToken});
  assert.equal(after.status,200);assert.equal(operator.status,200);
  assert.equal(after.data.me.id,before.data.me.id);assert.equal(after.data.me.name,'测试同学重启验证');assert.equal(operator.data.me.role,'merchant');
  const publicResponses=JSON.stringify([after.data,operator.data,(await app.call('/api/config')).data,(await app.call('/healthz')).data]);
  for(const value of [token,merchantToken,...persisted.authSessions.map(s=>s.hash),'test-openid-buyer','test-openid-merchant','test-only-cloud-secret','test-never-persist-session-key'])assert.ok(!publicResponses.includes(value),'public responses must not expose identity/session internals');
  assert.equal((await app.call('/api/state',{token:'x'.repeat(43)})).status,401);
 }finally{if(app)await app.stop();rmSync(directory,{recursive:true,force:true});}
});

test('两个HTTP实例即时读取对方的资料与会话撤销，重新登录不会保留旧会话',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'xiaodida-http-shared-')),file=join(directory,'state.sqlite');
 let first,second;
 try{
  first=await launch({file});second=await launch({file});
  const logged=await first.call('/api/auth/wechat',{body:{code:'shared-buyer'}}),token=logged.data.token;
  assert.equal(logged.status,200);assert.equal((await second.call('/api/state',{token})).status,200);
  assert.equal((await first.call('/api/action/profile',{token,body:{name:'测试实例甲更新'}})).status,200);
  assert.equal((await second.call('/api/state',{token})).data.me.name,'测试实例甲更新');
  assert.equal((await second.call('/api/action/profile',{token,body:{name:'测试实例乙更新'}})).status,200);
  assert.equal((await first.call('/api/state',{token})).data.me.name,'测试实例乙更新');
  const replacement=await second.call('/api/auth/wechat',{body:{code:'shared-buyer'}});
  assert.equal(replacement.status,200);assert.equal((await first.call('/api/state',{token})).status,401);
  const current=replacement.data.token;
  assert.equal((await first.call('/api/state',{token:current})).status,200);
  assert.equal((await second.call('/api/auth/logout',{token:current,body:{}})).status,200);
  assert.equal((await first.call('/api/state',{token:current})).status,401);
 }finally{if(second)await second.stop();if(first)await first.stop();rmSync(directory,{recursive:true,force:true});}
});

test('健康检查核验存储可用性，运行中数据库中断返回503且不暴露连接信息',async()=>{
 let offline=false;
 const db=initial({demo:false});
 const store={kind:'mysql',async getState(){if(offline)throw Error('test-db-password-at-private-host');return structuredClone(db);},async ping(){if(offline)throw Error('test-db-password-at-private-host');},async close(){}};
 const app=await launch({store,storeType:'mysql'});
 try{
  const healthy=await app.call('/healthz');assert.equal(healthy.status,200);assert.equal(healthy.data.ok,true);assert.equal(healthy.data.service,'xiaodida');
  offline=true;
  const unhealthy=await app.call('/healthz'),config=await app.call('/api/config');
  assert.equal(unhealthy.status,503);assert.equal(unhealthy.data.ok,false);assert.equal(config.status,503);
  assert.ok(!JSON.stringify([unhealthy,config]).includes('test-db-password-at-private-host'));
 }finally{await app.stop();}
});

test('存储初始化失败时健康检查和业务接口均拒绝服务',async()=>{
 const store={kind:'mysql',async getState(){throw Error('test-sensitive-connect-failure');},async close(){}};
 const app=await launch({store,storeType:'mysql'});
 try{
  assert.equal((await app.call('/healthz')).status,503);
  const state=await app.call('/api/state');assert.equal(state.status,503);assert.ok(!JSON.stringify(state).includes('test-sensitive-connect-failure'));
 }finally{await app.stop();}
});

test('正式环境禁止SQLite临时持久化，包括显式注入SQLite存储',()=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
 try{
  assert.throws(()=>createApplication({mode:'wechat',storeType:'sqlite',authOptions}),/MySQL/);
  assert.throws(()=>createApplication({mode:'wechat',storeType:'mysql',authOptions,store:{kind:'sqlite'}}),/MySQL/);
 }finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
