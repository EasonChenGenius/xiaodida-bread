import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,readFileSync,mkdirSync,copyFileSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
export function openStore(file,create){
 mkdirSync(dirname(file),{recursive:true});const sqlite=file.endsWith('.sqlite')?file:file.replace(/\.json$/, '')+'.sqlite';
 const db=new DatabaseSync(sqlite);chmodSync(sqlite,0o600);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL)');
 let record=db.prepare('SELECT revision,data FROM app_state WHERE id=1').get();
 if(!record){let state;if(file!==sqlite&&existsSync(file)){state=JSON.parse(readFileSync(file,'utf8'));copyFileSync(file,file+'.before-sqlite-'+Date.now()+'.bak');}else state=create();db.prepare('INSERT INTO app_state VALUES(1,0,?)').run(JSON.stringify(state));record={revision:0,data:JSON.stringify(state)};}
 let revision=record.revision;
 return {kind:'sqlite',file:sqlite,load(){return JSON.parse(db.prepare('SELECT data FROM app_state WHERE id=1').get().data)},save(state){db.exec('BEGIN IMMEDIATE');try{const result=db.prepare('UPDATE app_state SET data=?, revision=revision+1 WHERE id=1 AND revision=?').run(JSON.stringify(state),revision);if(result.changes!==1)throw Error('数据已被其他进程更新，请重启服务后重试');db.exec('COMMIT');revision++;}catch(e){db.exec('ROLLBACK');throw e;}},
 async getState(){return JSON.parse(db.prepare('SELECT data FROM app_state WHERE id=1').get().data)},
 async transact(callback){
  // Local SQLite uses optimistic revision checks: never keep a synchronous DB lock
  // across a network await. A competing writer causes 409, never a lost update.
  const record=db.prepare('SELECT revision,data FROM app_state WHERE id=1').get();
  const draft=JSON.parse(record.data),result=await callback(draft);
  db.exec('BEGIN IMMEDIATE');
  try{const saved=db.prepare('UPDATE app_state SET data=?,revision=revision+1 WHERE id=1 AND revision=?').run(JSON.stringify(draft),record.revision);
   if(saved.changes!==1)throw Object.assign(Error('数据已被其他进程更新，请重新同步后重试'),{status:409});
   db.exec('COMMIT');revision=record.revision+1;return result;
  }catch(e){db.exec('ROLLBACK');throw e;}
 },
 async ping(){db.prepare('SELECT 1').get();return true},
 async backup(destination){if(existsSync(destination))throw Error('备份目标已存在，请使用新文件名');await backup(db,destination);chmodSync(destination,0o600)},close(){db.close()}};
}
