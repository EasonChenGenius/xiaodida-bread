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
 // Shared persistent budgets are updated even for rejected credentials by the HTTP layer.
 consumeBudget(db,{path,identity='',network='local'}){
  const until=now()+600000;db.webAuthLimits=(db.webAuthLimits||[]).filter(r=>r.until>now());
  for(const [key,limit]of [[hash('network:'+network),100],[hash(path+':'+String(identity).toLowerCase()),6]]){
   let entry=db.webAuthLimits.find(r=>r.key===key);if(!entry){entry={key,count:0,until};db.webAuthLimits.push(entry);}
   if(++entry.count>limit)throw Object.assign(Error('尝试次数过多，请10分钟后重试'),{status:429});
  }
 },
 requestRecovery(db,{username}){
  const id=randomBytes(16).toString('hex'),user=db.users.find(u=>u.webCredential?.username===String(username||'').toLowerCase());
  db.webRecoveryRequests=(db.webRecoveryRequests||[]).filter(r=>r.expiresAt>now()&&r.usedAt===undefined);
  if(user){db.webRecoveryRequests=db.webRecoveryRequests.filter(r=>r.actor!==user.id);db.webRecoveryRequests.push({id,actor:user.id,expiresAt:now()+86400000,createdAt:now(),attempts:0});}
  return {requestId:id,message:'如账号存在，已记录恢复申请。请联系平台负责人核验身份；本流程不会发送短信。'};
 },
 issueRecovery(db,{requestId,verifiedBy,reason}){
  if(typeof verifiedBy!=='string'||verifiedBy.trim().length<2||typeof reason!=='string'||reason.trim().length<4)throw Error('必须记录核验人员和核验说明');
  const request=db.webRecoveryRequests?.find(r=>r.id===requestId&&r.expiresAt>now()&&r.usedAt===undefined);
  if(!request)throw Error('恢复申请不存在或已过期');
  const token=randomBytes(32).toString('base64url');request.tokenHash=hash(token);request.tokenExpiresAt=now()+900000;request.attempts=0;
  db.webSecurityEvents??=[];db.webSecurityEvents.push({action:'recovery-approved',actor:request.actor,requestId,verifiedBy:verifiedBy.trim(),reason:reason.trim(),at:now()});
  return {requestId,token,expiresAt:request.tokenExpiresAt};
 },
 async resetPassword(db,{requestId,token,password}){
  const request=db.webRecoveryRequests?.find(r=>r.id===requestId&&r.usedAt===undefined&&r.expiresAt>now()&&r.tokenExpiresAt>now()&&r.attempts<5);
  if(!request)throw Error('恢复凭证无效、已使用或过期');
  request.attempts++;
  const supplied=typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)?hash(token):'0'.repeat(64);
  if(!request.tokenHash||!timingSafeEqual(Buffer.from(request.tokenHash,'hex'),Buffer.from(supplied,'hex')))throw Error('恢复凭证无效、已使用或过期');
  if(typeof password!=='string'||password.length<12||password.length>128)throw Error('新密码须为12至128个字符');
  const user=db.users.find(u=>u.id===request.actor&&u.webCredential);if(!user)throw Error('账号暂不可恢复，请联系负责人');
  const salt=randomBytes(16).toString('hex');user.webCredential={...user.webCredential,salt,digest:(await scrypt(password,salt,64)).toString('hex')};
  db.authSessions=(db.authSessions||[]).filter(s=>s.actor!==user.id);request.usedAt=now();delete request.tokenHash;
  db.webSecurityEvents??=[];db.webSecurityEvents.push({action:'password-reset',actor:user.id,requestId,at:now()});
  return {ok:true,message:'密码已更新，旧登录已失效，请重新登录'};
 },
 logout(req,db){const token=tokenFrom(req);if(token)db.authSessions=(db.authSessions||[]).filter(s=>s.hash!==hash(token));}
 };
}
