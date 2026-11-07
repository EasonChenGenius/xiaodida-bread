// Owner-only maintenance operation, never exposed as an HTTP route.
import{parseArgs}from'node:util';import{mkdirSync,writeFileSync}from'node:fs';import{createWebAuth}from'../web-auth.mjs';import{openWebStore}from'./web-store.mjs';
const {values}=parseArgs({options:{request:{type:'string'},verifier:{type:'string'},reason:{type:'string'}}});
if(!/^[a-f0-9]{32}$/.test(values.request||'')||!values.verifier||!values.reason)throw Error('需要 --request 申请编号 --verifier 核验人员 --reason 核验说明；禁止跳过本人身份核验');
const store=await openWebStore();
try{const result=await store.transact(db=>createWebAuth().issueRecovery(db,{requestId:values.request,verifiedBy:values.verifier,reason:values.reason}));mkdirSync('data',{recursive:true,mode:0o700});const file='data/recovery-'+values.request+'-'+Date.now()+'.json';writeFileSync(file,JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});console.log('核验凭证已写入本机私密文件 '+file+'，15分钟有效、仅一次使用。请安全交付已核验的本人，不要发到群聊或GitHub。');}finally{await store.close();}
