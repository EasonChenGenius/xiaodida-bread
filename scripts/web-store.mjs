import {openStore}from'../storage.mjs';import{initialCloudState}from'../seed-products.mjs';
export async function openWebStore(env=process.env){
 if(env.BREAD_AUTH_MODE!=='web')throw Error('须显式设置 BREAD_AUTH_MODE=web');
 if(env.NODE_ENV==='production'&&env.BREAD_STORE!=='mysql')throw Error('正式环境只能使用MySQL');
 if(env.BREAD_STORE==='mysql')return(await import('../mysql-store.mjs')).openMySqlStore({config:{host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT||3306),user:env.MYSQL_USER,password:env.MYSQL_PASSWORD,database:env.MYSQL_DATABASE},create:initialCloudState});
 if(env.BREAD_STORE!==undefined&&env.BREAD_STORE!=='sqlite')throw Error('BREAD_STORE配置无效');
 return openStore('data/web.json',initialCloudState);
}
