import{resolve}from'node:path';import{fileURLToPath}from'node:url';
export function checkWebRelease(env){
 const checks=[];const add=(name,ok,fix)=>checks.push({name,ok:!!ok,...(!ok?{fix}:{})});
 add('网页身份模式',env.BREAD_AUTH_MODE==='web','设置BREAD_AUTH_MODE=web，不能使用演示身份');
 add('正式运行环境',env.NODE_ENV==='production','设置NODE_ENV=production');
 add('持久化MySQL',env.BREAD_STORE==='mysql','设置BREAD_STORE=mysql，不能使用容器临时SQLite');
 let https=false;try{const u=new URL(env.WEB_PUBLIC_ORIGIN);https=u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname)&&!/^\d+(?:\.\d+){3}$/.test(u.hostname)&&!/(^|\.)(localhost|local|internal)$/i.test(u.hostname);}catch{}
 add('公网HTTPS网站地址',https,'填写WEB_PUBLIC_ORIGIN，仅填已验证的网站HTTPS域名，不填密钥或本机地址');
 add('业务数据库地址',!!env.MYSQL_HOST&&!['127.0.0.1','localhost','::1'].includes(env.MYSQL_HOST),'填写实际业务数据库内网地址');
 add('业务数据库账号',!!env.MYSQL_USER&&env.MYSQL_USER.toLowerCase()!=='root','使用本业务库的受限账号，不使用root');
 add('数据库密码',!!env.MYSQL_PASSWORD,'仅在后端私密环境填写MYSQL_PASSWORD');
 add('独立网站业务库',typeof env.MYSQL_DATABASE==='string'&&/^[a-z0-9_]{1,64}$/i.test(env.MYSQL_DATABASE)&&!['mysql','sys','nodejs_demo','information_schema','performance_schema','xiaodida'].includes(env.MYSQL_DATABASE.toLowerCase()),'使用独立网站业务库，不混入小程序、系统或示例库');
 return{passed:checks.every(c=>c.ok),checks,manual:['真实MySQL读写、重启和备份恢复','商家与配送员账号已由负责人创建和安全交付','客户、商家和配送员手机浏览器完整验收','中国国内不同手机网络实际访问测试','隐私告知、联系方式和账号恢复本人核验已确认','手机主动通知服务另行配置并验证授权、送达及失败处理'],note:'只检查配置格式；通过不代表已部署、数据库可连接、国内可达或手机通知已发送。当前通知为站内消息。'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=checkWebRelease(process.env);for(const c of result.checks)console.log((c.ok?'通过':'待完成')+' · '+c.name+(c.fix?'：'+c.fix:''));console.log(result.note+'\n'+result.manual.map(s=>'□ '+s).join('\n'));process.exitCode=result.passed?0:1;
}
