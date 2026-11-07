// Run only by the backend owner. Never accepts a role from a browser request.
import {randomBytes} from 'node:crypto';import {mkdirSync,writeFileSync}from'node:fs';import {createWebAuth}from'../web-auth.mjs';import{openWebStore}from'./web-store.mjs';
const role=process.argv[2],username=process.argv[3];
if(process.env.BREAD_AUTH_MODE!=='web'||!['merchant','courier'].includes(role))throw Error('须显式设置网页模式，并指定 merchant 或 courier 以及账号');
const store=await openWebStore();
const password=randomBytes(24).toString('base64url'),destination='data/operator-'+role+'-'+Date.now()+'.json';
try{mkdirSync('data',{recursive:true,mode:0o700});await store.transact(async db=>{await createWebAuth().register(db,{username,password},role);});writeFileSync(destination,JSON.stringify({username,password,role},null,2),{mode:0o600,flag:'wx'});console.log('已创建账号；凭据仅保存在本机私密文件 '+destination+'，请由本人安全交付，勿上传或粘贴到聊天。');}finally{await store.close();}
