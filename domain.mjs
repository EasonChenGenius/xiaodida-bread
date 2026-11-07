import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const brandModule={module:{exports:{}}};
vm.runInNewContext(readFileSync(new URL('./miniprogram/brand.js',import.meta.url),'utf8'),brandModule,{timeout:1000});
export const branding=brandModule.module.exports;
import {createHash} from 'node:crypto';
const hashCode=code=>createHash('sha256').update(code).digest('hex');
export const deliveryDays=['周一','周二','周三','周四','周五'];
export const deliveryWindow='12:30—13:00';
export const handoffPoint='楼下货架';
export const defaultCategories=['碱水条系列','小餐包系列','软欧系列','司康系列','bagel系列','碱水球系列','米软欧系列','恰巴塔系列'];
export function migrate(db){
 db.categories??=[...defaultCategories];db.demo??=true;
 db.users??=db.demo?customers.map(c=>({...c,role:'buyer',boundAt:db.orders.some(o=>o.buyerId===c.id)?new Date().toISOString():null})):[];
 db.orderRequests??={};db.notifications??=[];db.bindingCodes??=[];db.bindingRequests??=[];for(const p of db.products){delete p.stock;delete p.stockPending;}for(const o of db.orders){o.items??=[{productId:null,name:o.product,quantity:o.quantity,unitPrice:o.total/o.quantity,total:o.total,allergens:o.allergens||''}];o.summary=o.items.map(i=>i.name+' × '+i.quantity).join('、');}return db;
}
export const buildings=[...Array.from({length:13},(_,i)=>`东苑${i+1}栋`),...Array.from({length:6},(_,i)=>`西苑${i+1}栋`)];
export const customers=[{id:'buyer-a',name:'同学甲（测试）'},{id:'buyer-b',name:'同学乙（测试）'}];
export const stages=['待备货','待取货','配送中','待签收','已签收'];
export function initial({demo=true}={}){return migrate({demo,categories:[...defaultCategories],products:[],orders:[]});}
const notify=(db,o,title,message)=>db.notifications.unshift({id:crypto.randomUUID(),buyerId:o.buyerId,orderId:o.id,number:o.number,stage:o.stage,product:o.summary,location:o.building+'楼下货架',push:{status:'pending'},title,message,at:new Date().toISOString(),read:false});
const requireValue=(ok,msg)=>{if(!ok)throw Error(msg)};
function validAvatar(value){
 if(['','leaf','bread','sun'].includes(value))return true;
 if(typeof value!=='string'||value.length>12000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
 const image=Buffer.from(value.slice(23),'base64');
 if(image.length<20||image.readUInt16BE(0)!==0xffd8||image.readUInt16BE(image.length-2)!==0xffd9)return false;
 for(let pos=2;pos+4<image.length;){
  if(image[pos++]!==0xff)return false;while(image[pos]===0xff)pos++;
  if(pos+3>image.length)return false;const marker=image[pos++];if(marker===0xda||marker===0xd9)return false;
  const length=image.readUInt16BE(pos);if(length<2||pos+length>image.length)return false;
  if(marker===0xc0||marker===0xc2){if(length<8)return false;const height=image.readUInt16BE(pos+3),width=image.readUInt16BE(pos+5);return width>0&&height>0&&width<=128&&height<=128;}
  pos+=length;
 }return false;
}
export function mutate(db,actor,action,b){
 migrate(db);
 const user=db.users.find(u=>u.id===actor);
 if(action==='notification-read'){const n=db.notifications.find(n=>n.id===b.id&&n.buyerId===actor);requireValue(n,'通知不存在');n.read=true;return {ok:true};}
 if(action==='avatar'){requireValue(user&&['buyer','merchant','courier'].includes(user.role),'请先登录');requireValue(validAvatar(b.avatar),'头像须为内置样式或压缩后的128像素以内JPEG图片');user.avatar=b.avatar;return {ok:true};}
 if(action==='profile'){
 requireValue(user?.role==='buyer','仅客户可修改自己的称呼');requireValue(typeof b.name==='string'&&b.name.trim().length>0&&b.name.trim().length<=30,'称呼须为1至30字');user.name=b.name.trim();return {ok:true};
 }
 if(action==='binding-code'){
 requireValue(user?.role==='buyer','仅客户可生成绑定码');requireValue(!user.boundAt,'已经绑定日尝手作，可直接等待商家建单');
 db.bindingCodes=db.bindingCodes.filter(c=>c.buyerId!==actor&&c.expiresAt>Date.now());
 db.bindingRequests=db.bindingRequests.filter(r=>r.buyerId!==actor);
 const code=crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
 db.bindingCodes.push({buyerId:actor,hash:hashCode(code),expiresAt:Date.now()+600000});return {code,expiresAt:Date.now()+600000};
 }
 if(action==='binding-request'){
 requireValue(actor==='merchant','仅商家可匹配客户');requireValue(typeof b.code==='string'&&/^[A-F0-9]{12}$/.test(b.code.trim().toUpperCase()),'请输入客户提供的12位绑定码');
 const code=db.bindingCodes.find(c=>c.hash===hashCode(b.code.trim().toUpperCase())&&c.expiresAt>Date.now());requireValue(code,'绑定码无效、过期或已使用');
 const buyer=db.users.find(u=>u.id===code.buyerId&&u.role==='buyer');requireValue(buyer&&!buyer.boundAt,'客户已绑定或不存在');
 db.bindingCodes=db.bindingCodes.filter(c=>c!==code);db.bindingRequests=db.bindingRequests.filter(r=>r.buyerId!==buyer.id&&r.expiresAt>Date.now());
 const request={id:crypto.randomUUID(),buyerId:buyer.id,expiresAt:Date.now()+600000};db.bindingRequests.push(request);return {name:buyer.name,pending:true};
 }
 if(action==='binding-confirm'||action==='binding-reject'){
 const request=db.bindingRequests.find(r=>r.id===b.id&&r.buyerId===actor&&r.expiresAt>Date.now());requireValue(user?.role==='buyer'&&request,'绑定申请不存在或已过期');
 db.bindingRequests=db.bindingRequests.filter(r=>r.id!==request.id);if(action==='binding-confirm')user.boundAt=new Date().toISOString();return {ok:true};
 }
 if(action==='product-details'){
 requireValue(actor==='merchant','仅商家可维护商品说明');const p=db.products.find(p=>p.id===b.id);requireValue(p,'商品不存在');requireValue(typeof b.allergens==='string'&&b.allergens.trim().length>0&&b.allergens.length<=120,'请填写120字以内配料与过敏原说明');
 p.allergens=b.allergens.trim();return p;
 }
 if(['category-add','category-rename','category-delete','product-category'].includes(action)){
 requireValue(actor==='merchant','仅商家可管理分类');
 if(action==='product-category'){const p=db.products.find(p=>p.id===b.id);requireValue(p,'商品不存在');requireValue(db.categories.includes(b.category),'分类不存在');p.category=b.category;return p;}
 if(action==='category-delete'){requireValue(db.categories.includes(b.name),'分类不存在');requireValue(!db.products.some(p=>p.category===b.name),'分类下仍有商品，请先调整商品分类');db.categories=db.categories.filter(c=>c!==b.name);return {ok:true};}
 requireValue(typeof b.name==='string'&&b.name.trim().length>0&&b.name.trim().length<=30,'分类名称须为1至30字');const name=b.name.trim();requireValue(!db.categories.includes(name),'分类名称已存在');
 if(action==='category-add'){db.categories.push(name);return {name};}
 requireValue(db.categories.includes(b.oldName),'原分类不存在');db.categories=db.categories.map(c=>c===b.oldName?name:c);for(const p of db.products)if(p.category===b.oldName)p.category=name;return {name};
 }

 if(action==='product'){
 requireValue(actor==='merchant','仅商家可录入产品');requireValue(typeof b.name==='string'&&b.name.trim().length>0&&b.name.length<=60,'请填写产品名称');requireValue(Number.isSafeInteger(b.price)&&b.price>0&&b.price<=100000,'价格须为有效整数分');requireValue(typeof b.allergens==='string'&&b.allergens.length<=120,'请填写过敏原说明');
 requireValue(b.category===undefined||db.categories.includes(b.category),'分类不存在');
 const p={category:b.category||null,id:crypto.randomUUID(),name:b.name.trim(),price:b.price,allergens:b.allergens};db.products.push(p);return p;
 }
 if(action==='order'){
 requireValue(actor==='merchant','仅商家可录单');
 const requestId=b.requestId;let requestHash;
 if(requestId!==undefined){requireValue(typeof requestId==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(requestId),'建单请求标识无效');const {requestId:ignored,...payload}=b;requestHash=hashCode(JSON.stringify(payload));const old=db.orderRequests[requestId];if(old){requireValue(old.hash===requestHash,'同一建单请求内容已变更，请重新建单');const order=db.orders.find(o=>o.id===old.id);requireValue(order,'历史建单记录不存在');return order;}}
 requireValue(db.users.some(c=>c.id===b.buyerId&&c.role==='buyer'&&c.boundAt),'请先完成客户绑定，再创建配送单');
 const rows=b.items===undefined?[{productId:b.productId,quantity:b.quantity}]:b.items;
 requireValue(Array.isArray(rows)&&rows.length>0&&rows.length<=20,'请添加1至20款面包');
 const seen=new Set();const items=rows.map(row=>{requireValue(row&&typeof row==='object','商品明细无效');const p=db.products.find(p=>p.id===row.productId);requireValue(p,'产品不存在');requireValue(!seen.has(p.id),'同一款面包请合并数量');seen.add(p.id);requireValue(Number.isInteger(row.quantity)&&row.quantity>0&&row.quantity<=50,'每款数量须为1至50的整数');return {productId:p.id,name:p.name,quantity:row.quantity,unitPrice:p.price,total:p.price*row.quantity,allergens:p.allergens};});
 const summary=items.map(i=>i.name+' × '+i.quantity).join('、');const total=items.reduce((sum,i)=>sum+i.total,0);const quantity=items.reduce((sum,i)=>sum+i.quantity,0);
 requireValue(buildings.includes(b.building),'请选择东苑1—13栋或西苑1—6栋');requireValue(deliveryDays.includes(b.deliveryDay),'请选择周一至周五的配送日');
 const o={merchantId:branding.merchantId,merchantName:branding.merchantName,id:crypto.randomUUID(),number:'MY'+Date.now().toString().slice(-8),buyerId:b.buyerId,items,summary,product:items.map(i=>i.name).join('、'),allergens:[...new Set(items.map(i=>i.allergens).filter(Boolean))].join('；'),quantity,total,building:b.building,address:handoffPoint,deliveryDay:b.deliveryDay,deliveryFrequency:'weekly',slot:`每${b.deliveryDay} ${deliveryWindow}（每周一次）`,campus:'四川师范大学成龙校区',stage:0,courierId:null,review:null,events:[{label:'商家已录单，等待备货',at:new Date().toISOString()}]};db.orders.unshift(o);if(requestId)db.orderRequests[requestId]={id:o.id,hash:requestHash};notify(db,o,'配送单已建立',`${o.summary}，${o.slot}，${o.building}楼下货架。`);return o;
 }
 const o=db.orders.find(o=>o.id===b.id);requireValue(o,'订单不存在');
 if(action==='delivery-issue'){
 requireValue((actor===o.buyerId&&o.stage>=3)||(actor==='courier'&&o.courierId===actor&&o.stage>=2&&o.stage<4)||(actor==='merchant'&&o.stage>0&&o.stage<4),'当前身份不能反馈该订单异常');requireValue(!o.issue,'已有异常等待商家处理');requireValue(typeof b.reason==='string'&&b.reason.trim().length>0&&b.reason.length<=200,'请填写200字以内的问题说明');
 o.issue={by:actor,reason:b.reason.trim(),at:new Date().toISOString()};o.events.push({label:'配送异常：'+o.issue.reason,at:o.issue.at});notify(db,o,'配送异常处理中',o.issue.reason+'。商家核实期间暂停推进状态。');return o;
 }
 if(action==='issue-resolve'){
 requireValue(actor==='merchant'&&o.issue,'仅商家可处理待核实异常');requireValue(b.confirmed===true&&b.expectedStage===o.stage,'请确认当前订单状态后重试');requireValue([1,2,3].includes(b.targetStage)&&b.targetStage<=o.stage,'请选择合理的恢复状态');requireValue(typeof b.reason==='string'&&b.reason.trim().length>0&&b.reason.length<=200,'请填写200字以内处理说明');
 o.events.push({label:'商家核实：'+b.reason.trim()+'；状态恢复为'+stages[b.targetStage],at:new Date().toISOString()});o.stage=b.targetStage;if(o.stage===1)o.courierId=null;if(o.review){o.previousReviews??=[];o.previousReviews.push(o.review);o.review=null;}o.issue=null;notify(db,o,'配送异常已处理',b.reason.trim()+'，当前状态：'+stages[o.stage]+'。');return o;
 }
 if(action==='progress'){
 requireValue(b.confirmed===true,'请先二次确认操作');requireValue(b.expectedStage===o.stage,'订单状态已变化，请刷新后重新确认');requireValue(!o.issue,'该订单有待处理异常，请商家先核实');
 const allowed=(actor==='merchant'&&o.stage===0)||(actor==='courier'&&o.stage===1)||(actor==='courier'&&o.courierId===actor&&o.stage===2)||(actor===o.buyerId&&o.stage===3);
 requireValue(allowed,'当前身份或订单状态不允许此操作');if(o.stage===1)o.courierId=actor;o.stage++;o.events.push({label:stages[o.stage],at:new Date().toISOString()});notify(db,o,['','面包已备好','配送员已取货，开始配送','面包已送达，请取货','签收成功'][o.stage],`${o.summary}，${o.building}楼下货架。`+(o.stage===3?'请实际拿到面包后再确认签收。':''));return o;
 }
 if(action==='review'){
 requireValue(actor===o.buyerId&&o.stage===4&&!o.review&&!o.issue,'仅买家签收后可评价一次');requireValue(Number.isInteger(b.rating)&&b.rating>=1&&b.rating<=5,'评分须为1至5星');requireValue(b.comment===undefined||(typeof b.comment==='string'&&b.comment.length<=500),'评价建议须为500字以内文本');o.review={rating:b.rating,comment:(b.comment??'').trim(),at:new Date().toISOString()};return o;
 }
 throw Error('未知操作');
}
export function view(db,actor){
 migrate(db);const user=db.users.find(u=>u.id===actor);const role=actor==='merchant'||actor==='courier'?actor:'buyer';
 const safeUser=u=>({id:u.id,name:u.name,bound:!!u.boundAt});
 return {branding,notifications:db.notifications.filter(n=>n.buyerId===actor),deliveryDays,deliveryWindow,handoffPoint,categories:db.categories,buildings,products:db.products,
 me:{id:actor,role,name:user?.name||(role==='merchant'?'日尝手作商家':'配送员'),bound:!!user?.boundAt,avatar:user?.avatar||''},
 customers:actor==='merchant'?db.users.filter(u=>u.role==='buyer'&&u.boundAt).map(safeUser):[],
 bindingRequests:actor==='merchant'||user?.role==='buyer'?db.bindingRequests.filter(r=>r.expiresAt>Date.now()&&(actor==='merchant'||r.buyerId===actor)).map(r=>({id:r.id,expiresAt:r.expiresAt,name:db.users.find(u=>u.id===r.buyerId)?.name,merchantName:'日尝手作'})):[],
 orders:db.orders.map(o=>({...o,merchantId:o.merchantId||branding.merchantId,merchantName:o.merchantName||branding.merchantName})).filter(o=>actor==='merchant'||actor==='courier'&&(o.stage===1||o.courierId===actor)||o.buyerId===actor).sort((a,b)=>actor==='courier'?Number(a.stage===4&&!a.issue)-Number(b.stage===4&&!b.issue):0),stages};
}
