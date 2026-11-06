import {spawn} from 'node:child_process';
import {createApplication} from '../server.mjs';
const address='http://127.0.0.1:3100';
const server=createApplication({mode:'demo'});
server.on('error',async error=>{let existing=false;if(error.code==='EADDRINUSE'){try{const r=await fetch(address+'/api/config',{signal:AbortSignal.timeout(2000)});const config=await r.json();existing=r.ok&&config.mode==='demo';console.log(config.mode==='demo'?'本机服务已经运行，可在小程序点击“重新同步”。':'3100端口已有其他服务，请先核对。')}catch{console.error('3100端口被占用，请先核对已有服务。')}}else console.error('无法启动本机服务：'+error.message);server.close();process.exitCode=existing?2:1;});
server.listen(3100,'127.0.0.1',()=>{console.log('接口已就绪：'+address+'；微信模拟器可点击“重新同步”。');if(process.platform==='darwin')spawn('/usr/bin/open',[address],{stdio:'ignore'}).on('error',()=>{});});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>process.exit(0)));
