import {mkdirSync,copyFileSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const backendFiles=['Dockerfile','.dockerignore','package.json','package-lock.json','server.mjs','auth.mjs','domain.mjs','notifications.mjs','storage.mjs','mysql-store.mjs','seed-products.mjs','web-auth.mjs','scripts/create-web-operator.mjs','scripts/approve-web-recovery.mjs','scripts/web-store.mjs','scripts/web-release-check.mjs','web/index.html','web/app.js','web/style.css','miniprogram/assets/platform-logo.png','miniprogram/brand.js','imports/ri-chang-products.json'];
export const miniFiles=['app.js','app.json','app.wxss','brand.js','assets/platform-logo.png','pages/home/index.js','pages/home/index.json','pages/home/index.wxml'];
export function buildRelease(destination){
 const out=resolve(destination);if(existsSync(out))throw Error('输出目录已存在，请指定新的目录');
 const manifest=[];
 const copy=(source,target)=>{mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);};
 for(const f of backendFiles)copy(join(root,f),join(out,'backend',f));
 for(const f of miniFiles)copy(join(root,'miniprogram',f),join(out,'miniprogram',f));
 copy(join(root,'miniprogram/config.cloud.example.js'),join(out,'miniprogram/config.js'));
 const project=JSON.parse(readFileSync(join(root,'miniprogram/project.config.json'),'utf8'));
 project.setting={...project.setting,urlCheck:true,uploadWithSourceMap:false};
 writeFileSync(join(out,'miniprogram/project.config.json'),JSON.stringify(project,null,2)+'\n');
 for(const f of [...backendFiles.map(f=>'backend/'+f),...miniFiles.map(f=>'miniprogram/'+f),'miniprogram/config.js','miniprogram/project.config.json'])manifest.push({path:f,sha256:createHash('sha256').update(readFileSync(join(out,f))).digest('hex')});
 writeFileSync(join(out,'MANIFEST.json'),JSON.stringify({version:'0.11.1',builtAt:new Date().toISOString(),status:'prepared-not-deployed',files:manifest},null,2)+'\n');
 return {directory:out,files:manifest.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=process.argv[2]||join(root,'dist','xiaodida-0.11.1-'+Date.now());
 console.log(JSON.stringify(buildRelease(output)));
}
