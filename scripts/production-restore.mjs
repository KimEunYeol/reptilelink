import path from 'node:path';
import {backupStore,insist,sha} from './backup-safety.mjs';
import {identifier as ident,literal as q} from './backup-db.mjs';
import {RemotePostgres,recoveryRef,productionRef,attestRecoveryProject} from './remote-postgres.mjs';
import {readProductionEnvelope,validateArchive,validateRecoveryJournal,storageKey} from './production-backup.mjs';
import {downloadStorage} from './backup-restore.mjs';
const root='/home/eykim/projects/.reptilelink-production-backups',keyRoot='/home/eykim/projects/.reptilelink-production-backup-keys';
const ownerFor=(backup,o)=>backup.meta.media.find(m=>m.path===o.name)?.ownerId??o.name.split('/')[0];
export function recoverySql(backup,journal,excluded){
 const tables=backup.meta.tables.map(t=>ident(t.schema)+'.'+ident(t.name));
 const ids=new Set(backup.meta.state.accounts.map(a=>a.id));
 let sql="BEGIN; SET LOCAL ROLE postgres; SET LOCAL lock_timeout='5s'; LOCK auth.users,storage.objects IN ACCESS EXCLUSIVE MODE; "+
 "DO $empty$ BEGIN IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM storage.objects) OR EXISTS(SELECT 1 FROM public.profiles) THEN RAISE EXCEPTION 'RESTORE_TARGET_NOT_EMPTY'; END IF; END $empty$; "+
 "SELECT cron.alter_job(jobid,active:=false)FROM cron.job WHERE jobname='reptilelink-activity-retention'; "+
 'TRUNCATE '+tables.join(',')+' RESTART IDENTITY CASCADE;\n';
 for(const t of backup.meta.userTriggers)sql+='ALTER TABLE '+ident(t.schema)+'.'+ident(t.table)+' DISABLE TRIGGER '+ident(t.name)+';\n';
 const deferred=backup.meta.foreignKeys.filter(k=>!k.deferrable);
 for(const k of deferred)sql+='ALTER TABLE '+ident(k.schema)+'.'+ident(k.table)+' ALTER CONSTRAINT '+ident(k.name)+' DEFERRABLE INITIALLY DEFERRED;\n';
 sql+='SET CONSTRAINTS ALL DEFERRED;\n'+backup.sql.auth+'\nDELETE FROM private.account_state;\n'+backup.sql.data+'\nSET CONSTRAINTS ALL IMMEDIATE;\n';
 for(const k of deferred)sql+='ALTER TABLE '+ident(k.schema)+'.'+ident(k.table)+' ALTER CONSTRAINT '+ident(k.name)+' NOT DEFERRABLE INITIALLY IMMEDIATE;\n';
 for(const t of backup.meta.userTriggers)sql+='ALTER TABLE '+ident(t.schema)+'.'+ident(t.table)+' ENABLE TRIGGER '+ident(t.name)+';\n';
 for(const table of backup.meta.tableCounts){const [s,t]=table.name.split('.');insist(['public','private','api'].includes(s)&&/^[a-z][a-z0-9_]*$/.test(t),'PRODUCTION_TABLE_NAME_INVALID');sql+="DO $counts$ BEGIN IF(SELECT count(*)FROM "+ident(s)+'.'+ident(t)+")<>"+table.count+" THEN RAISE EXCEPTION 'RESTORE_TABLE_COUNT_MISMATCH'; END IF; END $counts$;\n";}
 // Never revive outstanding account-recovery/change tokens. Old sessions/refresh tokens were excluded from the data dump.
 sql+="DO $tokens$ DECLARE col text; BEGIN FOREACH col IN ARRAY ARRAY['encrypted_password','confirmation_token','recovery_token','email_change_token_new','email_change_token_current','phone_change_token','reauthentication_token'] LOOP IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='auth'AND table_name='users'AND column_name=col)THEN EXECUTE format('UPDATE auth.users SET %I=%L',col,''); END IF; END LOOP; END $tokens$;\n";
 for(const id of excluded){
  if(!ids.has(id))continue;const user=q(id);
  sql+="SELECT set_config('request.jwt.claim.sub',"+user+",true); DO $reconcile$ DECLARE rev bigint; BEGIN IF NOT EXISTS(SELECT 1 FROM private.account_deletions WHERE user_id="+user+"::uuid) THEN SELECT revision INTO rev FROM public.profiles WHERE id="+user+"::uuid; PERFORM api.request_account_deletion(rev,gen_random_uuid(),'탈퇴'); END IF; END $reconcile$;"+
  "SELECT api.mark_account_sessions_revoked("+user+"); UPDATE private.media_assets SET cleanup_after=now()-interval '1 second' WHERE profile_id="+user+"::uuid;"+
  "SELECT api.finish_cleanup(id)FROM private.media_assets WHERE profile_id="+user+"::uuid;"+
  "DO $finish$ BEGIN IF NOT api.finish_account_data("+user+") THEN RAISE EXCEPTION 'RESTORE_WITHDRAWAL_INCOMPLETE'; END IF; END $finish$;"+
  "DELETE FROM auth.users WHERE id="+user+"::uuid; SELECT api.complete_account_deletion("+user+");\n";
 }
 for(const w of journal.withdrawals)sql+="INSERT INTO private.account_withdrawals(user_id,requested_at,completed_at)VALUES("+q(w.id)+"::uuid,"+q(w.requestedAt)+"::timestamptz,"+(w.completedAt?q(w.completedAt)+"::timestamptz":"NULL")+")ON CONFLICT(user_id)DO UPDATE SET requested_at=least(private.account_withdrawals.requested_at,excluded.requested_at),completed_at=coalesce(private.account_withdrawals.completed_at,excluded.completed_at);\n";
 for(const a of journal.accounts){if(excluded.has(a.id)||!ids.has(a.id))continue;sql+="UPDATE private.account_state SET status="+q(a.status)+" WHERE user_id="+q(a.id)+"::uuid; UPDATE public.profiles SET is_published=false WHERE id="+q(a.id)+"::uuid;\n";}
 // Restored projects stay quarantined even if the latest source journal is open. Preserve desired settings as evidence, never auto-release.
 sql+="UPDATE public.profiles SET is_published=false; UPDATE public.animals SET is_public=false,show_growth=false; UPDATE private.project_budget SET writes_enabled=false,admission_open=false WHERE id=1; UPDATE private.analytics_settings SET enabled=false WHERE id=1; COMMIT;";
 return sql;
}
async function request(ref,secret,method,url,body,headers={}){
 let r;try{r=await fetch('https://'+ref+'.supabase.co'+url,{method,headers:{apikey:secret,Authorization:'Bearer '+secret,...headers},body,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('PRODUCTION_RESTORE_STORAGE_NETWORK');}
 insist(r.ok,'PRODUCTION_RESTORE_STORAGE_FAILED');return r;
}
export async function restoreProductionBackup(archiveFile,journalFile,targetRef,options={}){
 insist(targetRef===recoveryRef&&targetRef!==productionRef,'PRODUCTION_RESTORE_TARGET_REFUSED');
 const {key}=backupStore(options.root??root,options.keyRoot??keyRoot);
 const backup=readProductionEnvelope(archiveFile,key,'backup'),journal=readProductionEnvelope(journalFile,key,'journal');const files=validateArchive(backup),excluded=validateRecoveryJournal(backup,journal);
 // All authentication, age and source/target checks precede any external mutation.
 await attestRecoveryProject(targetRef);
 const db=new RemotePostgres(targetRef,{writable:true});let secret,uploaded=0,stage='START';
 try{
  secret=await storageKey(targetRef);
  const auth=await (await request(targetRef,secret,'GET','/auth/v1/settings?recovery_check='+Date.now(),undefined,{'Cache-Control':'no-cache'})).json();
  insist(auth.disable_signup===true&&auth.external&&Object.values(auth.external).every(v=>v===false),'PRODUCTION_RESTORE_AUTH_NOT_CLOSED');
  await db.start();
  stage='PREFLIGHT';const target=await db.query("BEGIN READ ONLY; SET LOCAL ROLE postgres; SELECT json_build_object('users',(select count(*)from auth.users),'objects',(select count(*)from storage.objects),'profiles',(select count(*)from public.profiles),'migrations',(select json_agg(version order by version)from supabase_migrations.schema_migrations)); ROLLBACK;");
  insist(target.users===0&&target.objects===0&&target.profiles===0,'PRODUCTION_RESTORE_TARGET_NOT_EMPTY');
  insist(JSON.stringify(target.migrations)===JSON.stringify(backup.meta.migrations.map(m=>m.version)),'PRODUCTION_RESTORE_MIGRATIONS_MISMATCH');
  const triggers=await db.query("BEGIN READ ONLY; SET LOCAL ROLE postgres; select coalesce(json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled)order by n.nspname,c.relname,t.tgname),'[]')from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in('api','private','public'); ROLLBACK;");
  insist(JSON.stringify(triggers)===JSON.stringify(backup.meta.userTriggers),'PRODUCTION_RESTORE_TRIGGER_DRIFT');
  stage='DATA';await db.execute(recoverySql(backup,journal,excluded));
  stage='STORAGE';secret=await storageKey(targetRef);
  const buckets=await (await request(targetRef,secret,'GET','/storage/v1/bucket')).json();
  const existing=buckets.find(b=>b.id==='animal-media');
  const settings={id:'animal-media',name:'animal-media',public:false,file_size_limit:225280,allowed_mime_types:['image/webp']};
  if(!existing)await request(targetRef,secret,'POST','/storage/v1/bucket',JSON.stringify(settings),{'Content-Type':'application/json'});
  else insist(existing.public===false&&Number(existing.file_size_limit)===225280,'PRODUCTION_RESTORE_BUCKET_INVALID');
  for(const o of backup.meta.objects){
   if(excluded.has(ownerFor(backup,o)))continue;const file=files.get(sha(o.bucket_id+'\0'+o.name)),bytes=Buffer.from(file.base64,'base64');
   await request(targetRef,secret,'POST','/storage/v1/object/'+encodeURIComponent(o.bucket_id)+'/'+o.name.split('/').map(encodeURIComponent).join('/'),bytes,{'Content-Type':'image/webp','x-upsert':'false'});
   const actual=await downloadStorage(o,{url:'https://'+targetRef+'.supabase.co',secret});insist(sha(actual)===file.sha256&&actual.length===file.bytes,'PRODUCTION_RESTORE_FILE_READBACK_FAILED');uploaded++;
  }
  const rights=await db.query("BEGIN READ ONLY; SET LOCAL ROLE postgres; SELECT json_build_object('users',(select count(*)from auth.users),'objects',(select count(*)from storage.objects),'rawDenied',not has_table_privilege('anon','public.profiles','select')and not has_table_privilege('authenticated','public.animals','select'),'ledgerDenied',not has_table_privilege('authenticated','private.account_withdrawals','select'),'rls',(select bool_and(relrowsecurity)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')and c.relkind='r'),'triggersEnabled',(select bool_and(t.tgenabled='O')from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in('public','private','api')),'publishedProfiles',(select count(*)from public.profiles where is_published),'activeCron',(select count(*)from cron.job where active),'sessions',(select count(*)from auth.sessions),'writes',(select writes_enabled from private.project_budget where id=1),'admission',(select admission_open from private.project_budget where id=1),'analytics',(select enabled from private.analytics_settings where id=1)); ROLLBACK;");
  insist(rights.rawDenied&&rights.ledgerDenied&&rights.rls&&rights.triggersEnabled&&rights.publishedProfiles===0&&rights.activeCron===0&&rights.sessions===0&&!rights.writes&&!rights.admission&&!rights.analytics,'PRODUCTION_RESTORE_PERMISSIONS_FAILED');
  insist(rights.users===backup.meta.state.accounts.filter(a=>!excluded.has(a.id)).length&&rights.objects===uploaded,'PRODUCTION_RESTORE_COUNTS_FAILED');
  return{backupId:backup.id,sourceProjectRef:productionRef,restoreProjectRef:targetRef,quarantined:true,tables:backup.meta.tables.length,files:uploaded,withdrawn:excluded.size,rights,sourceDesiredSettings:{project:journal.project,analyticsEnabled:journal.analyticsEnabled},googleReconnectionVerified:false};
 }catch(error){throw Error('PRODUCTION_RESTORE_'+stage+'_'+(/^[A-Z0-9_]+$/.test(error.message)?error.message:'FAILED'));}finally{secret=undefined;await db.close();}
}
