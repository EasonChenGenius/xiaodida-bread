import test from 'node:test';import assert from 'node:assert/strict';import {initial,mutate,view,migrate}from'../domain.mjs';
function setup(){const db=initial();db.users[0].boundAt='test';db.products=[{id:'a',name:'大米面包',price:350,allergens:'小麦'},{id:'b',name:'草莓优格贝果',price:990,allergens:'乳'}];return db;}
const base={buyerId:'buyer-a',building:'西苑6栋',deliveryDay:'周五'};
test('多款按服务器单价计算快照，整单履约、通知和评价',()=>{
 const db=setup();const o=mutate(db,'merchant','order',{...base,items:[{productId:'a',quantity:2,unitPrice:1},{productId:'b',quantity:3}],total:1});
 assert.equal(o.total,3670);assert.equal(o.quantity,5);assert.equal(o.items.length,2);assert.equal(o.items[0].unitPrice,350);assert.equal(o.summary,'大米面包 × 2、草莓优格贝果 × 3');
 db.products[0].price=1000;db.products[0].name='新名称';migrate(db);assert.equal(o.items[0].name,'大米面包');assert.equal(o.total,3670);
 assert.ok(view(db,'buyer-a').notifications[0].message.includes('大米面包 × 2、草莓优格贝果 × 3'));assert.equal(view(db,'buyer-b').orders.length,0);
 for(const actor of ['merchant','courier','courier','buyer-a'])mutate(db,actor,'progress',{id:o.id,confirmed:true,expectedStage:o.stage});mutate(db,'buyer-a','review',{id:o.id,rating:5});assert.equal(o.stage,4);assert.equal(o.review.rating,5);
});
test('空列表、错误明细、重复商品及非法数量均拒绝且不生成订单或通知',()=>{
 for(const items of [[],null,'bad',[null],[{productId:'missing',quantity:1}],[{productId:'a',quantity:0}],[{productId:'a',quantity:1.5}],[{productId:'a',quantity:51}],[{productId:'a',quantity:1},{productId:'a',quantity:2}],[{productId:'a',quantity:1},{productId:'b',quantity:-1}],Array(21).fill({productId:'a',quantity:1})]){const db=setup();assert.throws(()=>mutate(db,'merchant','order',{...base,items}));assert.equal(db.orders.length,0);assert.equal(db.notifications.length,0);}
});
test('旧单迁移保持金额、数量、签收评价和通知不变；配送员未完成排在历史签收前',()=>{
 const db=setup();db.orders.push({id:'old',product:'旧面包',quantity:2,total:700,allergens:'小麦',stage:4,buyerId:'buyer-a',courierId:'courier',review:{rating:5,comment:''}});migrate(db);migrate(db);const old=db.orders[0];assert.equal(old.items.length,1);assert.equal(old.items[0].total,700);assert.equal(old.review.rating,5);assert.equal(db.notifications.length,0);
 const active=mutate(db,'merchant','order',{...base,productId:'a',quantity:1});mutate(db,'merchant','progress',{id:active.id,confirmed:true,expectedStage:0});db.orders.reverse();assert.equal(view(db,'courier').orders[0].id,active.id);
});

test('已签收但待处理异常的单仍排在配送员已完成单之前',()=>{const db=setup();db.orders=[{id:'done',stage:4,buyerId:'buyer-a',courierId:'courier',product:'测试',total:100,quantity:1},{id:'issue',stage:4,issue:{reason:'未收到'},buyerId:'buyer-a',courierId:'courier',product:'测试',total:100,quantity:1}];assert.equal(view(db,'courier').orders[0].id,'issue')});

test('平台与来源商家分别展示，旧订单补展示信息而不修改原记录',()=>{const db=setup();const o=mutate(db,'merchant','order',{...base,productId:'a',quantity:1});assert.equal(o.merchantName,'日尝手作');delete o.merchantName;delete o.merchantId;const state=view(db,'buyer-a');assert.equal(state.branding.platformName,'校递达配送助手');assert.equal(state.orders[0].merchantName,'日尝手作');assert.equal(o.merchantName,undefined)});
