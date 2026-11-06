import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAuth,resolveWeChatIdentity} from '../auth.mjs';
import {initial,view} from '../domain.mjs';
import {openStore} from '../storage.mjs';
const options={mode:'wechat',appId:'test-app',appSecret:'test-only-secret',merchantOpenId:'test-merchant',courierOpenId:'test-courier',fetchImpl:async url=>({ok:true,json:async()=>({openid:'test-'+url.searchParams.get('js_code'),session_key:'discard-this-session-key'})})};
const request=token=>({headers:{authorization:'Bearer '+token,'x-demo-actor':'merchant'}});

test('哈希会话写入 SQLite，重启及第二个认证实例仍可验证且不会暴露给前端',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'xiaodida-session-')),file=join(directory,'state.sqlite');
 let store=openStore(file,()=>initial({demo:false}));
 try{
  const db=store.load(),auth=createAuth(options),result=await auth.login(db,'buyer');
  assert.match(result.token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(db.authSessions.length,1);assert.match(db.authSessions[0].hash,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(db).includes(result.token));assert.ok(!JSON.stringify(db).includes('discard-this-session-key'));
  assert.ok(!JSON.stringify(view(db,db.users[0].id)).includes(db.authSessions[0].hash));
  store.save(db);store.close();store=openStore(file,()=>assert.fail('不得重建已有身份'));
  const restored=store.load(),restarted=createAuth(options),secondInstance=createAuth(options);
  assert.equal(restarted.authenticate(request(result.token),restored),restored.users[0].id);
  assert.equal(secondInstance.authenticate(request(result.token),restored),restored.users[0].id);
  restarted.logout(request(result.token),restored);store.save(restored);
  assert.equal(secondInstance.authenticate(request(result.token),store.load()),null);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('重复登录撤销此前会话，到期或伪造 token 均不可使用',async()=>{
 let clock=1000;const auth=createAuth({...options,now:()=>clock}),db=initial({demo:false});
 const first=await auth.login(db,'buyer'),second=await auth.login(db,'buyer');
 assert.equal(auth.authenticate(request(first.token),db),null);assert.equal(db.authSessions.length,1);
 assert.equal(auth.authenticate(request(second.token),db),db.users[0].id);
 assert.equal(auth.authenticate(request('x'.repeat(43)),db),null);
 assert.equal(auth.authenticate({headers:{'x-demo-actor':'merchant'}},db),null);
 clock=second.expiresAt;assert.equal(auth.authenticate(request(second.token),db),null);
 assert.equal(auth.authenticate(request(second.token)),null);
});

test('允许名单变化即时撤销旧商家与配送员权限，不能由登录请求自行升级',async()=>{
 const auth=createAuth(options),db=initial({demo:false});
 const merchant=await auth.login(db,'merchant'),courier=await auth.login(db,'courier');
 assert.equal(auth.authenticate(request(merchant.token),db),'merchant');
 const changed=createAuth({...options,merchantOpenId:'test-newmerchant',courierOpenId:'test-newcourier'});
 assert.equal(changed.authenticate(request(merchant.token),db),null);
 assert.equal(changed.authenticate(request(courier.token),db),null);
 await assert.rejects(()=>changed.login(db,'merchant'),/权限配置已变更/);
 await assert.rejects(()=>changed.login(db,'newmerchant'),/受控迁移/);
 assert.equal(db.users.length,2);
});

test('首次身份核验须显式启用；首位登录仅是客户且商家与配送员不能同一身份',async()=>{
 assert.throws(()=>createAuth({mode:'wechat',appId:'test-app',appSecret:'test-only-secret'}),/WECHAT_MERCHANT_OPENID/);
 assert.throws(()=>createAuth({...options,merchantOpenId:'same',courierOpenId:'same'}),/不同的微信身份/);
 const auth=createAuth({...options,merchantOpenId:undefined,courierOpenId:undefined,allowUnassignedOperators:true}),db=initial({demo:false});
 const first=await auth.login(db,'first'),second=await auth.login(db,'second');
 assert.equal(db.users[0].role,'buyer');assert.equal(db.users[1].role,'buyer');
 assert.notEqual(auth.authenticate(request(first.token),db),'merchant');
 assert.notEqual(auth.authenticate(request(second.token),db),'courier');
});

test('身份换取失败不创建用户或会话，微信 session_key 不流出身份解析接口',async()=>{
 const db=initial({demo:false});
 const auth=createAuth({...options,fetchImpl:async()=>({ok:true,json:async()=>({errcode:40029,errmsg:'private-response'})})});
 await assert.rejects(()=>auth.login(db,'invalid'),/凭证无效/);assert.equal(db.users.length,0);assert.equal(db.authSessions,undefined);
 const result=await resolveWeChatIdentity({...options,code:'buyer'});assert.equal(result,'test-buyer');
 await assert.rejects(()=>resolveWeChatIdentity({...options,code:'x',fetchImpl:async()=>{throw Error('secret upstream details')}}),/暂不可用/);
});
