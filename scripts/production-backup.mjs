import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {backupStore,encrypt,decrypt,readPrivate,publishPrivate,insist,sha,uuidPattern,retentionMs,journalMaxAge} from './backup-safety.mjs';
import {run,identifier as ident,literal as q} from './backup-db.mjs';
import {downloadStorage} from './backup-restore.mjs';
import {RemotePostgres,productionRef} from './remote-postgres.mjs';
const format='reptilelink-production-backup-v1';
const root='/home/eykim/projects/.reptilelink-production-backups',keyRoot='/home/eykim/projects/.reptilelink-production-backup-keys';
const maxObjects=4096,maxBytes=256*1024*1024;
const migrations=()=>fs.readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>/^\d+_.+\.sql$/.test(n)).sort().map(name=>({name,sha256:sha(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url)))}));
const objectId=o=>sha(o.bucket_id+'\0'+o.name);
export function sourceRef(ref){insist(ref===productionRef,'PRODUCTION_SOURCE_REF_REQUIRED');return ref;}
export const stateSql="select json_build_object("+
 "'createdAt',clock_timestamp(),'pgVersion',current_setting('server_version_num')::integer,"+
 "'epoch',(select journal_epoch from private.recovery_settings where id=1),'epochStartedAt',(select started_at from private.recovery_settings where id=1),"+
 "'accounts',(select coalesce(json_agg(json_build_object('id',u.id,'status',s.status,'hasProfile',p.id is not null,'isPublished',coalesce(p.is_published,false),'provider',u.raw_app_meta_data->>'provider')order by u.id),'[]')from auth.users u left join private.account_state s on s.user_id=u.id left join public.profiles p on p.id=u.id),"+
 "'withdrawals',(select coalesce(json_agg(json_build_object('id',user_id,'requestedAt',requested_at,'completedAt',completed_at)order by user_id),'[]')from private.account_withdrawals),"+
 "'project',(select json_build_object('writesEnabled',writes_enabled,'admissionOpen',admission_open)from private.project_budget where id=1),"+
 "'analyticsEnabled',(select enabled from private.analytics_settings where id=1));";
const metaSql="select json_build_object("+
 "'userTriggers',(select coalesce(json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled)order by n.nspname,c.relname,t.tgname),'[]')from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in('api','private','public')),"+
 "'foreignKeys',(select coalesce(json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'deferrable',k.condeferrable,'initiallyDeferred',k.condeferred)order by n.nspname,c.relname,k.conname),'[]')from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where k.contype='f'and n.nspname in('api','private','public')),"+
 "'authCounts',(select json_build_object('users',(select count(*)from auth.users),'identities',(select count(*)from auth.identities))),"+
 "'migrations',(select coalesce(json_agg(json_build_object('version',version,'name',name)order by version),'[]')from supabase_migrations.schema_migrations),"+
 "'tables',(select coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname)order by n.nspname,c.relname),'[]')from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('api','private','public')and c.relkind in('r','p')),"+
 "'buckets',(select coalesce(json_agg(json_build_object('id',id,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)order by id),'[]')from storage.buckets),"+
 "'objects',(select coalesce(json_agg(json_build_object('bucket_id',bucket_id,'name',name,'metadata',jsonb_strip_nulls(jsonb_build_object('size',metadata->'size','mimetype',metadata->'mimetype')))order by bucket_id,name),'[]')from storage.objects),"+
 "'media',(select coalesce(json_agg(json_build_object('ownerId',m.profile_id,'state',m.state,'path',o.object_path,'bytes',o.byte_size,'sha256',o.sha256)order by o.object_path),'[]')from private.media_assets m join private.media_objects o on o.asset_id=m.id));";
