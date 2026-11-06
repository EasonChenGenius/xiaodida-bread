import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {initial} from './domain.mjs';
// A clean cloud database receives catalog only, never local customers/orders/sessions.
export function initialCloudState(){
 const state=initial({demo:false});
 const batch=JSON.parse(readFileSync(new URL('./imports/ri-chang-products.json',import.meta.url),'utf8'));
 state.products=batch.products.map(p=>({id:createHash('sha256').update('richang:'+p.key).digest('hex').slice(0,32),name:p.name,price:p.price,allergens:'待补充（来源页面未提供）',specification:p.specification||'待补充',description:p.description,category:p.category,source:batch.source,sourceDate:batch.observedDate,importKey:p.key}));
 if(new Set(state.products.map(p=>p.id)).size!==state.products.length||state.products.some(p=>!p.name||!Number.isInteger(p.price)||p.price<0))throw Error('商品资料校验失败');
 return state;
}
