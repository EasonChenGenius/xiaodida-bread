import test from 'node:test';import assert from 'node:assert/strict';import {createNotifier,readTemplates}from'../notifications.mjs';
test('未配置不伪报微信发送成功，配置后仅调用真实微信接口并保留失败结果',async()=>{
 assert.deepEqual(await createNotifier().send({stage:2},'buyer'),{status:'unconfigured'});
 assert.throws(()=>readTemplates('{"2":{"id":"id","fields":{"thing1":"secret"}}}'));
 let code=0,calls=0;const n=createNotifier({appId:'app',secret:'secret',templates:{2:{id:'approved',fields:{thing1:'product',thing2:'location'}}},fetchImpl:async(url,options)=>{calls++;if(String(url).includes('/cgi-bin/token'))return {ok:true,json:async()=>({access_token:'private-token',expires_in:7200})};assert.ok(String(url).startsWith('https://api.weixin.qq.com/cgi-bin/message/subscribe/send'));const b=JSON.parse(options.body);assert.equal(b.touser,'buyer');assert.equal(b.data.thing1.value,'测试面包');return {ok:true,json:async()=>({errcode:code})};}});
 assert.deepEqual(n.groups,[['approved']]);assert.equal((await n.send({stage:2,product:'测试面包',location:'东苑1栋楼下货架'},'buyer')).status,'sent');code=43101;assert.deepEqual(await n.send({stage:2,product:'测试面包'},'buyer'),{status:'failed',code:43101});assert.equal(calls,3);
});
