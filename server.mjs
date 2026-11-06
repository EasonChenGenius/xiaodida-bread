import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {initial,mutate,view,migrate} from './domain.mjs';
import {createNotifier,readTemplates} from './notifications.mjs';
import {openStore} from './storage.mjs';
import {createAuth} from './auth.mjs';
import {createWebAuth} from './web-auth.mjs';
import {initialCloudState} from './seed-products.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export function createApplication({mode=process.env.BREAD_AUTH_MODE||'demo',file=join(root,'data',mode==='demo'?'demo.json':mode+'.json'),store:injectedStore,storeType=process.env.BREAD_STORE||'sqlite',authOptions={},notifierOptions={}}={}){
 if(process.env.NODE_ENV==='production'&&!['wechat','web'].includes(mode))throw Error('正式环境禁止使用演示身份，请配置微信模式');
 if(process.env.NODE_ENV==='production'&&(storeType!=='mysql'||(injectedStore&&injectedStore.kind!=='mysql')))throw Error('正式环境必须使用 MySQL 持久化');
 const notifier=createNotifier({templates:mode==='wechat'?readTemplates():{},...notifierOptions});
 const auth=mode==='web'?createWebAuth():createAuth({mode,appId:process.env.WECHAT_APP_ID,appSecret:process.env.WECHAT_APP_SECRET,merchantOpenId:process.env.WECHAT_MERCHANT_OPENID,courierOpenId:process.env.WECHAT_COURIER_OPENID,allowUnassignedOperators:process.env.WECHAT_ALLOW_UNASSIGNED_OPERATORS==='true',...authOptions});
 const ready=(async()=>{
  const store=injectedStore||(storeType==='sqlite'?openStore(file,()=>initial({demo:mode==='demo'})):storeType==='mysql'?await (await import('./mysql-store.mjs')).openMySqlStore({config:{host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE},create:initialCloudState}):null);
  if(!store)throw Error('BREAD_STORE 配置无效');
  const db=await store.getState();if(db.demo!==(mode==='demo')){await store.close();throw Error('请使用独立数据库，不能混入演示身份');}return store;
 })();ready.catch(()=>{});
 const limits=new Map();let queue=Promise.resolve();
 const server=http.createServer(async(req,res)=>{
  const json=(status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/healthz'){try{const store=await ready;await store.ping?.();return json(200,{ok:true,service:'xiaodida',version:'0.10.0',mode,storage:storeType});}catch{return json(503,{ok:false,error:'存储未就绪'});}}
  if(url.pathname.startsWith('/api/')){
   let store,db;try{store=await ready;db=await store.getState();migrate(db);}catch{return json(503,{error:'配送服务暂不可用，请稍后重试'});}
   if(req.method==='GET'&&url.pathname==='/api/config')return json(200,{version:'0.10.0',mode,subscriptionGroups:mode==='wechat'?notifier.groups:[]});
   const actor=auth.authenticate(req,db);
   const publicLogin=mode==='web'&&['/api/auth/register','/api/auth/password'].includes(url.pathname)||mode==='wechat'&&url.pathname==='/api/auth/wechat';
   if(!publicLogin&&!actor)return json(401,{error:'请先登录，或登录已过期'});
   if(req.method==='GET'&&url.pathname==='/api/state')return json(200,view(db,actor));
   if(req.method!=='POST')return json(405,{error:'方法不支持'});
   try{
    const ip=req.socket.remoteAddress,now=Date.now();for(const [key,v]of limits)if(v.until<=now)limits.delete(key);
    const limit=limits.get(ip)||{count:0,until:now+60000};limits.set(ip,limit);if(++limit.count>(mode==='web'&&publicLogin?10:100))return json(429,{error:'操作频繁，请稍后重试'});
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)throw Error('请求过大');}
    const body=JSON.parse(raw||'{}');if(!body||typeof body!=='object'||Array.isArray(body))throw Error('请求格式无效');
    const run=queue.then(async()=>{
     const fresh=[];
     const result=await store.transact(async draft=>{
      migrate(draft);
      if(!publicLogin&&auth.authenticate(req,draft)!==actor)throw Object.assign(Error('请重新登录后重试'),{status:401});
      if(url.pathname==='/api/auth/logout'){auth.logout(req,draft);return {ok:true};}
      const previous=new Set(draft.notifications.map(n=>n.id));let result;
      if(mode==='web'&&url.pathname==='/api/auth/register')result=await auth.register(draft,body);
      else if(mode==='web'&&url.pathname==='/api/auth/password')result=await auth.login(draft,body);
      else if(mode==='wechat'&&url.pathname==='/api/auth/wechat')result=await auth.login(draft,body.code);
      else if(url.pathname.startsWith('/api/action/')){if(mode!=='demo'&&url.pathname==='/api/action/order'&&!body.requestId)throw Error('缺少建单请求标识，请刷新客户端重试');result=mutate(draft,actor,url.pathname.slice('/api/action/'.length),body);}
      else throw Error('接口不存在');
      for(const n of draft.notifications.filter(n=>!previous.has(n.id))){n.push={status:mode==='wechat'?'sending':mode==='web'?'in_app':'demo'};fresh.push({notification:structuredClone(n),openid:draft.users.find(u=>u.id===n.buyerId)?.openid});}
      return result;
     });
     // Only this committing request sends its new notifications. Unknown outcomes are not retried automatically.
     for(const {notification,openid}of fresh){if(mode!=='wechat')continue;let push;try{push=await notifier.send(notification,openid);}catch{push={status:'failed',error:'通知发送失败'};}
      try{await store.transact(draft=>{const n=draft.notifications.find(n=>n.id===notification.id);if(n?.push?.status==='sending')n.push=push;});}catch{console.error('notification_result_persist_failed');}
     }return result;
    });queue=run.catch(()=>{});return json(200,await run);
   }catch(e){const infra=!!e.code||/数据已被其他进程/.test(e.message);return json(e.status===401?401:infra?503:400,{error:infra?'服务繁忙，请保留表单稍后重试':e instanceof SyntaxError?'请求格式无效':e.message});}
  }
  if(mode==='wechat')return json(404,{error:'请通过微信小程序使用'});
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/logo.png':'logo.png'};if(!files[url.pathname])return json(404,{error:'接口不存在'});
  try{if(url.pathname==='/logo.png'){res.setHeader('Content-Type','image/png');return res.end(readFileSync(join(root,'miniprogram/assets/platform-logo.png')));}
   res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(readFileSync(join(root,'web',files[url.pathname])));
  }catch{json(500,{error:'页面暂不可用'});}
 });
 server.ready=ready;server.on('close',()=>ready.then(store=>store.close()).catch(()=>{}));return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||process.env.BREAD_PORT||3100),host=process.env.BREAD_HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1');
 const server=createApplication();await server.ready;server.listen(port,host,()=>console.log('校递达配送服务已就绪 · '+(process.env.BREAD_AUTH_MODE||'demo')+' · '+host+':'+port));
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>process.exit(0)));
}
