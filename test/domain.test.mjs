import test from 'node:test';import assert from 'node:assert/strict';import {initial as emptyInitial,mutate,view} from '../domain.mjs';
function initial(){const db=emptyInitial();db.users.forEach(u=>u.boundAt=new Date().toISOString());db.products.push({id:'p1',name:'测试面包',price:1200,stock:30,allergens:'测试配料'});return db;}
const body={productId:'p1',buyerId:'buyer-a',quantity:2,building:'东苑1栋',deliveryDay:'周一'};
test('履约闭环与单次评价',()=>{const db=initial();const o=mutate(db,'merchant','order',body);assert.equal(db.products[0].stock,undefined);for(const actor of ['merchant','courier','courier','buyer-a'])mutate(db,actor,'progress',{id:o.id,confirmed:true,expectedStage:o.stage});assert.equal(o.stage,4);mutate(db,'buyer-a','review',{id:o.id,rating:5,comment:'包装好，建议增加全麦款'});assert.equal(o.review.rating,5);assert.throws(()=>mutate(db,'buyer-a','review',{id:o.id,rating:5,comment:'重复'}));});
test('隔离买家并拒绝越权与跳步',()=>{const db=initial();const o=mutate(db,'merchant','order',body);assert.equal(view(db,'buyer-b').orders.length,0);assert.throws(()=>mutate(db,'buyer-b','progress',{id:o.id,confirmed:true,expectedStage:o.stage}));assert.throws(()=>mutate(db,'courier','progress',{id:o.id,confirmed:true,expectedStage:o.stage}));assert.throws(()=>mutate(db,'buyer-a','review',{id:o.id,rating:5,comment:'提前'}));assert.throws(()=>mutate(db,'buyer-a','order',body));});
test('不限量供货且仍校验单次数量与产品',()=>{const db=initial();for(let i=0;i<10;i++)mutate(db,'merchant','order',{...body,quantity:50});assert.equal(db.orders.length,10);for(const quantity of [0,-1,1.5,51])assert.throws(()=>mutate(db,'merchant','order',{...body,quantity}));assert.equal(db.products[0].stock,undefined);assert.throws(()=>mutate(db,'merchant','product',{name:'',price:1,stock:1,allergens:''}));});

test('配送楼栋边界：接受东13和西6，拒绝越界及缺失楼栋',()=>{for(const building of ['东苑1栋','东苑13栋','西苑1栋','西苑6栋']){const db=initial();assert.equal(mutate(db,'merchant','order',{...body,building}).building,building);}for(const building of ['东苑14栋','西苑7栋','西苑0栋','',undefined]){const db=initial();assert.throws(()=>mutate(db,'merchant','order',{...body,building}),/请选择东苑/);assert.equal(db.products[0].stock,undefined);assert.equal(db.orders.length,0);}});
test('分类管理校验权限、重名、迁移商品及删除保护',()=>{const db=initial();assert.equal(db.categories.length,8);assert.throws(()=>mutate(db,'buyer-a','category-add',{name:'其他'}),/仅商家/);assert.throws(()=>mutate(db,'merchant','category-add',{name:' 碱水条系列 '}),/已存在/);mutate(db,'merchant','category-add',{name:'限定系列'});mutate(db,'merchant','product-category',{id:'p1',category:'限定系列'});assert.throws(()=>mutate(db,'merchant','category-delete',{name:'限定系列'}),/仍有商品/);mutate(db,'merchant','category-rename',{oldName:'限定系列',name:'当季限定'});assert.equal(db.products[0].category,'当季限定');mutate(db,'merchant','product-category',{id:'p1',category:'软欧系列'});mutate(db,'merchant','category-delete',{name:'当季限定'});assert.ok(!db.categories.includes('当季限定'));assert.throws(()=>mutate(db,'merchant','product-category',{id:'p1',category:'不存在'}));});

test('配送固定楼下货架和午间时段，周末及缺失配送日不能建单',()=>{for(const deliveryDay of ['周一','周二','周三','周四','周五']){const db=initial();const o=mutate(db,'merchant','order',{...body,deliveryDay,address:'其他地点',slot:'09:00'});assert.equal(o.address,'楼下货架');assert.equal(o.deliveryDay,deliveryDay);assert.equal(o.deliveryFrequency,'weekly');assert.equal(o.slot,`每${deliveryDay} 12:30—13:00（每周一次）`);}for(const deliveryDay of ['周六','周日','',undefined]){const db=initial();assert.throws(()=>mutate(db,'merchant','order',{...body,deliveryDay}),/请选择周一至周五/);assert.equal(db.products[0].stock,undefined);assert.equal(db.orders.length,0);}assert.deepEqual(emptyInitial().products,[]);});

test('评价文字选填，空白或省略可提交，超长及错误类型仍拒绝',()=>{
 for(const comment of ['', '   ', undefined]){
  const db=initial();const o=mutate(db,'merchant','order',body);
  for(const actor of ['merchant','courier','courier','buyer-a'])mutate(db,actor,'progress',{id:o.id,confirmed:true,expectedStage:o.stage});
  assert.equal(o.review,null); // 签收完成不强制评价
  for(const invalid of ['字'.repeat(501),null,123])assert.throws(()=>mutate(db,'buyer-a','review',{id:o.id,rating:5,comment:invalid}));
  mutate(db,'buyer-a','review',{id:o.id,rating:5,...(comment===undefined?{}:{comment})});
  assert.equal(o.review.comment,'');assert.equal(o.review.rating,5);
 }
});

test('二次确认与过期状态校验，通知隔离、异常冻结及误签收恢复',()=>{
 const db=initial();const o=mutate(db,'merchant','order',body);
 assert.throws(()=>mutate(db,'merchant','progress',{id:o.id}),/二次确认/);
 const step=(actor,stage)=>mutate(db,actor,'progress',{id:o.id,confirmed:true,expectedStage:stage});
 step('merchant',0);step('courier',1);
 assert.throws(()=>step('courier',1),/状态已变化/);assert.equal(o.stage,2);
 step('courier',2);assert.equal(view(db,'buyer-a').notifications.length,4);assert.equal(view(db,'buyer-b').notifications.length,0);
 const notice=view(db,'buyer-a').notifications[0];assert.throws(()=>mutate(db,'buyer-b','notification-read',{id:notice.id}));mutate(db,'buyer-a','notification-read',{id:notice.id});assert.equal(notice.read,true);
 step('buyer-a',3);mutate(db,'buyer-a','delivery-issue',{id:o.id,reason:'误点签收，实际未拿到货'});
 assert.throws(()=>mutate(db,'buyer-a','review',{id:o.id,rating:5}),/签收后/);
 assert.throws(()=>mutate(db,'courier','issue-resolve',{id:o.id,confirmed:true,expectedStage:4,targetStage:3,reason:'测试'}));
 mutate(db,'merchant','issue-resolve',{id:o.id,confirmed:true,expectedStage:4,targetStage:3,reason:'确认客户尚未取货，恢复待签收'});assert.equal(o.stage,3);assert.equal(o.issue,null);
 mutate(db,'buyer-a','delivery-issue',{id:o.id,reason:'货架未找到面包'});assert.throws(()=>step('buyer-a',3),/待处理异常/);
 mutate(db,'merchant','issue-resolve',{id:o.id,confirmed:true,expectedStage:3,targetStage:2,reason:'确认送错楼栋，重新配送'});step('courier',2);step('buyer-a',3);assert.equal(o.stage,4);
});
