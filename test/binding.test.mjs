import test from 'node:test';import assert from 'node:assert/strict';
import {initial,mutate,view} from '../domain.mjs';
test('未绑定也可直接建单，建单后自动绑定并进入商家客户名单',()=>{
 const db=initial();db.products.push({id:'p',name:'测试面包',price:800,allergens:'小麦'});
 const b={productId:'p',buyerId:'buyer-a',quantity:1,building:'西苑6栋',deliveryDay:'周五'};
 assert.equal(view(db,'merchant').customers.length,2);
 const o=mutate(db,'merchant','order',b);assert.equal(o.buyerId,'buyer-a');
 assert.ok(db.users.find(u=>u.id==='buyer-a').boundAt);
 assert.equal(view(db,'merchant').customers.find(c=>c.id==='buyer-a').bound,true);
 assert.equal(view(db,'buyer-a').orders.length,1);
 assert.throws(()=>mutate(db,'merchant','order',{...b,buyerId:'nobody'}),/客户不存在/);
});
test('商家可为客户写备注，备注可清空；客户本人不可改',()=>{
 const db=initial();
 mutate(db,'merchant','customer-note',{buyerId:'buyer-a',note:'不吃坚果'});
 assert.equal(view(db,'merchant').customers.find(c=>c.id==='buyer-a').note,'不吃坚果');
 assert.throws(()=>mutate(db,'buyer-a','customer-note',{buyerId:'buyer-a',note:'自己改'}));
 assert.throws(()=>mutate(db,'merchant','customer-note',{buyerId:'buyer-a',note:'x'.repeat(121)}));
 assert.throws(()=>mutate(db,'merchant','customer-note',{buyerId:'nobody',note:'x'}));
 mutate(db,'merchant','customer-note',{buyerId:'buyer-a',note:''});
 assert.equal(view(db,'merchant').customers.find(c=>c.id==='buyer-a').note,'');
});
test('旧绑定接口已移除，不再产生待确认申请',()=>{
 const db=initial();
 // 旧绑定入口已删除：调用不再产生绑定码、申请或确认，只会失败，客户名单不变。
 assert.throws(()=>mutate(db,'buyer-a','binding-code',{}));
 assert.throws(()=>mutate(db,'merchant','binding-request',{code:'ABCDEFGHIJKL'}));
 assert.throws(()=>mutate(db,'buyer-a','binding-confirm',{id:'x'}));
 assert.equal(view(db,'merchant').customers.filter(c=>c.bound).length,0);
 assert.equal(view(db,'merchant').bindingRequests,undefined);
 assert.equal(view(db,'buyer-a').bindingRequests,undefined);
 assert.deepEqual(view(db,'merchant').merchantNotices,[]);
});
test('旧零库存商品可建单且仅商家可改说明',()=>{
 const db=initial();db.products.push({id:'p',name:'测试面包',price:800,stock:0,stockPending:true,allergens:'待补充'});
 const b={productId:'p',buyerId:'buyer-a',quantity:1,building:'西苑6栋',deliveryDay:'周五'};
 const o=mutate(db,'merchant','order',b);assert.equal(db.products[0].stock,undefined);assert.equal(o.allergens,'待补充');
 assert.throws(()=>mutate(db,'buyer-a','product-details',{id:'p',stock:3,allergens:'小麦'}));
 mutate(db,'merchant','product-details',{id:'p',stock:3,allergens:'测试：小麦、乳'});
 assert.throws(()=>mutate(db,'merchant','product-details',{id:'p',allergens:''}));
});
