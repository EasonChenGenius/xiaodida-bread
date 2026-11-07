import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createWebAuth} from '../web-auth.mjs';
import {initial,mutate,view} from '../domain.mjs';
import {createApplication} from '../server.mjs';
const jpeg='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDg6KKK5jxwooooAKKKKACiiigD/9k=';
test('客户密码六位边界、密码恢复一致，操作员仍须十二位',async()=>{
 const db=initial({demo:false}),auth=createWebAuth();
 await assert.rejects(auth.register(db,{username:'short_user',password:'Abc5!'}),/6至128/);
 const session=await auth.register(db,{username:'six_user',password:'Abc6!?'});
 assert.equal(db.users[0].role,'buyer');assert.ok(!JSON.stringify(db).includes('Abc6!?'));
 assert.ok((await auth.login(db,{username:'six_user',password:'Abc6!?'})).token);
 await assert.rejects(auth.register(db,{username:'long_user',password:'x'.repeat(129)}),/6至128/);
 await assert.rejects(auth.register(db,{username:'operator',password:'Abc6!?'},'merchant'),/12至128/);
 await auth.register(db,{username:'operator',password:'TEST-operator-12'},'merchant');
 const recovery=auth.requestRecovery(db,{username:'six_user'}),proof=auth.issueRecovery(db,{requestId:recovery.requestId,verifiedBy:'虚构核验员',reason:'仅测试账号恢复'});
 await assert.rejects(auth.resetPassword(db,{...proof,password:'12345'}),/6至128/);
 await auth.resetPassword(db,{...proof,password:'New6!?'});
 assert.ok((await auth.login(db,{username:'six_user',password:'New6!?'})).token);
 await assert.rejects(auth.login(db,{username:'six_user',password:'Abc6!?'}),/账号或密码/);
});
test('头像只修改本人，拒绝URL、SVG、非法和超大图片，其他账号不可读取',async()=>{
 const db=initial({demo:false}),auth=createWebAuth();
 await auth.register(db,{username:'avatar_one',password:'Test6!'});await auth.register(db,{username:'avatar_two',password:'Test6!'});
 const [a,b]=db.users;
 for(const avatar of ['leaf','bread','sun','',jpeg]){mutate(db,a.id,'avatar',{avatar,id:b.id});assert.equal(view(db,a.id).me.avatar,avatar);assert.equal(view(db,b.id).me.avatar,'');}
 const previous=a.avatar;
 for(const avatar of ['https://example.com/avatar.jpg','data:image/svg+xml,<svg/>','data:image/jpeg;base64,AAAA',jpeg+'A'.repeat(12000),null,{}])assert.throws(()=>mutate(db,a.id,'avatar',{avatar}),/头像/);
 assert.equal(a.avatar,previous);assert.throws(()=>mutate(db,'unknown','avatar',{avatar:'leaf'}),/登录/);
});
test('HTTP六位注册、头像和姓名保存后重启保留，匿名与其他账号无法越权',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'xiaodida-profile-'));let server,base;
 const start=async()=>{server=createApplication({mode:'web',file:join(dir,'state.sqlite')});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;};
 const stop=async()=>{await new Promise(r=>server.close(r));};
 const call=async(path,body,token)=>{const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body?JSON.stringify(body):undefined});return{status:response.status,data:await response.json()};};
 try{
  await start();assert.equal((await call('action/avatar',{avatar:'leaf'})).status,401);
  assert.equal((await call('auth/register',{username:'too_short',password:'12345'})).status,400);
  const a=await call('auth/register',{username:'profile_a',password:'Test6!'}),b=await call('auth/register',{username:'profile_b',password:'Test6!'});assert.equal(a.status,200);const token=a.data.token;
  assert.equal((await call('action/profile',{name:' 虚构姓名 '},token)).status,200);
  assert.equal((await call('action/avatar',{avatar:jpeg,actor:'merchant'},token)).status,200);
  assert.equal((await call('state',null,b.data.token)).data.me.avatar,'');
  assert.equal((await call('action/avatar',{avatar:'data:image/svg+xml,<svg/>'},token)).status,400);
  await stop();await start();const current=(await call('state',null,token)).data;assert.equal(current.me.name,'虚构姓名');assert.equal(current.me.avatar,jpeg);assert.equal(current.me.role,'buyer');assert.ok(!JSON.stringify(current).includes('webCredential'));
 }finally{if(server?.listening)await stop();rmSync(dir,{recursive:true,force:true});}
});
