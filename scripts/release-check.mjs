import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {readTemplates} from '../notifications.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function checkRelease({project,privateProject={},apiBase,transport='http',cloudEnv,cloudService,env={}}){
 const checks=[];const add=(name,ok,fix)=>checks.push({name,ok:!!ok,...(!ok?{fix}:{})});
 const realId=/^wx[0-9a-f]{16}$/i.test(project.appid||'')&&project.appid!=='wxdbaf941b2e6ae3b2';
 add('正式AppID',realId,'将工具测试AppID替换为你已注册小程序的AppID');
 add('前后端AppID一致',realId&&env.WECHAT_APP_ID===project.appid,'后端WECHAT_APP_ID必须与小程序AppID相同');
 let publicHttps=false;try{const u=new URL(apiBase);publicHttps=u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname)&&!/^\d+(?:\.\d+){3}$/.test(u.hostname)&&!/(^|\.)(localhost|local|internal)$/i.test(u.hostname)}catch{}
 add('小程序接口传输方式',transport==='http'||transport==='cloud','transport 只能为 http 或 cloud');
 if(transport==='cloud'){
  add('云托管环境已配置',typeof cloudEnv==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(cloudEnv),'在 config.js 的 cloudEnv 填写已存在的微信云托管环境ID');
  add('云托管服务已配置',typeof cloudService==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(cloudService),'在 config.js 的 cloudService 填写已部署配送后端的服务名称');
 }else add('真机HTTPS接口地址',publicHttps,'配置实际HTTPS域名，不使用本机地址、内网地址或IP');
 add('开启域名校验',project.setting?.urlCheck===true&&privateProject.setting?.urlCheck!==false,'project和本机private配置均不能关闭urlCheck');
 add('正式微信身份模式',env.BREAD_AUTH_MODE==='wechat','后端设置BREAD_AUTH_MODE=wechat');
 add('后端密钥已配置',!!env.WECHAT_APP_SECRET&&env.WECHAT_APP_SECRET.length>=16,'只在后端环境中填写真实AppSecret，不发送到聊天或写进代码');
 const hasId=value=>typeof value==='string'&&value.length>0&&value.trim()===value&&!/\s/.test(value);
 add('商家身份已配置',hasId(env.WECHAT_MERCHANT_OPENID),'核验本小程序商家OpenID后配置');
 add('配送员身份已配置',hasId(env.WECHAT_COURIER_OPENID)&&env.WECHAT_COURIER_OPENID!==env.WECHAT_MERCHANT_OPENID,'配置与商家不同的配送员OpenID');
 add('已关闭首次身份核验模式',[undefined,'','false',false].includes(env.WECHAT_ALLOW_UNASSIGNED_OPERATORS),'完成身份核验后移除 WECHAT_ALLOW_UNASSIGNED_OPERATORS 或设为 false');
 add('正式MySQL持久化',env.BREAD_STORE==='mysql','云端设置 BREAD_STORE=mysql，禁止使用容器内的临时SQLite文件作为正式数据库');
 add('MySQL内网地址已配置',typeof env.MYSQL_HOST==='string'&&/^[a-zA-Z0-9_.:-]+$/.test(env.MYSQL_HOST)&&!['localhost','127.0.0.1','::1'].includes(env.MYSQL_HOST.toLowerCase()),'在后端配置已存在数据库的内网 MYSQL_HOST');
 add('MySQL端口有效',env.MYSQL_PORT===undefined||env.MYSQL_PORT===''||/^\d+$/.test(String(env.MYSQL_PORT))&&Number(env.MYSQL_PORT)>0&&Number(env.MYSQL_PORT)<=65535,'MYSQL_PORT 必须为1—65535的整数，未设置时默认3306');
 add('MySQL业务账号已配置',typeof env.MYSQL_USER==='string'&&!!env.MYSQL_USER.trim(),'在后端配置受限业务账号 MYSQL_USER');
 add('MySQL密码已配置',typeof env.MYSQL_PASSWORD==='string'&&env.MYSQL_PASSWORD.length>0,'只在后端私密环境变量填写 MYSQL_PASSWORD');
 add('MySQL业务库已配置',typeof env.MYSQL_DATABASE==='string'&&/^[a-zA-Z0-9_]{1,64}$/.test(env.MYSQL_DATABASE)&&!['mysql','sys','performance_schema','information_schema','nodejs_demo'].includes(env.MYSQL_DATABASE.toLowerCase()),'填写已建立的业务库 MYSQL_DATABASE，不使用系统库或示例库');
 try{readTemplates(env.WECHAT_DELIVERY_TEMPLATES);add('订阅模板配置格式',true)}catch{add('订阅模板配置格式',false,'按获批模板设置合法阶段与字段映射')}
 return {checks,passed:checks.every(c=>c.ok),manual:['微信后台主体、类目、备案、隐私配置已核验',transport==='cloud'?'callContainer 的小程序AppID、云环境关联、服务权限及真机调用已核验':'request合法域名已配置且证书有效','两客户、商家和配送员使用真实微信身份完成真机验收','真实MySQL数据库备份、恢复到隔离库和数据核对演练完成','生产环境仅导商品与分类，未导入演示客户或订单','本轮无线上支付；实际收费或支付接入须另行验收'],note:'本脚本仅检查本地技术配置，不验证账号资格、密钥有效性、云服务与数据库连接、域名可达性或审核结果。通过不代表已部署或可正式发布。未配置订阅模板时仅提供站内消息。'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const project=JSON.parse(readFileSync(join(root,'miniprogram/project.config.json'),'utf8'));
 const file=join(root,'miniprogram/project.private.config.json');
 const context={module:{exports:{}}};vm.runInNewContext(readFileSync(join(root,'miniprogram/config.js'),'utf8'),context,{timeout:1000});
 const report=checkRelease({...context.module.exports,project,privateProject:existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{},env:process.env});
 for(const c of report.checks)console.log((c.ok?'通过':'待完成')+' · '+c.name+(c.fix?'：'+c.fix:''));
 console.log('\n必须人工验收：\n'+report.manual.map(m=>'□ '+m).join('\n')+'\n'+report.note);
 process.exitCode=report.passed?0:1;
}
