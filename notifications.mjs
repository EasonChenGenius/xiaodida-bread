// 模板ID及字段必须与微信后台获批模板一致；微信服务端决定订阅额度是否可用。
export function createNotifier({appId=process.env.WECHAT_APP_ID,secret=process.env.WECHAT_APP_SECRET,templates={},fetchImpl=fetch}={}){
 let token,until=0;
 const request=async(url,options)=>{const r=await fetchImpl(url,{...options,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('微信通知服务暂不可用');return r.json();};
 return {groups:Object.values(templates).reduce((groups,t)=>{if(!groups.flat().includes(t.id)){if(!groups.length||groups.at(-1).length===3)groups.push([]);groups.at(-1).push(t.id);}return groups;},[]),
 async send(n,openid){const t=templates[n.stage];if(!t||!appId||!secret||!openid)return {status:'unconfigured'};
 try{
 if(!token||until<=Date.now()){const url=new URL('https://api.weixin.qq.com/cgi-bin/token');url.search=new URLSearchParams({grant_type:'client_credential',appid:appId,secret});const d=await request(url);if(!d.access_token)throw Error('无法获取微信通知凭证');token=d.access_token;until=Date.now()+Math.max(0,(Number(d.expires_in)||7200)-120)*1000;}
 const values={title:n.title,product:n.product,location:n.location,number:n.number,message:n.message};const data={};
 for(const [key,field]of Object.entries(t.fields)){const max=key.startsWith('thing')?20:32;data[key]={value:String(values[field]||'').slice(0,max)};}
 const d=await request('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({touser:openid,template_id:t.id,page:'pages/home/index',data,miniprogram_state:process.env.WECHAT_MINIPROGRAM_STATE||'trial',lang:'zh_CN'})});
 return d.errcode===0?{status:'sent'}:{status:'failed',code:d.errcode};
 }catch{return {status:'failed',code:'network_or_config'};}
 }};
}
export function readTemplates(raw=process.env.WECHAT_DELIVERY_TEMPLATES){if(!raw)return {};const data=JSON.parse(raw);for(const [stage,t]of Object.entries(data)){if(!/^[0-4]$/.test(stage)||!t||typeof t.id!=='string'||!t.id||!t.fields||Object.entries(t.fields).some(([k,v])=>!/^\w+\d+$/.test(k)||!['title','product','location','number','message'].includes(v)))throw Error('微信订阅模板配置无效');}return data;}
