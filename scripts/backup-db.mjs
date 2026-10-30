import{spawn}from'node:child_process';
import{randomUUID}from'node:crypto';
import{insist,sha}from'./backup-safety.mjs';
export const sourceContainer='supabase_db_reptilelink',postgresImage='public.ecr.aws/supabase/postgres:17.11.0.006';
export const restoreUser='supabase_admin',restoreDatabase='reptilelink_recovered';
const maxSql=64*1024*1024;
export function run(command,args,{input,limit=maxSql,timeout=90000,stage='BACKUP_COMMAND'}={}){
 return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let size=0,errorText='',settled=false;const chunks=[];const fail=code=>{if(settled)return;settled=true;child.kill('SIGTERM');reject(Error(code));};const timer=setTimeout(()=>fail(stage+'_TIMEOUT'),timeout);
 child.on('error',()=>fail(stage+'_FAILED'));child.stdout.on('data',chunk=>{size+=chunk.length;if(size>limit)fail(stage+'_TOO_LARGE');else chunks.push(chunk);});child.stderr.on('data',chunk=>{if(errorText.length<4096)errorText+=chunk.toString();});child.stdin.on('error',()=>{});
 child.on('close',code=>{clearTimeout(timer);if(settled)return;settled=true;if(code!==0){const state=errorText.match(/ERROR:\s+([0-9A-Z]{5})\b/)?.[1];const app=errorText.match(/ERROR:\s+[0-9A-Z]{5}:\s+([A-Z][A-Z_]{2,80})(?:\r?\n|$)/)?.[1];reject(Error(stage+'_FAILED'+(state?'_'+state:'')+(app?'_'+app:'')));}else resolve(Buffer.concat(chunks));});child.stdin.end(input);
 });
}
export async function sourceQuery(sql){const data=await run('docker',['exec','-i',sourceContainer,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{input:sql,stage:'BACKUP_SOURCE_QUERY'});try{return JSON.parse(data.toString());}catch{throw Error('BACKUP_SOURCE_RESULT_INVALID');}}
export const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export const identifier=value=>'"'+String(value).replaceAll('"','""')+'"';
const roleSettings=new Set(['statement_timeout','lock_timeout','search_path','session_preload_libraries','idle_in_transaction_session_timeout','default_transaction_read_only','log_statement']);
async function roles(){
 const keys=await sourceQuery("select coalesce(json_agg(split_part(c,'=',1)),'[]')from pg_roles,unnest(rolconfig)c");insist(keys.every(k=>roleSettings.has(k)),'BACKUP_ROLE_SETTING_NOT_ALLOWLISTED');
 const sql=(await run('docker',['exec',sourceContainer,'pg_dumpall','-U','postgres','--roles-only','--no-role-passwords','--no-comments','--no-security-labels'],{stage:'BACKUP_ROLES'})).toString();
 insist(!/CREATE ROLE reptilelink_restore_admin;/.test(sql),'BACKUP_RESERVED_ROLE_PRESENT');
 const after=await sourceQuery("select coalesce(json_agg(split_part(c,'=',1)),'[]')from pg_roles,unnest(rolconfig)c");insist(after.every(k=>roleSettings.has(k)),'BACKUP_ROLE_SETTING_NOT_ALLOWLISTED');return sql;
}
class Snapshot{
 constructor(){this.lines='';this.pending=[];this.closed=false;this.child=spawn('docker',['exec','-i',sourceContainer,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{stdio:['pipe','pipe','pipe']});this.child.stdout.on('data',chunk=>{this.lines+=chunk.toString();if(this.lines.length>16*1024*1024){this.fail();return;}let index;while((index=this.lines.indexOf('\n'))>=0){const line=this.lines.slice(0,index);this.lines=this.lines.slice(index+1);if(line)this.pending.shift()?.resolve(line);}});this.child.stderr.on('data',chunk=>{this.sqlState=chunk.toString().match(/ERROR:\s+([0-9A-Z]{5})\b/)?.[1]??this.sqlState;});this.child.on('error',()=>this.fail());this.child.on('close',()=>{this.closed=true;this.fail();});this.child.stdin.on('error',()=>this.fail());}
 fail(){for(const p of this.pending.splice(0))p.reject(Error('BACKUP_SNAPSHOT_FAILED'+(this.sqlState?'_'+this.sqlState:'')));}
 async query(sql){insist(!this.closed,'BACKUP_SNAPSHOT_CLOSED');const line=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('BACKUP_SNAPSHOT_TIMEOUT')),90000);this.pending.push({resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});this.child.stdin.write(sql+'\n');});try{return JSON.parse(line);}catch{throw Error('BACKUP_SNAPSHOT_RESULT_INVALID');}}
 async close(){if(this.closed)return;this.child.stdin.end('ROLLBACK;\n\\q\n');await new Promise(resolve=>{if(this.closed)return resolve();const timer=setTimeout(()=>{this.child.kill('SIGTERM');resolve();},3000);this.child.once('close',()=>{clearTimeout(timer);resolve();});});}
}
const metadataSql=`select json_build_object(
 'createdAt',clock_timestamp(),'pgVersion',current_setting('server_version_num')::integer,
 'epoch',(select journal_epoch from private.recovery_settings where id=1),'epochStartedAt',(select started_at from private.recovery_settings where id=1),
 'migrations',(select coalesce(json_agg(json_build_object('version',version,'name',name)order by version),'[]')from supabase_migrations.schema_migrations),
 'accounts',(select coalesce(json_agg(json_build_object('id',u.id,'isAnonymous',coalesce(u.is_anonymous,false),'status',s.status,'hasProfile',p.id is not null,'isPublished',coalesce(p.is_published,false))order by u.id),'[]')from auth.users u left join private.account_state s on s.user_id=u.id left join public.profiles p on p.id=u.id),
 'withdrawals',(select coalesce(json_agg(json_build_object('id',user_id,'requestedAt',requested_at,'completedAt',completed_at)order by user_id),'[]')from private.account_withdrawals),
 'project',(select json_build_object('writesEnabled',writes_enabled,'admissionOpen',admission_open)from private.project_budget where id=1),
 'analyticsEnabled',(select enabled from private.analytics_settings where id=1),
 'buckets',(select coalesce(json_agg(json_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)order by id),'[]')from storage.buckets where id='animal-media'),
 'objects',(select coalesce(json_agg(json_build_object('id',id,'bucket_id',bucket_id,'name',name,'owner',owner,'owner_id',owner_id,'created_at',created_at,'updated_at',updated_at,'version',version,'metadata',jsonb_strip_nulls(jsonb_build_object('mimetype',metadata->'mimetype','size',metadata->'size','cacheControl',metadata->'cacheControl','eTag',metadata->'eTag')))order by name),'[]')from storage.objects where bucket_id='animal-media'),
 'media',(select coalesce(json_agg(json_build_object('assetId',m.id,'ownerId',m.profile_id,'animalId',m.animal_id,'purpose',m.purpose,'state',m.state,'path',o.object_path,'variant',o.variant,'bytes',o.byte_size,'sha256',o.sha256,'width',o.width,'height',o.height)order by o.object_path),'[]')from private.media_assets m join private.media_objects o on o.asset_id=m.id),
 'db',(select json_build_object('owner',pg_get_userbyid(datdba),'collate',datcollate,'ctype',datctype,'privileges',(select json_agg(json_build_object('grantee',case when a.grantee=0 then 'PUBLIC'else pg_get_userbyid(a.grantee)end,'privilege',a.privilege_type,'grantable',a.is_grantable))from aclexplode(coalesce(datacl,acldefault('d',datdba)))a))from pg_database where datname=current_database()),
 'tables',(select coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname)order by n.nspname,c.relname),'[]')from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('api','private','public')and c.relkind in('r','p'))
);`;
// Journal deliberately reads only identities, state and minimal withdrawal times.
export async function journalState(){return sourceQuery(`select json_build_object('createdAt',clock_timestamp(),'epoch',(select journal_epoch from private.recovery_settings where id=1),'epochStartedAt',(select started_at from private.recovery_settings where id=1),'accounts',(select coalesce(json_agg(json_build_object('id',u.id,'isAnonymous',coalesce(u.is_anonymous,false),'status',s.status,'hasProfile',p.id is not null,'isPublished',coalesce(p.is_published,false))order by u.id),'[]')from auth.users u left join private.account_state s on s.user_id=u.id left join public.profiles p on p.id=u.id),'withdrawals',(select coalesce(json_agg(json_build_object('id',user_id,'requestedAt',requested_at,'completedAt',completed_at)order by user_id),'[]')from private.account_withdrawals),'project',(select json_build_object('writesEnabled',writes_enabled,'admissionOpen',admission_open)from private.project_budget where id=1),'analyticsEnabled',(select enabled from private.analytics_settings where id=1));`);}
export const roleFactsSql="select json_agg(json_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypass',rolbypassrls,'limit',rolconnlimit,'until',rolvaliduntil,'config',rolconfig)order by rolname)from pg_roles;";
export const membershipFactsSql="select coalesce(json_agg(json_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option)order by r.rolname,m.rolname,g.rolname),'[]')from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member join pg_roles g on g.oid=a.grantor;";
export async function captureDatabase(){
 const snapshot=new Snapshot();let meta,sql,privateJwt;
 try{
  const first=await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL idle_in_transaction_session_timeout='90s'; SELECT json_build_object('snapshot',pg_export_snapshot());");insist(/^[0-9a-f-]+$/i.test(first.snapshot),'BACKUP_SNAPSHOT_INVALID');
  meta=await snapshot.query(metadataSql);meta.roles=await snapshot.query(roleFactsSql);meta.memberships=await snapshot.query(membershipFactsSql);insist((await snapshot.query("select to_json(oid=10 and rolname='supabase_admin')from pg_roles where oid=10;"))===true,'BACKUP_BOOTSTRAP_ROLE_UNSUPPORTED');insist(meta.pgVersion===170011&&meta.epoch,'BACKUP_SOURCE_VERSION_OR_EPOCH_INVALID');
  privateJwt=(await snapshot.query("select json_build_object('value',current_setting('app.settings.jwt_secret',true));")).value;
  const selections=['api','private','public','auth','storage','extensions','cron','vault'].map(s=>'--schema='+s),base=['exec',sourceContainer,'pg_dump','-U','postgres','-d','postgres','--snapshot='+first.snapshot,'--no-comments','--no-security-labels','--no-large-objects'];
  const results=await Promise.allSettled([
   run('docker',[...base,'--schema-only','--section=pre-data','--extension=*',...selections],{stage:'BACKUP_SCHEMA_PRE'}),
   run('docker',[...base,'--schema-only','--section=post-data','--extension=*',...selections],{stage:'BACKUP_SCHEMA_POST'}),
   run('docker',[...base,'--data-only','--schema=api','--schema=private','--schema=public','--exclude-extension=*','--exclude-schema=auth','--exclude-schema=storage','--exclude-schema=vault','--exclude-schema=cron','--exclude-schema=extensions'],{stage:'BACKUP_APP_DATA'}),roles()
  ]);for(const r of results)if(r.status==='rejected')throw r.reason;
  sql={pre:results[0].value.toString(),post:results[1].value.toString(),data:results[2].value.toString(),roles:results[3].value};insist(Object.values(sql).reduce((n,v)=>n+Buffer.byteLength(v),0)<=maxSql,'BACKUP_SQL_TOO_LARGE');
  insist(!/^COPY (?:auth|storage|vault|cron|extensions)\./m.test(sql.data),'BACKUP_MANAGED_DATA_REFUSED');
  const counts=meta.tables.map(t=>`select ${literal(t.schema+'.'+t.name)} as name,count(*)as count from ${identifier(t.schema)}.${identifier(t.name)}`).join(' union all ');meta.tableCounts=await snapshot.query(`select json_agg(row_to_json(t)order by name)from(${counts})t;`);
 }finally{await snapshot.close();}
 insist(sha((await roles()).replace(/^\\(?:un)?restrict .*$/gm,''))===sha(sql.roles.replace(/^\\(?:un)?restrict .*$/gm,'')),'BACKUP_ROLE_SNAPSHOT_CHANGED');
 const image=await run('docker',['inspect',sourceContainer,'--format','{{json .Config.Image}}'],{limit:4096,stage:'BACKUP_IMAGE'});insist(JSON.parse(image.toString())===postgresImage,'BACKUP_IMAGE_UNSUPPORTED');
 meta.imageId=(await run('docker',['inspect',sourceContainer,'--format','{{.Image}}'],{limit:4096,stage:'BACKUP_IMAGE'})).toString().trim();insist(/^sha256:[a-f0-9]{64}$/.test(meta.imageId),'BACKUP_IMAGE_INVALID');
 return{meta,sql,assertNoSecrets:plain=>{if(privateJwt)insist(!plain.includes(privateJwt),'BACKUP_SECRET_DETECTED');}};
}
export class IsolatedDatabase{
 constructor(imageId){insist(/^sha256:[a-f0-9]{64}$/.test(imageId),'RESTORE_IMAGE_INVALID');this.id=randomUUID();this.name='reptilelink-restore-'+this.id;this.imageId=imageId;this.created=false;}
 async attest(){const raw=await run('docker',['inspect',this.name],{limit:128*1024,stage:'RESTORE_INSPECT'});const c=JSON.parse(raw.toString())[0],labels=c.Config.Labels??{};insist(labels['reptilelink.restore.uuid']===this.id&&labels['reptilelink.restore.uid']===String(process.getuid())&&c.Image===this.imageId&&c.HostConfig.NetworkMode==='none'&&c.HostConfig.ReadonlyRootfs===true&&Object.keys(c.HostConfig.PortBindings??{}).length===0&&c.Mounts.every(m=>m.Type==='tmpfs'),'RESTORE_ISOLATION_INVALID');return c;}
 async start(){
  await run('docker',['image','inspect',this.imageId,'--format','{{.Id}}'],{limit:4096,stage:'RESTORE_IMAGE_NOT_CACHED'});
  const command="initdb -D /restore/data -U supabase_admin -A trust --no-locale >/restore/init.log 2>&1 && exec postgres -D /restore/data -k /tmp -c listen_addresses= -c shared_preload_libraries=pg_cron,pg_stat_statements -c cron.database_name=reptilelink_recovered -c cron.launch_active_jobs=off -c shared_buffers=32MB -c max_connections=20 -c log_statement=none -c log_min_error_statement=panic -c log_min_messages=panic";
  await run('docker',['run','--detach','--rm','--pull=never','--name',this.name,'--label','reptilelink.restore.uuid='+this.id,'--label','reptilelink.restore.uid='+process.getuid(),'--network','none','--read-only','--user','100:101','--memory','1g','--cpus','1','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/restore:rw,nosuid,nodev,noexec,size=1g,uid=100,gid=101,mode=0700','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=32m,uid=100,gid=101,mode=1777','--entrypoint','/bin/sh',this.imageId,'-c',command],{limit:4096,stage:'RESTORE_CONTAINER_START'});this.created=true;await this.attest();
  let ready=false;for(let i=0;i<60;i++){try{await run('docker',['exec',this.name,'pg_isready','-h','/tmp','-U',restoreUser,'-d','postgres'],{limit:4096,timeout:3000,stage:'RESTORE_READY'});ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
  insist(ready,'RESTORE_POSTGRES_NOT_READY');const state=await this.query("select json_build_object('version',current_setting('server_version_num')::integer,'cron',current_setting('cron.launch_active_jobs'),'network',current_setting('listen_addresses'));",'postgres');insist(state.version===170011&&state.cron==='off'&&state.network==='','RESTORE_POSTGRES_UNSAFE');
 }
 async execute(sql,database=restoreDatabase){await this.attest();return run('docker',['exec','-i',this.name,'psql','-X','-qAt','-h','/tmp','-U',restoreUser,'-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input:sql,stage:'RESTORE_SQL'});}
 async query(sql,database=restoreDatabase){const bytes=await this.execute(sql,database);try{return JSON.parse(bytes.toString());}catch{throw Error('RESTORE_RESULT_INVALID');}}
 async writeObject(id,bytes){insist(/^[a-f0-9]{64}$/.test(id)&&Buffer.isBuffer(bytes)&&bytes.length<=512*1024,'RESTORE_OBJECT_INVALID');await this.attest();await run('docker',['exec','-i',this.name,'/bin/sh','-c',`mkdir -p /restore/media && set -C && cat > /restore/media/${id}.bin`],{input:bytes,limit:4096,stage:'RESTORE_FILE_WRITE'});}
 async readObject(id){insist(/^[a-f0-9]{64}$/.test(id),'RESTORE_OBJECT_INVALID');await this.attest();return run('docker',['exec',this.name,'cat',`/restore/media/${id}.bin`],{limit:512*1024,stage:'RESTORE_FILE_READ'});}
 async close(){if(!this.created)return;let c;try{c=await this.attest();}catch{const all=await run('docker',['ps','-aq','--filter','name=^/'+this.name+'$'],{limit:4096,stage:'RESTORE_LOOKUP'});if(!all.toString().trim())return;throw Error('RESTORE_CLEANUP_OWNERSHIP_REFUSED');}if(c)await run('docker',['rm','--force',this.name],{limit:4096,stage:'RESTORE_CONTAINER_REMOVE'});this.created=false;}
}