export function validateMeta(meta){
 insist(meta&&meta.state?.pgVersion===170011&&uuidPattern.test(meta.state.epoch),'PRODUCTION_SOURCE_VERSION_INVALID');
 insist(Array.isArray(meta.state.accounts)&&meta.state.accounts.every(a=>uuidPattern.test(a.id)&&a.provider==='google'),'PRODUCTION_GOOGLE_IDENTITIES_REQUIRED');
 insist(Array.isArray(meta.userTriggers)&&meta.userTriggers.every(t=>['api','private','public'].includes(t.schema)&&[t.table,t.name].every(n=>/^[a-z][a-z0-9_]*$/.test(n))&&t.enabled==='O')&&Array.isArray(meta.foreignKeys)&&meta.foreignKeys.every(k=>['api','private','public'].includes(k.schema)&&[k.table,k.name].every(n=>/^[a-z][a-z0-9_]*$/.test(n))&&typeof k.deferrable==='boolean'&&typeof k.initiallyDeferred==='boolean')&&Array.isArray(meta.media)&&Array.isArray(meta.objects)&&meta.objects.length<=maxObjects&&Array.isArray(meta.buckets)&&meta.buckets.length===1&&meta.buckets[0].id==='animal-media'&&!meta.buckets[0].public,'PRODUCTION_STORAGE_INVALID');
 insist(meta.objects.every(o=>o.bucket_id==='animal-media'&&typeof o.name==='string'&&o.name.length<=1024&&!/[\0\r\n\\]/.test(o.name)&&o.name.split('/').every(p=>p&&p!=='.'&&p!=='..')),'PRODUCTION_STORAGE_INVALID');
 insist(new Set(meta.objects.map(objectId)).size===meta.objects.length,'PRODUCTION_STORAGE_DUPLICATE');
 insist(Array.isArray(meta.tables)&&meta.tables.length>0&&meta.tables.every(t=>['api','private','public'].includes(t.schema)&&/^[a-z][a-z0-9_]*$/.test(t.name)),'PRODUCTION_TABLES_INVALID');
 insist(JSON.stringify(meta.migrations?.map(m=>m.version))===JSON.stringify(migrations().map(m=>m.name.split('_')[0])),'PRODUCTION_MIGRATIONS_MISMATCH');
}
export function validateArchive(value,now=Date.now()){
 insist(value?.format===format&&value.kind==='backup'&&value.sourceProjectRef===productionRef&&uuidPattern.test(value.id),'PRODUCTION_ARCHIVE_INVALID');
 const age=now-Date.parse(value.createdAt);insist(age>=-60000&&age<=retentionMs,'PRODUCTION_ARCHIVE_EXPIRED');
 validateMeta(value.meta);insist(JSON.stringify(value.migrations)===JSON.stringify(migrations()),'PRODUCTION_MIGRATIONS_MISMATCH');
 insist(value.sql&&['schema','auth','data'].every(k=>typeof value.sql[k]==='string'&&Buffer.byteLength(value.sql[k])<=64*1024*1024),'PRODUCTION_SQL_INVALID');
 const copied=[...value.sql.data.matchAll(/^COPY "?([a-z_]+)"?\."?([a-z_]+)"?\s*\(/gm)].map(m=>m[1]+'.'+m[2]);
 const authCopied=[...value.sql.auth.matchAll(/^COPY "?([a-z_]+)"?\."?([a-z_]+)"?\s*\(/gm)].map(m=>m[1]+'.'+m[2]);
 insist(copied.length>0&&copied.every(t=>t.startsWith('api.')||t.startsWith('private.')||t.startsWith('public.'))&&authCopied.length===2&&authCopied.every(t=>['auth.users','auth.identities'].includes(t)),'PRODUCTION_MANAGED_DATA_REFUSED');
 insist(Array.isArray(value.files)&&value.files.length===value.meta.objects.length,'PRODUCTION_FILES_MISSING');
 insist(Array.isArray(value.meta.tableCounts)&&value.meta.tableCounts.length===value.meta.tables.length&&value.meta.tableCounts.every(t=>Number.isSafeInteger(t.count)&&t.count>=0),'PRODUCTION_TABLE_COUNTS_INVALID');
 const files=new Map();let total=0;
 for(const f of value.files){
  insist(/^[a-f0-9]{64}$/.test(f.id)&&!files.has(f.id)&&typeof f.base64==='string'&&f.base64.length<=700000,'PRODUCTION_FILE_INVALID');
  const bytes=Buffer.from(f.base64,'base64');total+=bytes.length;
  insist(bytes.length>0&&bytes.length===f.bytes&&bytes.length<=512*1024&&total<=maxBytes&&sha(bytes)===f.sha256&&bytes.toString('base64')===f.base64,'PRODUCTION_FILE_HASH_INVALID');files.set(f.id,f);
 }
 for(const o of value.meta.objects){const f=files.get(objectId(o));insist(f&&(o.metadata?.size==null||Number(o.metadata.size)===f.bytes),'PRODUCTION_OBJECT_MISSING');}
 for(const m of value.meta.media){if(m.state==='ready'||m.sha256){const f=files.get(sha('animal-media\0'+m.path));insist(f&&f.bytes===m.bytes&&f.sha256===m.sha256,'PRODUCTION_READY_FILE_MISSING');}}
 return files;
}
export function validateRecoveryJournal(backup,journal,now=Date.now()){
 insist(journal?.format===format&&journal.kind==='journal'&&journal.sourceProjectRef===backup.sourceProjectRef&&journal.epoch===backup.meta.state.epoch&&journal.epochStartedAt===backup.meta.state.epochStartedAt,'PRODUCTION_JOURNAL_INVALID');
 const age=now-Date.parse(journal.createdAt);insist(age>=-60000&&age<=journalMaxAge&&Date.parse(journal.createdAt)>=Date.parse(backup.createdAt),'PRODUCTION_JOURNAL_STALE');
 insist(Array.isArray(journal.accounts)&&journal.accounts.every(a=>uuidPattern.test(a.id)&&['active','pending','suspended','deleting'].includes(a.status))&&new Set(journal.accounts.map(a=>a.id)).size===journal.accounts.length&&Array.isArray(journal.withdrawals)&&journal.withdrawals.every(w=>uuidPattern.test(w.id)&&Number.isFinite(Date.parse(w.requestedAt))),'PRODUCTION_JOURNAL_INVALID');
 insist(journal.accounts.every(a=>typeof a.isPublished==='boolean'&&typeof a.hasProfile==='boolean')&&typeof journal.project?.writesEnabled==='boolean'&&typeof journal.project?.admissionOpen==='boolean'&&typeof journal.analyticsEnabled==='boolean','PRODUCTION_JOURNAL_INVALID');
 const current=new Map(journal.accounts.map(a=>[a.id,a]));
 return new Set([...journal.withdrawals.map(a=>a.id),...backup.meta.state.accounts.filter(a=>!current.has(a.id)||current.get(a.id).status==='deleting').map(a=>a.id)]);
}
const wrap=(kind,store,ref,data)=>({format,kind,id:randomUUID(),ownerId:store.id,sourceProjectRef:sourceRef(ref),createdAt:new Date().toISOString(),...data});
async function readState(ref){
 const db=new RemotePostgres(sourceRef(ref));
 try{await db.start();return await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL ROLE postgres; '+stateSql+' ROLLBACK;');}finally{await db.close();}
}
export async function createProductionJournal(ref,options={}){
 sourceRef(ref);const state=await readState(ref);const {store,key}=backupStore(options.root??root,options.keyRoot??keyRoot,{create:true});
 const value=wrap('journal',store,ref,state),file=path.join(store.path,value.id+'.rljr');publishPrivate(file,encrypt(value,key,'journal'));return{file,value};
}
export async function storageKey(ref){
 const data=JSON.parse((await run('npx',['supabase','projects','api-keys','--project-ref',ref,'--reveal','--output','json'],{stage:'PRODUCTION_STORAGE_KEY',limit:128*1024})).toString());
 const keys=Array.isArray(data)?data:data.api_keys??data.keys;
 const key=keys?.find(k=>k.type==='secret'&&k.api_key?.startsWith('sb_secret_'));
 insist(key,'PRODUCTION_STORAGE_KEY_UNAVAILABLE');return key.api_key;
}
export async function createProductionBackup(ref,options={}){
 sourceRef(ref);
 const {store,key}=backupStore(options.root??root,options.keyRoot??keyRoot,{create:true}),db=new RemotePostgres(ref);
 let meta,sql;
 try{
  await db.start();await db.openSnapshot();
  meta=await db.snapshotQuery(metaSql);meta.state=await db.snapshotQuery(stateSql);validateMeta(meta);
  const counts=meta.tables.map(t=>'select '+q(t.schema+'.'+t.name)+' as name,count(*) as count from '+ident(t.schema)+'.'+ident(t.name)).join(' union all ');
  meta.tableCounts=await db.snapshotQuery('select json_agg(row_to_json(t)order by name)from('+counts+')t;');
  sql={schema:(await db.dump(['--schema-only','--schema=public','--schema=private','--schema=api'])).toString(),
   auth:(await db.dump(['--data-only','--table=auth.users','--table=auth.identities'])).toString(),
   data:(await db.dump(['--data-only','--table=public.*','--table=private.*','--table=api.*'])).toString()};
 }finally{await db.close();}
 let secret,total=0;const files=[];
 if(meta.objects.length)secret=await storageKey(ref);
 try{for(const object of meta.objects){
  const bytes=await downloadStorage(object,{url:'https://'+ref+'.supabase.co',secret});total+=bytes.length;insist(total<=maxBytes,'PRODUCTION_FILES_TOO_LARGE');
  files.push({id:objectId(object),bytes:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64')});
 }}finally{secret=undefined;}
 const tool={head:(await run('git',['rev-parse','HEAD'],{stage:'PRODUCTION_TOOL_HEAD',limit:4096})).toString().trim(),dirty:!!(await run('git',['status','--porcelain'],{stage:'PRODUCTION_TOOL_STATE',limit:128*1024})).length,files:['remote-postgres.mjs','production-backup.mjs','production-restore.mjs','production-backup-cli.mjs'].map(name=>({name,sha256:sha(fs.readFileSync(new URL('./'+name,import.meta.url)))}))};
 const value=wrap('backup',store,ref,{createdAt:meta.state.createdAt,meta,sql,migrations:migrations(),files,tool});validateArchive(value);
 const journal=await createProductionJournal(ref,options);validateRecoveryJournal(value,journal.value);
 const file=path.join(store.path,value.id+'.rlbk');publishPrivate(file,encrypt(value,key,'backup'));
 return{file,journal:journal.file,id:value.id,sourceProjectRef:ref,objects:files.length,bytes:total,createdAt:value.createdAt,pruning:pruneProduction(store,key),remoteRestoreVerified:false};
}
export function readProductionEnvelope(file,key,kind){
 const value=decrypt(readPrivate(file),key,kind);
 insist(value?.format===format&&value.kind===kind&&value.sourceProjectRef===productionRef&&uuidPattern.test(value.id)&&uuidPattern.test(value.ownerId)&&Number.isFinite(Date.parse(value.createdAt)),'PRODUCTION_ENVELOPE_INVALID');return value;
}
export function pruneProduction(store,key,now=Date.now()){
 let removed=0,unverifiedRetained=0;
 for(const name of fs.readdirSync(store.path)){
  const match=name.match(/^([a-f0-9-]{36})\.(rlbk|rljr)$/);if(!match)continue;
  const file=path.join(store.path,name);let v;
  try{v=decrypt(readPrivate(file),key,match[2]==='rlbk'?'backup':'journal');}catch{unverifiedRetained++;continue;}
  const known=[format,'reptilelink-empty-prelaunch-snapshot-v1'].includes(v?.format);
  if(!known||v.id!==match[1]||v.ownerId!==store.id||v.sourceProjectRef!==productionRef||v.kind!==(match[2]==='rlbk'?'backup':'journal')||!Number.isFinite(Date.parse(v.createdAt))||Date.parse(v.createdAt)>now+60000){unverifiedRetained++;continue;}
  if(Date.parse(v.createdAt)<now-retentionMs){fs.unlinkSync(file);removed++;}
 }
 return{removed,unverifiedRetained};
}
export function inspectProductionBackup(file,options={}){
 const {key}=backupStore(options.root??root,options.keyRoot??keyRoot),value=readProductionEnvelope(file,key,'backup');validateArchive(value);
 return{sourceProjectRef:value.sourceProjectRef,createdAt:value.createdAt,tables:value.meta.tables.length,objects:value.files.length,migrations:value.migrations.length,remoteRestoreVerified:false};
}
export async function runProductionCommand(argv=process.argv.slice(2)){
 const [command,ref,...args]=argv;insist(command&&ref,'PRODUCTION_COMMAND_AND_SOURCE_REF_REQUIRED');
 if(command==='create'){insist(args.length===0,'PRODUCTION_ARGUMENTS_INVALID');return createProductionBackup(ref);}
 if(command==='journal'){insist(args.length===0,'PRODUCTION_ARGUMENTS_INVALID');const r=await createProductionJournal(ref);return{file:r.file,createdAt:r.value.createdAt};}
 if(command==='restore'){sourceRef(ref);insist(args.length===3,'PRODUCTION_ARGUMENTS_INVALID');const {restoreProductionBackup}=await import('./production-restore.mjs');return restoreProductionBackup(args[0],args[1],args[2]);}
 if(command==='prune'){sourceRef(ref);insist(args.length===0,'PRODUCTION_ARGUMENTS_INVALID');const {store,key}=backupStore(root,keyRoot);return pruneProduction(store,key);}
 if(command==='inspect'){sourceRef(ref);insist(args.length===1,'PRODUCTION_ARGUMENTS_INVALID');return inspectProductionBackup(args[0]);}
 throw Error('PRODUCTION_COMMAND_UNAVAILABLE');
}
