import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,statSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';import{createWebAuth}from'../web-auth.mjs';import{openStore}from'../storage.mjs';import{initial}from'../domain.mjs';
const script=fileURLToPath(new URL('../scripts/set-web-operator-password.mjs',import.meta.url));
const username='test_fake_merchant',oldPassword='synthetic-old-password',newPassword='synthetic-new-password';
function seed(dir,{role='merchant',name=username}={}){
 mkdirSync(join(dir,'data'),{recursive:true});
 const store=openStore(join(dir,'data/web.json'),()=>initial({demo:false}));
 let token;
 return store.transact(async db=>{const auth=createWebAuth();const session=await auth.register(db,{username:name,password:oldPassword},role);token=session.token;})
  .then(async()=>{store.close();writeFileSync(join(dir,'data','operator-'+role+'-1700000000000.json'),JSON.stringify({username:name,password:oldPassword,role},null,2),{mode:0o600});return token;});
}
function run(dir,args,over={},input){const env={...process.env,NODE_ENV:'development',BREAD_AUTH_MODE:'web',BREAD_STORE:'sqlite',...over};delete env.BREAD_OPERATOR_PASSWORD;return spawnSync(process.execPath,[script,...args],{cwd:dir,env,encoding:'utf8',input});}
function reopen(dir){return openStore(join(dir,'data/web.json'),()=>{throw Error('库应已存在')});}
function credentials(dir){const file=readdirSync(join(dir,'data')).find(f=>/^operator-(merchant|courier)-\d+\.json$/.test(f));return{file,path:join(dir,'data',file)};}

test('负责人改密：新密码可登录，旧密码与旧会话失效，凭据文件同步，密码不泄漏',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'web-operator-passwd-'));
 try{
  const oldToken=await seed(dir);
  const first=await run(dir,['--username',username,'--password',newPassword]);
  assert.equal(first.status,0,first.stderr);
  assert.ok(first.stdout.includes('已更新账号'),first.stdout);
  assert.ok(!first.stdout.includes(newPassword));assert.ok(!first.stderr.includes(newPassword));
  const store=reopen(dir);const db=await store.getState();const auth=createWebAuth();
  await assert.rejects(auth.login(db,{username,password:oldPassword}),/账号或密码不正确/);
  const session=await auth.login(db,{username,password:newPassword});assert.ok(session.token);
  assert.equal(db.users.find(u=>u.id==='merchant').role,'merchant');
  assert.ok(!JSON.stringify(db).includes(newPassword));assert.ok(!JSON.stringify(db).includes(oldPassword));
  assert.equal(auth.authenticate({headers:{authorization:'Bearer '+oldToken}},db),null);
  assert.equal(db.webSecurityEvents.at(-1).action,'owner-password-reset');
  store.close();
  const{path}=credentials(dir);const file=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(file.password,newPassword);assert.equal(file.role,'merchant');
  assert.equal(statSync(path).mode&0o777,0o600);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('负责人改密：密码可由标准输入提供，不出现在命令行参数里',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'web-operator-passwd-stdin-'));
 try{
  await seed(dir);
  const result=run(dir,['--username',username],{},newPassword+'\n');
  assert.equal(result.status,0,result.stderr);
  const store=reopen(dir);const db=await store.getState();const auth=createWebAuth();
  await assert.rejects(auth.login(db,{username,password:oldPassword}),/账号或密码不正确/);
  assert.ok((await auth.login(db,{username,password:newPassword})).token);store.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('负责人改密：拒绝非web模式、短密码、客户账号、不存在的账号及缺用户名',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'web-operator-passwd-deny-'));
 try{
  await seed(dir);
  assert.notEqual(run(dir,['--username',username,'--password',newPassword],{BREAD_AUTH_MODE:'demo'}).status,0);
  assert.notEqual(run(dir,['--username',username,'--password','short']).status,0);
  assert.notEqual(run(dir,['--username','no_such_account','--password',newPassword]).status,0);
  assert.notEqual(run(dir,['--password',newPassword]).status,0);
  const buyerDir=mkdtempSync(join(tmpdir(),'web-operator-passwd-buyer-'));
  try{await seed(buyerDir,{role:'buyer',name:'test_fake_buyer'});
   assert.notEqual(run(buyerDir,['--username','test_fake_buyer','--password',newPassword]).status,0);
  }finally{rmSync(buyerDir,{recursive:true,force:true});}
  const store=reopen(dir);const db=await store.getState();const auth=createWebAuth();
  assert.ok((await auth.login(db,{username,password:oldPassword})).token,'被拒绝的调用不得改动原密码');store.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
