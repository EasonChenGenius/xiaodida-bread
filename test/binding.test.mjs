import test from 'node:test';import assert from 'node:assert/strict';
import {initial,mutate,view} from '../domain.mjs';
test('绑定码单次使用且须买家确认，不能替其他客户确认',()=>{
 const db=initial();const code=mutate(db,'buyer-a','binding-code',{}).code;
 assert.ok(!JSON.stringify(db).includes(code));assert.equal(view(db,'merchant').customers.length,0);
 mutate(db,'merchant','binding-request',{code});assert.throws(()=>mutate(db,'merchant','binding-request',{code}),/无效/);
 const request=view(db,'buyer-a').bindingRequests[0];assert.equal(view(db,'buyer-b').bindingRequests.length,0);
 assert.throws(()=>mutate(db,'buyer-b','binding-confirm',{id:request.id}));assert.equal(view(db,'merchant').customers.length,0);
 mutate(db,'buyer-a','binding-confirm',{id:request.id});assert.equal(view(db,'merchant').customers[0].id,'buyer-a');assert.throws(()=>mutate(db,'buyer-a','binding-confirm',{id:request.id}));
});
test('新码撤销旧码及旧申请、过期和拒绝均不绑定',()=>{
 const db=initial();let code=mutate(db,'buyer-a','binding-code',{}).code;
 const replacement=mutate(db,'buyer-a','binding-code',{}).code;assert.throws(()=>mutate(db,'merchant','binding-request',{code}));
 db.bindingCodes[0].expiresAt=Date.now()-1;assert.throws(()=>mutate(db,'merchant','binding-request',{code:replacement}));
 code=mutate(db,'buyer-a','binding-code',{}).code;mutate(db,'merchant','binding-request',{code});let r=db.bindingRequests[0];
 mutate(db,'buyer-a','binding-reject',{id:r.id});assert.equal(view(db,'merchant').customers.length,0);
 code=mutate(db,'buyer-a','binding-code',{}).code;mutate(db,'merchant','binding-request',{code});r=db.bindingRequests[0];r.expiresAt=Date.now()-1;
 assert.throws(()=>mutate(db,'buyer-a','binding-confirm',{id:r.id}));assert.equal(view(db,'merchant').bindingRequests.length,0);
});
test('未绑定不可建单，旧零库存商品可建单且仅商家可改说明',()=>{
 const db=initial();db.products.push({id:'p',name:'测试面包',price:800,stock:0,stockPending:true,allergens:'待补充'});
 const b={productId:'p',buyerId:'buyer-a',quantity:1,building:'西苑6栋',deliveryDay:'周五'};
 assert.throws(()=>mutate(db,'merchant','order',b),/绑定/);assert.throws(()=>mutate(db,'buyer-a','product-details',{id:'p',stock:3,allergens:'小麦'}));
 mutate(db,'merchant','product-details',{id:'p',stock:3,allergens:'测试：小麦、乳'});
 const code=mutate(db,'buyer-a','binding-code',{}).code;mutate(db,'merchant','binding-request',{code});mutate(db,'buyer-a','binding-confirm',{id:db.bindingRequests[0].id});
 const o=mutate(db,'merchant','order',b);assert.equal(db.products[0].stock,undefined);assert.equal(o.allergens,'测试：小麦、乳');assert.equal(view(db,'buyer-b').orders.length,0);
 assert.throws(()=>mutate(db,'merchant','product-details',{id:'p',allergens:''}));
});
