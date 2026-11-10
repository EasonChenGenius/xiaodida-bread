// Owner-only maintenance operation. Never exposed as an HTTP route.
// scrypt parameters MUST stay identical to web-auth.mjs; test/web-operator-password.test.mjs verifies compatibility by logging in.
import {randomBytes,scrypt as derive} from 'node:crypto';
import {promisify} from 'node:util';
import {parseArgs} from 'node:util';
import {readdirSync,readFileSync,writeFileSync,chmodSync,existsSync} from 'node:fs';
import {openWebStore} from './web-store.mjs';
const scrypt=promisify(derive),normalize=value=>typeof value==='string'?value.trim().normalize('NFC').toLowerCase():'';
const {values}=parseArgs({options:{username:{type:'string'},password:{type:'string'}}});
const username=normalize(values.username);
async function readAllStdin(){const parts=[];for await(const chunk of process.stdin)parts.push(chunk);return Buffer.concat(parts).toString('utf8').replace(/\r?\n$/,'');}
async function promptHidden(label){
 process.stdout.write(label);
 if(!process.stdin.isTTY)throw Error('非交互终端请用标准输入提供新密码');
 return await new Promise((resolve,reject)=>{
  const stdin=process.stdin;let value='';
  const finish=error=>{stdin.removeListener('data',onData);stdin.setRawMode(false);stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);};
  const onData=chunk=>{for(const ch of chunk.toString('utf8')){
   if(ch==='\r'||ch==='\n')return finish();
   if(ch==='\u0003')return finish(Error('已取消'));
   if(ch==='\u007f'||ch==='\b'){if(value){value=value.slice(0,-1);process.stdout.write('\b \b');}continue;}
   if(ch>=' '&&ch!=='\u007f'){value+=ch;process.stdout.write('*');}
  }};
  stdin.setRawMode(true);stdin.resume();stdin.on('data',onData);
 });
}
let password=values.password??process.env.BREAD_OPERATOR_PASSWORD;
if(password===undefined){
 if(process.stdin.isTTY){const first=await promptHidden('请输入新密码（至少12位，输入不显示）：'),second=await promptHidden('请再输入一次新密码：');if(first!==second)throw Error('两次输入的新密码不一致');password=first;}
 else password=await readAllStdin();
}
if(process.env.BREAD_AUTH_MODE!=='web')throw Error('须显式设置 BREAD_AUTH_MODE=web，禁止在演示或微信模式下改操作员密码');
if(!username)throw Error('须用 --username 指定要改密的商家或配送员账号');
if(typeof password!=='string'||password.length<12||password.length>128||/[\r\n]/.test(password))throw Error('新密码须为12至128个字符且不含换行；操作员密码不得短于12位');
const store=await openWebStore();
try{
 const result=await store.transact(async db=>{
  const user=(db.users||[]).find(u=>normalize(u.webCredential?.username)===username);
  if(!user||!['merchant','courier'].includes(user.role))throw Error('账号不存在或不是商家/配送员操作员；本工具不能修改客户账号');
  const salt=randomBytes(16).toString('hex'),digest=(await scrypt(password,salt,64)).toString('hex');
  user.webCredential={...user.webCredential,salt,digest};
  const before=(db.authSessions||[]).length;
  db.authSessions=(db.authSessions||[]).filter(s=>s.actor!==user.id);
  db.webRecoveryRequests=(db.webRecoveryRequests||[]).filter(r=>r.usedAt!==undefined||r.actor!==user.id);
  db.webSecurityEvents??=[];db.webSecurityEvents.push({action:'owner-password-reset',actor:user.id,at:Date.now()});
  return{role:user.role,revoked:before-db.authSessions.length};
 });
 const synced=[];
 if(existsSync('data'))for(const file of readdirSync('data').filter(f=>/^operator-(merchant|courier)-\d+\.json$/.test(f))){
  const path='data/'+file;let record;try{record=JSON.parse(readFileSync(path,'utf8'));}catch{continue;}
  if(normalize(record.username)===username){writeFileSync(path,JSON.stringify({...record,password},null,2),{mode:0o600});chmodSync(path,0o600);synced.push(file);}
 }
 console.log('已更新账号 '+username+'（'+result.role+'）：撤销旧登录 '+result.revoked+' 个，同步 0600 凭据文件 '+synced.length+' 个。');
 console.log('新密码未写入聊天、GitHub、日志或数据库。若曾在命令行传入密码，请执行 history -c 并清屏；不要截图或转发终端。');
}finally{await store.close();}
