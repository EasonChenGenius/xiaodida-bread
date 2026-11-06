import {randomBytes,scrypt as derive,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive),hash=t=>createHash('sha256').update(t).digest('hex');
const invalid=()=>Object.assign(Error('账号或密码不正确'),{status:401});
export function createWebAuth({now=Date.now}={}){
 const tokenFrom=req=>req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 const issue=(db,user)=>{const token=randomBytes(32).toString('base64url'),expiresAt=now()+8*3600000;db.authSessions=(db.authSessions||[]).filter(s=>s.actor!==user.id&&s.expiresAt>now());db.authSessions.push({hash:hash(token),actor:user.id,role:user.role,expiresAt,kind:'web'});return {token,expiresAt};};
 return {
 authenticate(req,db){const token=tokenFrom(req);if(!token)return null;const session=db.authSessions?.find(s=>s.hash===hash(token)&&s.kind==='web'&&s.expiresAt>now());if(!session)return null;const u=db.users.find(u=>u.id===session.actor);return u?.webCredential&&u.role===session.role?u.id:null;},
 async register(db,{username,password},role='buyer'){
  if(!['buyer','merchant','courier'].includes(role))throw Error('账号角色无效');
  if(typeof username!=='string'||!/^[a-zA-Z0-9_]{4,32}$/.test(username))throw Error('账号须为4至32位字母、数字或下划线');
  if(typeof password!=='string'||password.length<12||password.length>128)throw Error('密码须为12至128个字符');
  const key=username.toLowerCase();if(db.users.some(u=>u.webCredential?.username===key)||role!=='buyer'&&db.users.some(u=>u.id===role))throw Error('无法创建该账号，请更换账号或联系负责人');
  const salt=randomBytes(16).toString('hex'),digest=(await scrypt(password,salt,64)).toString('hex');
  const user={id:role==='buyer'?randomBytes(16).toString('hex'):role,role,name:role==='merchant'?'日尝手作商家':role==='courier'?'配送员':'新同学',boundAt:null,webCredential:{username:key,salt,digest}};
  db.users.push(user);return issue(db,user);
 },
 async login(db,{username,password}){
  const key=typeof username==='string'?username.toLowerCase():'';
  if(typeof password!=='string'||password.length>128)throw invalid();
  const user=db.users.find(u=>u.webCredential?.username===key),credential=user?.webCredential;
  const actual=await scrypt(password,credential?.salt||'00000000000000000000000000000000',64);
  if(!credential||!timingSafeEqual(actual,Buffer.from(credential.digest,'hex')))throw invalid();
  return issue(db,user);
 },
 logout(req,db){const token=tokenFrom(req);if(token)db.authSessions=(db.authSessions||[]).filter(s=>s.hash!==hash(token));}
 };
}
