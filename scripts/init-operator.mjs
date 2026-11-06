// Run locally with --env-file-if-exists=.env. This script resolves one account's
// identity only; it never creates users, grants roles or changes an allowlist.
import {createInterface} from 'node:readline/promises';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {resolveWeChatIdentity} from '../auth.mjs';
const {values}=parseArgs({options:{output:{type:'string',default:'data/operator-identity.json'},help:{type:'boolean',short:'h'}}});
if(values.help){
 console.log('在本机核验管理人员 OpenID（不授权角色）：node --env-file-if-exists=.env scripts/init-operator.mjs [--output 私密本机文件]。仅在终端提示后输入本小程序新取得的 wx.login code，不要放进命令历史或聊天。输出文件只允许当前用户读取，请勿提交 GitHub。');
}else{
 try{
  const appId=process.env.WECHAT_APP_ID,appSecret=process.env.WECHAT_APP_SECRET;
  if(!appId||!appSecret)throw Error('请先在后端私密环境中配置 WECHAT_APP_ID 和 WECHAT_APP_SECRET');
  const destination=resolve(values.output);
  const input=createInterface({input:process.stdin,output:process.stdout});
  let code;try{code=(await input.question('输入本小程序刚取得的 wx.login code（不会改变账号权限）：')).trim();}finally{input.close();}
  const openid=await resolveWeChatIdentity({appId,appSecret,code});
  mkdirSync(dirname(destination),{recursive:true,mode:0o700});
  writeFileSync(destination,JSON.stringify({appId,openid,verifiedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log('身份已核验，结果已写入指定私密本机文件。请本人核对账号后，在云托管后端环境变量中设置商家或配送员 OpenID；不要把文件内容发到聊天或 GitHub。');
 }catch(error){console.error(error.code==='EEXIST'?'输出文件已存在，请另选文件名，避免覆盖已有身份记录。':error.message);process.exitCode=1;}
}
