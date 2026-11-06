import test from 'node:test';import assert from 'node:assert/strict';import {checkRelease}from'../scripts/release-check.mjs';
const project={appid:'wx1234567890abcdef',setting:{urlCheck:true}};
const env={BREAD_AUTH_MODE:'wechat',WECHAT_APP_ID:project.appid,WECHAT_APP_SECRET:'fake-secret-for-testing',WECHAT_MERCHANT_OPENID:'merchant',WECHAT_COURIER_OPENID:'courier',BREAD_STORE:'mysql',MYSQL_HOST:'database.internal',MYSQL_USER:'synthetic-user',MYSQL_PASSWORD:'synthetic-password',MYSQL_DATABASE:'xiaodida'};
const config={project,apiBase:'https://delivery.example.com',env};
test('发布检查拒绝测试身份、本机地址与关闭域名校验',()=>{for(const invalid of [{apiBase:'http://127.0.0.1:3100'},{project:{...project,appid:'wxdbaf941b2e6ae3b2'}},{privateProject:{setting:{urlCheck:false}}},{env:{...env,BREAD_AUTH_MODE:'demo'}},{apiBase:'https://localhost'},{apiBase:'https://192.168.1.2'},{apiBase:'https://delivery.example.com?secret=private'},{env:{...env,WECHAT_COURIER_OPENID:'merchant'}}])assert.equal(checkRelease({...config,...invalid}).passed,false)});
test('检查通过仅代表配置齐备，输出不泄漏密钥和身份配置值',()=>{const result=checkRelease(config);assert.equal(result.passed,true);assert.ok(result.manual.length);for(const value of [env.WECHAT_APP_SECRET,env.MYSQL_HOST,env.MYSQL_USER,env.MYSQL_PASSWORD,env.WECHAT_MERCHANT_OPENID,env.WECHAT_COURIER_OPENID])assert.ok(!JSON.stringify(result).includes(value));assert.match(result.note,/不代表已部署/)});
test('云托管发布检查需要环境和服务，完整云配置可不提供HTTPS地址',()=>{
 const cloud={...config,transport:'cloud',apiBase:undefined,cloudEnv:'synthetic-env',cloudService:'synthetic-service'};
 assert.equal(checkRelease(cloud).passed,true);
 assert.ok(checkRelease(cloud).manual.some(text=>text.includes('callContainer')));
 for(const invalid of [{cloudEnv:''},{cloudService:''},{cloudEnv:' env'},{cloudService:'https://service.invalid'},{transport:'unexpected'}])assert.equal(checkRelease({...cloud,...invalid}).passed,false);
 const result=JSON.stringify(checkRelease(cloud));
 assert.ok(!result.includes(cloud.cloudEnv));assert.ok(!result.includes(cloud.cloudService));
});
test('正式发布必须配置MySQL及完整凭据，拒绝系统库、演示库与非法端口',()=>{
 for(const key of ['BREAD_STORE','MYSQL_HOST','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE']){
  const missing={...env};delete missing[key];assert.equal(checkRelease({...config,env:missing}).passed,false,key);
 }
 for(const change of [{BREAD_STORE:'sqlite'},{MYSQL_HOST:'localhost'},{MYSQL_HOST:'https://database.invalid'},{MYSQL_HOST:'127.0.0.1'},{MYSQL_DATABASE:'nodejs_demo'},{MYSQL_DATABASE:'mysql'},{MYSQL_DATABASE:'sys'},{MYSQL_DATABASE:'information_schema'},{MYSQL_DATABASE:'performance_schema'},{MYSQL_DATABASE:'bad-name;select'},{MYSQL_PORT:'0'},{MYSQL_PORT:'65536'},{MYSQL_PORT:'3306extra'},{MYSQL_PORT:'1.5'}])assert.equal(checkRelease({...config,env:{...env,...change}}).passed,false);
 assert.equal(checkRelease({...config,env:{...env,MYSQL_PORT:'3306'}}).passed,true);
});
test('首次身份核验模式不能通过发布检查，操作员必须是两个独立账号',()=>{
 for(const value of ['true',true,'yes','1'])assert.equal(checkRelease({...config,env:{...env,WECHAT_ALLOW_UNASSIGNED_OPERATORS:value}}).passed,false);
 assert.equal(checkRelease({...config,env:{...env,WECHAT_ALLOW_UNASSIGNED_OPERATORS:'false'}}).passed,true);
 for(const change of [{WECHAT_MERCHANT_OPENID:''},{WECHAT_COURIER_OPENID:''},{WECHAT_COURIER_OPENID:'merchant'},{WECHAT_COURIER_OPENID:' courier'},{WECHAT_MERCHANT_OPENID:' '}])assert.equal(checkRelease({...config,env:{...env,...change}}).passed,false);
});
