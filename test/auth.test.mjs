import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync}from'node:fs';import {tmpdir}from'node:os';import {join}from'node:path';import {once}from'node:events';
import http from 'node:http';
import {createApplication}from'../server.mjs';import {createAuth}from'../auth.mjs';
test('微信模式拒绝缺失配置',()=>assert.throws(()=>createAuth({mode:'wechat'}),/WECHAT_APP_ID/));
test('服务端换取身份、会话、权限和客户确认完整闭环（模拟微信响应）',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'richang-auth-')),file=join(dir,'db.json');let fail=false;
 const server=createApplication({mode:'wechat',file,authOptions:{appId:'test-app',appSecret:'private-test-secret',merchantOpenId:'wx-merchant',courierOpenId:'wx-courier',fetchImpl:async url=>{assert.equal(url.origin,'https://api.weixin.qq.com');assert.equal(url.searchParams.get('secret'),'private-test-secret');return {ok:true,json:async()=>fail?{errcode:40029}:{openid:'wx-'+url.searchParams.get('js_code'),session_key:'never-return-this'}};}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,{token,body,actor}={})=>{const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(actor?{'X-Demo-Actor':actor}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 try{
 assert.equal((await call('state',{actor:'merchant'})).status,401);
 const login=async code=>(await call('auth/wechat',{body:{code}})).data.token;
 const merchant=await login('merchant'),courier=await login('courier'),buyer=await login('a'),other=await login('b');assert.ok(buyer);
 const state=(await call('state',{token:buyer,actor:'merchant'})).data;assert.equal(state.me.role,'buyer');assert.equal(state.customers.length,0);assert.equal(state.orders.length,0);
 assert.equal((await call('action/product',{token:buyer,body:{name:'bad',price:100,stock:1,allergens:'测试'}})).status,400);
 const product=(await call('action/product',{token:merchant,body:{name:'测试面包',price:800,stock:2,allergens:'测试：小麦'}})).data;
 const code=(await call('action/binding-code',{token:buyer,body:{}})).data.code;
 await call('action/binding-request',{token:merchant,body:{code}});const request=(await call('state',{token:buyer})).data.bindingRequests[0];assert.ok(request);
 assert.equal((await call('action/binding-confirm',{token:other,body:{id:request.id}})).status,400);
 await call('action/binding-confirm',{token:buyer,body:{id:request.id}});
 const second=(await call('action/product',{token:merchant,body:{name:'第二款测试面包',price:350,allergens:''}})).data;
 const b={requestId:'test-request-12345678',items:[{productId:product.id,quantity:2},{productId:second.id,quantity:3}],buyerId:state.me.id,building:'东苑13栋',deliveryDay:'周三'};
 const order=(await call('action/order',{token:merchant,body:b})).data;assert.ok(order.id);assert.equal(order.total,2650);assert.equal(order.items.length,2);
 assert.equal((await call('action/order',{token:merchant,body:b})).data.id,order.id);
 assert.equal((await call('state',{token:merchant})).data.orders.length,1);
 assert.equal((await call('action/progress',{token:merchant,body:{id:order.id,confirmed:false,expectedStage:0}})).status,400);
 assert.equal((await call('state',{token:buyer})).data.orders[0].stage,0);
 assert.equal((await call('state',{token:other})).data.orders.length,0);
 for(const [expectedStage,token]of [merchant,courier,courier,buyer].entries()){const payload={id:order.id,confirmed:true,expectedStage};assert.equal((await call('action/progress',{token,body:payload})).status,200);assert.equal((await call('action/progress',{token,body:payload})).status,400);}
 const completed=(await call('state',{token:buyer})).data;assert.equal(completed.orders[0].stage,4);assert.equal(completed.notifications.length,5);assert.equal((await call('state',{token:other})).data.notifications.length,0);
 assert.equal((await call('action/review',{token:buyer,body:{id:order.id,rating:5,comment:'测试闭环'}})).status,200);
 const publicData=JSON.stringify((await call('state',{token:merchant})).data);assert.ok(!publicData.includes('wx-a'));assert.ok(!publicData.includes('session_key'));
 const {DatabaseSync}=await import('node:sqlite');const check=new DatabaseSync(file.replace('.json','.sqlite'),{readOnly:true});const store=check.prepare('SELECT data FROM app_state').get().data;check.close();assert.ok(!store.includes(buyer));assert.ok(!store.includes('private-test-secret'));assert.ok(!store.includes('never-return-this'));

 // 在请求体尚未发完时退出；此前收到的请求头不得保留旧会话授权。
 const slowBody=JSON.stringify({name:'不应保存'});
 const incoming=once(server,'request');
 let slow;
 const slowResult=new Promise((resolve,reject)=>{slow=http.request(base+'/api/action/profile',{method:'POST',headers:{Authorization:'Bearer '+buyer,'Content-Type':'application/json','Content-Length':Buffer.byteLength(slowBody)}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode))});slow.on('error',reject);slow.flushHeaders()});
 await incoming;
 await call('auth/logout',{token:buyer,body:{}});slow.end(slowBody);assert.equal(await slowResult,401);
 await call('auth/logout',{token:buyer,body:{}});assert.equal((await call('state',{token:buyer})).status,401);
 fail=true;assert.equal((await call('auth/wechat',{body:{code:'invalid'}})).status,400);
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('正式环境禁止误启演示身份服务',()=>{const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';try{assert.throws(()=>createApplication({mode:'demo'}),/禁止使用演示身份/)}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous}});
