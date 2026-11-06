// Run with the demo server stopped to avoid overwriting its in-memory state.
import {readFileSync,writeFileSync,copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openStore} from '../storage.mjs';
import {initial} from '../domain.mjs';
const mode=process.env.BREAD_AUTH_MODE||'demo';if(!['demo','wechat'].includes(mode))throw Error('无效 BREAD_AUTH_MODE');
const file=new URL('../data/'+(mode==='wechat'?'wechat':'demo')+'.json',import.meta.url);mkdirSync(new URL('../data/',import.meta.url),{recursive:true});
const batch=JSON.parse(readFileSync(new URL('./ri-chang-products.json',import.meta.url)));
const store=openStore(fileURLToPath(file),()=>initial({demo:mode==='demo'}));const db=store.load();
await store.backup(fileURLToPath(new URL('../data/before-richang-import-'+mode+'-'+Date.now()+'.sqlite',import.meta.url)));
for(const p of batch.products){if(db.products.some(x=>x.importKey===p.key))continue;db.products.push({id:crypto.randomUUID(),name:p.name,price:p.price,allergens:'待补充（来源页面未提供）',specification:p.specification||'待补充',description:p.description,category:p.category,source:batch.source,sourceDate:batch.observedDate,importKey:p.key});}
store.save(db);store.close();
console.log('已导入并保留原商品；来源商品数：'+db.products.filter(p=>p.importKey).length);
