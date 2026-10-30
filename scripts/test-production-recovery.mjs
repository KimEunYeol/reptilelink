import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createBackup,restoreCheck} from './backup-restore.mjs';
import {run,literal as q,identifier as ident,restoreDatabase,restoreUser} from './backup-db.mjs';
import {recoverySql} from './production-restore.mjs';
import {stateSql} from './production-backup.mjs';

// This test never connects to a remote project. All synthetic Google rows exist only inside the existing network-none restore sandbox.
const archive=await createBackup();let scenarios=0;
await restoreCheck(archive.file,archive.journal,{probe:async(db,{backup})=>{
 let stage='SETUP';try{
 const tableNames=backup.meta.tables.map(t=>ident(t.schema)+'.'+ident(t.name));
 const settingTables=['private.project_budget','private.analytics_settings','private.policy_versions','private.policy_settings','private.recovery_settings'];
 const settings={};
 for(const table of settingTables)settings[table]={rows:await db.query('select coalesce(json_agg(t),\'[]\')from '+table+' t;'),columns:await db.query("select json_agg(attname order by attnum)from pg_attribute where attrelid="+q(table)+"::regclass and attnum>0 and not attisdropped and attgenerated='';")};
 const clear="TRUNCATE "+[...tableNames,'auth.users','storage.objects'].join(',')+" RESTART IDENTITY CASCADE;";
 const seed=settingTables.map(table=>'INSERT INTO '+table+'('+settings[table].columns.map(ident).join(',')+') SELECT '+settings[table].columns.map(ident).join(',')+' FROM jsonb_populate_recordset(NULL::'+table+','+q(JSON.stringify(settings[table].rows))+'::jsonb);').join('\n')+
 "UPDATE private.project_budget SET media_reserved_bytes=0,media_stored_bytes=0,writes_enabled=true,admission_open=true; UPDATE private.analytics_settings SET enabled=false;";
 stage='EMPTY_BASE';await db.execute(clear+seed);
 const actor=randomUUID(),animal=randomUUID(),asset=randomUUID();
 stage='SEED_FIXTURE';await db.execute("INSERT INTO auth.users(id,email,raw_app_meta_data)VALUES("+q(actor)+",'offline-recovery@example.invalid','{\"provider\":\"google\",\"providers\":[\"google\"]}');"+
 "INSERT INTO auth.identities(user_id,provider_id,provider,identity_data)VALUES("+q(actor)+",'offline-subject','google','{\"sub\":\"offline-subject\"}');"+
 "UPDATE private.account_state SET status='active'WHERE user_id="+q(actor)+";"+
 "INSERT INTO public.profiles(id,slug,display_name,is_published)VALUES("+q(actor)+",'offline-recovery','Offline recovery',true);"+
 "INSERT INTO private.storage_usage(profile_id,stored_bytes)VALUES("+q(actor)+",8);"+
 "INSERT INTO public.animals(id,profile_id,name,species,sort_order)VALUES("+q(animal)+','+q(actor)+",'Cycle','Gecko',0);"+
 "INSERT INTO private.media_assets(id,profile_id,animal_id,purpose,animal_role,state,reservation_bytes,actual_bytes,verified_at,expires_at)VALUES("+q(asset)+','+q(actor)+','+q(animal)+",'animal','father','ready',8,8,now(),NULL);"+
 "INSERT INTO private.media_objects(asset_id,profile_id,variant,object_path,byte_size,state)VALUES("+q(asset)+','+q(actor)+",'original_display',"+q(actor+'/'+asset+'/display.webp')+",4,'stored');"+
 "INSERT INTO private.media_objects(asset_id,profile_id,variant,object_path,byte_size,state)VALUES("+q(asset)+','+q(actor)+",'thumbnail',"+q(actor+'/'+asset+'/thumbnail.webp')+",4,'stored');"+
 "UPDATE public.animals SET father_asset_id="+q(asset)+" WHERE id="+q(animal)+";"+
 "UPDATE private.project_budget SET media_stored_bytes=8;");
 stage='CAPTURE';const foreignKeys=await db.query("select json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'deferrable',k.condeferrable,'initiallyDeferred',k.condeferred)order by n.nspname,c.relname,k.conname)from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where k.contype='f'and n.nspname in('api','private','public');");
 const userTriggers=await db.query("select coalesce(json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled)order by n.nspname,c.relname,t.tgname),'[]')from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in('api','private','public');");
 const state=await db.query(stateSql);
 const counts=await db.query('select json_agg(row_to_json(t)order by name)from('+backup.meta.tables.map(t=>'select '+q(t.schema+'.'+t.name)+' as name,count(*)as count from '+ident(t.schema)+'.'+ident(t.name)).join(' union all ')+')t;');
 const dump=async flags=>(await run('docker',['exec',db.name,'pg_dump','-h','/tmp','-U',restoreUser,'-d',restoreDatabase,'--no-comments','--data-only',...flags],{stage:'OFFLINE_PRODUCTION_DUMP'})).toString();
 const b={meta:{tables:backup.meta.tables,tableCounts:counts,foreignKeys,userTriggers,state},sql:{auth:await dump(['--table=auth.users','--table=auth.identities']),data:await dump(['--table=public.*','--table=private.*','--table=api.*'])}};
 const journal=structuredClone(state);journal.accounts[0].status='suspended';journal.accounts[0].isPublished=false;journal.project={writesEnabled:true,admissionOpen:true};journal.analyticsEnabled=true;
 await db.execute(clear+seed);
 stage='SUSPENDED_RECOVERY';await db.execute(recoverySql(b,journal,new Set()));
 const restored=await db.query("select json_build_object('users',(select count(*)from auth.users),'identities',(select count(*)from auth.identities),'suspended',(select status='suspended'from private.account_state),'hidden',(select not is_published from public.profiles),'cycle',(select father_asset_id="+q(asset)+"::uuid from public.animals where id="+q(animal)+"::uuid),'writes',(select writes_enabled from private.project_budget),'admission',(select admission_open from private.project_budget),'analytics',(select enabled from private.analytics_settings));");
 assert.deepEqual(restored,{users:1,identities:1,suspended:true,hidden:true,cycle:true,writes:false,admission:false,analytics:false});scenarios++;
 const afterKeys=await db.query("select json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'deferrable',k.condeferrable,'initiallyDeferred',k.condeferred)order by n.nspname,c.relname,k.conname)from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where k.contype='f'and n.nspname in('api','private','public');");
 assert.deepEqual(afterKeys,foreignKeys);
 const enabled=await db.query("select to_json(bool_and(t.tgenabled='O'))from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in('public','private','api');");assert.equal(enabled,true);scenarios++;
 // Re-running against a nonempty target must stop before truncation and leave the prior data intact.
 await assert.rejects(db.execute(recoverySql(b,journal,new Set())),/RESTORE_TARGET_NOT_EMPTY/);
 assert.equal(await db.query('select to_json(count(*))from auth.users;'),1);scenarios++;
 await db.execute(clear+seed);
 const withdrawn=structuredClone(state);withdrawn.accounts=[];withdrawn.withdrawals=[{id:actor,requestedAt:new Date().toISOString(),completedAt:new Date().toISOString()}];
 stage='WITHDRAWAL_RECOVERY';await db.execute(recoverySql(b,withdrawn,new Set([actor])));
 const removed=await db.query("select json_build_object('users',(select count(*)from auth.users),'identities',(select count(*)from auth.identities),'profiles',(select count(*)from public.profiles),'media',(select count(*)from private.media_assets),'withdrawal',(select count(*)from private.account_withdrawals where user_id="+q(actor)+"::uuid),'stored',(select media_stored_bytes from private.project_budget));");
 assert.deepEqual(removed,{users:0,identities:0,profiles:0,media:0,withdrawal:1,stored:0});scenarios++;
 }catch(error){throw Error('OFFLINE_'+stage+'_'+(/^[A-Z0-9_]+$/.test(error.message)?error.message:'ASSERTION_FAILED'));}
}});
console.log(JSON.stringify({scope:'offline-isolated-synthetic-identities',scenarios,network:'none',remoteGoogleVerified:false,actualRemotePhotoRecoveryVerified:false}));
