import {randomBytes,createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const tokenFrom=req=>req.headers?.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
const invalidConfiguration=()=>Error('微信模式需要 WECHAT_APP_ID、WECHAT_APP_SECRET 和 WECHAT_MERCHANT_OPENID；首次身份核验可显式启用 WECHAT_ALLOW_UNASSIGNED_OPERATORS=true（所有未配置账号仍仅为客户）');

// Only a server-side operator allowlist assigns a privileged role. A login code
// never carries a client-selected role and the first login has no special rights.
export async function resolveWeChatIdentity({appId,appSecret,code,fetchImpl=fetch}){
 if(typeof code!=='string'||!code.trim()||code.length>256)throw Error('缺少微信登录凭证，请重新登录');
 const url=new URL('https://api.weixin.qq.com/sns/jscode2session');
 url.search=new URLSearchParams({appid:appId,secret:appSecret,js_code:code,grant_type:'authorization_code'}).toString();
 let data;
 try{
  const res=await fetchImpl(url,{signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error();
  data=await res.json();
 }catch{throw Error('微信登录服务暂不可用，请稍后重试');}
 if(!data||data.errcode||typeof data.openid!=='string'||!data.openid||data.openid.length>128)throw Error('微信登录凭证无效或已使用，请重试');
 // session_key is intentionally discarded and never persisted or returned.
 return data.openid;
}
export function createAuth({mode='demo',appId,appSecret,merchantOpenId,courierOpenId,allowUnassignedOperators=false,fetchImpl=fetch,now=Date.now}={}){
 if(!['demo','wechat'].includes(mode))throw Error('BREAD_AUTH_MODE 必须为 demo 或 wechat');
 if(mode==='wechat'&&(!appId||!appSecret||(!merchantOpenId&&allowUnassignedOperators!==true)))throw invalidConfiguration();
 if(mode==='wechat'&&merchantOpenId&&merchantOpenId===courierOpenId)throw Error('商家与配送员须配置不同的微信身份');
 const roleFor=openid=>openid===merchantOpenId?'merchant':openid===courierOpenId?'courier':'buyer';
 const validUser=user=>user&&user.role===roleFor(user.openid)&&
  (user.role==='buyer'?!['merchant','courier'].includes(user.id):user.id===user.role);
 return {
 mode,
 authenticate(req,db){
  if(mode==='demo'){
   const actor=req.headers?.['x-demo-actor'];return ['merchant','courier','buyer-a','buyer-b'].includes(actor)?actor:null;
  }
  const token=tokenFrom(req);if(!token||!db)return null;
  const session=db.authSessions?.find(s=>s.hash===digest(token));
  if(!session||!Number.isFinite(session.expiresAt)||session.expiresAt<=now())return null;
  const user=db.users.find(u=>u.id===session.actor);
  // A changed server allowlist immediately removes old-session privileges.
  if(!validUser(user)||session.role!==user.role)return null;
  return user.id;
 },
 async login(db,code){
  if(mode!=='wechat')throw Error('本机演示模式无需微信登录');
  const openid=await resolveWeChatIdentity({appId,appSecret,code,fetchImpl});
  const role=roleFor(openid);
  let user=db.users.find(u=>u.openid===openid);
  if(user&&!validUser(user))throw Error('账号权限配置已变更，请联系管理员处理');
  if(!user){
   if(role!=='buyer'&&db.users.some(u=>u.id===role))throw Error('管理人员已存在，变更身份需先完成受控迁移');
   user={id:role==='buyer'?randomBytes(16).toString('hex'):role,openid,role,name:role==='buyer'?'同学 '+randomBytes(2).toString('hex'):role==='merchant'?'日尝手作商家':'配送员',boundAt:null};db.users.push(user);
  }
  const token=randomBytes(32).toString('base64url'),expiresAt=now()+8*3600000;
  db.authSessions=(db.authSessions||[]).filter(s=>s.expiresAt>now()&&s.actor!==user.id);
  db.authSessions.push({hash:digest(token),actor:user.id,role:user.role,expiresAt});
  return {token,expiresAt};
 },
 logout(req,db){
  const token=tokenFrom(req);
  if(token&&db)db.authSessions=(db.authSessions||[]).filter(s=>s.hash!==digest(token));
 }
 };
}
