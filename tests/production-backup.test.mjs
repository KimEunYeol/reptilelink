import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {productionRef,parseConnection,RemotePostgres,recoveryRef} from '../scripts/remote-postgres.mjs';
import {sourceRef,validateArchive,validateRecoveryJournal,readProductionEnvelope,pruneProduction,createProductionBackup} from '../scripts/production-backup.mjs';
import {recoverySql,restoreProductionBackup} from '../scripts/production-restore.mjs';
import {sha,backupStore,encrypt,publishPrivate,retentionMs} from '../scripts/backup-safety.mjs';
const format='reptilelink-production-backup-v1';
function connection(overrides={}){return Object.entries({PGHOST:'aws-0-ap-northeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'cli_login_postgres.'+productionRef,PGPASSWORD:'private-test-password',PGDATABASE:'postgres',...overrides}).map(([k,v])=>'export '+k+'='+JSON.stringify(v)).join('\n');}
const owner=randomUUID(),epoch=randomUUID(),actor=randomUUID();
function fixture(){
 const now=Date.now(),bytes=Buffer.from('private-file-test'),name='profile/variant.webp',id=sha('animal-media\0'+name),createdAt=new Date(now-1000).toISOString();
 const migrations=fs.readdirSync('supabase/migrations').filter(n=>/^\d+_.+\.sql$/.test(n)).sort().map(name=>({name,sha256:sha(fs.readFileSync('supabase/migrations/'+name))}));
 const state={createdAt,pgVersion:170011,epoch,epochStartedAt:'2026-10-30T00:00:00Z',accounts:[{id:actor,status:'active',provider:'google',hasProfile:true,isPublished:true}],withdrawals:[],project:{writesEnabled:false,admissionOpen:false},analyticsEnabled:false};
 const meta={state,userTriggers:[],foreignKeys:[{schema:'public',table:'profiles',name:'profiles_id_fkey',deferrable:false,initiallyDeferred:false}],migrations:migrations.map(m=>({version:m.name.split('_')[0]})),tables:[{schema:'public',name:'profiles'}],tableCounts:[{name:'public.profiles',count:1}],buckets:[{id:'animal-media',public:false}],objects:[{bucket_id:'animal-media',name,metadata:{size:bytes.length}}],media:[{ownerId:actor,state:'ready',path:name,bytes:bytes.length,sha256:sha(bytes)}]};
 return{now,value:{format,kind:'backup',id:randomUUID(),ownerId:owner,sourceProjectRef:productionRef,createdAt,meta,migrations,sql:{schema:'schema',data:'COPY public.profiles (id) FROM stdin;\n\\.\n',auth:'COPY auth.users (id) FROM stdin;\n\\.\nCOPY auth.identities (id) FROM stdin;\n\\.\n'},files:[{id,bytes:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64')}]},journal:{format,kind:'journal',id:randomUUID(),ownerId:owner,sourceProjectRef:productionRef,...state,createdAt:new Date(now).toISOString()}};
}
test('official connection must match exact ref, Seoul session pooler and database; values are not shell evaluated',()=>{
 assert.equal(parseConnection(connection(),productionRef).PGUSER,'cli_login_postgres.'+productionRef);
 for(const change of [{PGHOST:'evil.test'},{PGUSER:'postgres.otherproject'},{PGPORT:'6543'},{PGDATABASE:'other'},{PGPASSWORD:'a\nb'}])assert.throws(()=>parseConnection(connection(change),productionRef),/REMOTE_CONNECTION/);
 assert.throws(()=>parseConnection(connection()+'\nexport PGPASSWORD="duplicate"',productionRef),/FORMAT/);
 assert.throws(()=>parseConnection(connection().replace('"private-test-password"','$(touch /tmp/unsafe)'),productionRef),/FORMAT/);
 const literal='$(touch /tmp/unsafe)';assert.equal(parseConnection(connection({PGPASSWORD:literal}),productionRef).PGPASSWORD,literal);
 const db=new RemotePostgres(productionRef);db.connection=parseConnection(connection(),productionRef);db.name='test';
 const args=db.command('psql',[]);assert.ok(args.includes('-i'));assert.ok(!args.join(' ').includes('private-test-password'));assert.match(args.at(-1),/PGSSLMODE=verify-full/);assert.match(args.at(-1),/default_transaction_read_only=on/);
});
test('wrong source fails before filesystem/network and writes are restricted to the dedicated restore target',async()=>{
 assert.throws(()=>sourceRef('jlxrhjblfdyqkfnjimgx'),/SOURCE_REF_REQUIRED/);
 await assert.rejects(createProductionBackup('wrong',{root:'/must-not-be-created',keyRoot:'/nor-this'}),/SOURCE_REF_REQUIRED/);
 assert.throws(()=>new RemotePostgres(productionRef,{writable:true}),/SOURCE_RESTORE_REFUSED/);
 assert.throws(()=>new RemotePostgres('jlxrhjblfdyqkfnjimgx',{writable:true}),/SOURCE_RESTORE_REFUSED/);
 assert.doesNotThrow(()=>new RemotePostgres(recoveryRef,{writable:true}));
 const r=spawnSync(process.execPath,['scripts/production-backup-cli.mjs','create','wrong'],{encoding:'utf8'});assert.equal(r.status,1);assert.equal(r.stderr.trim(),'PRODUCTION_SOURCE_REF_REQUIRED');
});
test('actual bytes, metadata and ready-file hashes are required; missing/changed/duplicate files fail',()=>{
 const {value}=fixture();assert.equal(validateArchive(value).size,1);
 for(const mutate of [v=>v.files.pop(),v=>v.files[0].base64=Buffer.from('different').toString('base64'),v=>v.meta.media[0].sha256='0'.repeat(64),v=>v.meta.objects[0].metadata.size++,v=>v.meta.objects[0].bucket_id='public',v=>v.meta.buckets[0].public=true,v=>v.meta.objects[0].name='../outside',v=>v.meta.objects[0].metadata.size=0]){const v=structuredClone(value);mutate(v);assert.throws(()=>validateArchive(v),/PRODUCTION_/);}
});
test('migration SHA, retention, provider identities and managed session data are checked',()=>{
 const {value,now}=fixture();
 for(const mutate of [v=>v.migrations[0].sha256='0'.repeat(64),v=>v.meta.migrations.pop(),v=>v.createdAt=new Date(now-retentionMs-1).toISOString(),v=>v.meta.state.accounts[0].provider='email',v=>v.sql.data+='\nCOPY auth.sessions (id) FROM stdin;\n\\.\n',v=>v.sql.data+='\nCOPY vault.secrets (id) FROM stdin;\n\\.\n',v=>v.meta.tableCounts[0].count=-1]){const v=structuredClone(value);mutate(v);assert.throws(()=>validateArchive(v,now),/PRODUCTION_/);}
});
test('latest journal excludes withdrawn/deleting/missing accounts and rejects stale/foreign/duplicate/incomplete state',()=>{
 const {value,journal,now}=fixture();assert.equal(validateRecoveryJournal(value,journal,now).size,0);
 for(const mutate of [j=>j.accounts=[],j=>j.accounts[0].status='deleting',j=>j.withdrawals=[{id:actor,requestedAt:new Date(now).toISOString()}]]){const j=structuredClone(journal);mutate(j);assert.ok(validateRecoveryJournal(value,j,now).has(actor));}
 for(const mutate of [j=>j.createdAt=new Date(now-16*60000).toISOString(),j=>j.epoch=randomUUID(),j=>j.accounts.push(j.accounts[0]),j=>delete j.project,j=>delete j.accounts[0].isPublished,j=>j.sourceProjectRef='another']){const j=structuredClone(journal);mutate(j);assert.throws(()=>validateRecoveryJournal(value,j,now),/PRODUCTION_JOURNAL/);}
});
test('authenticate before envelope interpretation, reject local format and foreign source',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'reptilelink-remote-test-'));
 try{const {store,key}=backupStore(base+'/archive',base+'/keys',{create:true}),{value}=fixture();value.ownerId=store.id;
  const file=store.path+'/'+value.id+'.rlbk';publishPrivate(file,encrypt(value,key,'backup'));assert.equal(readProductionEnvelope(file,key,'backup').id,value.id);
  assert.throws(()=>readProductionEnvelope(file,randomBytes(32),'backup'),/AUTHENTICATION/);
  for(const mutate of [v=>v.format='reptilelink-backup-v1',v=>v.sourceProjectRef='other']){const v=structuredClone(value);mutate(v);const f=store.path+'/'+randomUUID()+'.rlbk';publishPrivate(f,encrypt(v,key,'backup'));assert.throws(()=>readProductionEnvelope(f,key,'backup'),/ENVELOPE/);}
 }finally{fs.rmSync(base,{recursive:true});}
});
test('retention only removes authenticated expired same-store/ref/id files; unknown and tampered files remain',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'reptilelink-remote-prune-'));
 try{const {store,key}=backupStore(base+'/archive',base+'/keys',{create:true}),now=Date.now(),old=new Date(now-retentionMs-1).toISOString();let removed;
  for(const kind of ['ours','foreign','future','unknown','filename']){const id=randomUUID(),v={format,kind:'backup',id,ownerId:store.id,sourceProjectRef:productionRef,createdAt:old};if(kind==='foreign')v.sourceProjectRef='other';if(kind==='future')v.createdAt=new Date(now+120000).toISOString();if(kind==='unknown')v.format='unknown';const f=store.path+'/'+(kind==='filename'?randomUUID():id)+'.rlbk';publishPrivate(f,encrypt(v,key,'backup'));if(kind==='ours')removed=f;}
  const bad=store.path+'/'+randomUUID()+'.rlbk';publishPrivate(bad,Buffer.from('retain invalid'));
  assert.deepEqual(pruneProduction(store,key,now),{removed:1,unverifiedRetained:5});assert.equal(fs.existsSync(removed),false);assert.equal(fs.existsSync(bad),true);
 }finally{fs.rmSync(base,{recursive:true});}
});

test('restore refuses source/other targets before credentials; SQL verifies empty target and keeps quarantine',async()=>{
 await assert.rejects(restoreProductionBackup('missing','missing',productionRef),/TARGET_REFUSED/);
 await assert.rejects(restoreProductionBackup('missing','missing','jlxrhjblfdyqkfnjimgx'),/TARGET_REFUSED/);
 const cli=spawnSync(process.execPath,['scripts/production-backup-cli.mjs','restore',productionRef,'missing','missing',productionRef],{encoding:'utf8'});assert.equal(cli.status,1);assert.equal(cli.stderr.trim(),'PRODUCTION_RESTORE_TARGET_REFUSED');
 const {value,journal}=fixture();journal.accounts[0].status='suspended';journal.accounts[0].isPublished=false;
 const sql=recoverySql(value,journal,new Set());
 assert.match(sql,/RESTORE_TARGET_NOT_EMPTY/);assert.match(sql,/LOCK auth.users,storage.objects IN ACCESS EXCLUSIVE/);
 assert.match(sql,/status='suspended'/);assert.match(sql,/is_published=false/);assert.match(sql,/writes_enabled=false,admission_open=false/);assert.ok(!sql.includes('session_replication_role'));assert.match(sql,/SET CONSTRAINTS ALL IMMEDIATE/);assert.match(sql,/NOT DEFERRABLE INITIALLY IMMEDIATE/);assert.ok(sql.indexOf('COPY auth.users')<sql.indexOf('DELETE FROM private.account_state'));assert.ok(sql.indexOf('DELETE FROM private.account_state')<sql.indexOf('COPY public.profiles'));
 assert.ok(!/TRUNCATE auth/.test(sql));assert.match(sql,/recovery_token/);
 const withdrawn=recoverySql(value,journal,new Set([actor]));assert.match(withdrawn,/api\.request_account_deletion/);assert.match(withdrawn,/api\.complete_account_deletion/);assert.ok(!/storage\.objects WHERE/.test(withdrawn));
});
