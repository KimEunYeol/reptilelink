import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { fixturePassword, localStatus, localAdmin, localQuery } from './local-utils.mjs';
const s=localStatus(),admin=localAdmin(),options={auth:{persistSession:false,autoRefreshToken:false}};
const client=()=>createClient(s.url,s.publishable,options);
async function login(email){const c=client();assert.ifError((await c.auth.signInWithPassword({email,password:fixturePassword})).error);return c;}
const owner=await login('qa-other@reptilelink.test'),foreign=await login('qa-owner@reptilelink.test'),pending=await login('pending@reptilelink.test');
async function call(c,name,args){const r=await c.schema('api').rpc(name,args);assert.ifError(r.error);return r.data;}
const dash=()=>call(owner,'my_dashboard'),before=await dash(),actor=before.profile.id,foreignActor=(await foreign.auth.getUser()).data.user.id,created=[],assets=[];
assert.equal(before.animals.length,0,'Dedicated QA-other must be empty before deletion suite');
const oldWrites=localQuery('select writes_enabled from private.project_budget where id=1').trim();
const fields=a=>Object.fromEntries(['name','species','morph','sex','birth_date','description','listing_status'].map(k=>[k,a[k]]));
const snapshot=()=>localQuery(`select jsonb_build_object('animals',(select jsonb_agg(to_jsonb(a) order by id) from public.animals a where profile_id='${actor}'),'jobs',(select jsonb_agg(to_jsonb(j) order by animal_id) from private.animal_deletions j where profile_id='${actor}'),'media',(select jsonb_agg(to_jsonb(m) order by id) from private.media_assets m where profile_id='${actor}'),'usage',(select to_jsonb(u) from private.storage_usage u where profile_id='${actor}'),'revision',(select revision from public.profiles where id='${actor}'),'receipts',(select count(*) from private.mutation_receipts where actor_id='${actor}'))`).trim();
let checks=0;
async function create(){const r=await call(owner,'create_animal',{p_data:{name:'삭제 QA',species:'게코',is_public:true},p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});created.push(r.id);return (await dash()).animals.find(a=>a.id===r.id);}
async function args(id){return {p_animal_id:id,p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()};}
async function rejects(c,parameters,pattern){const b=snapshot();const r=await c.schema('api').rpc('delete_animal',parameters);assert.ok(r.error);if(pattern)assert.match(r.error.message,pattern);assert.equal(snapshot(),b);checks++;}
async function reserve(id,ready=true){const r=await call(owner,'reserve_photo_edit',{p_animal_id:id});assets.push(r.asset_id);if(ready)await call(admin,'complete_upload',{p_asset_id:r.asset_id,p_actor:actor,p_objects:['original_display','thumbnail'].map(variant=>({variant,bytes:100,width:10,height:10,sha256:'a'.repeat(64)}))});return r.asset_id;}
async function finishAssets(id){for(const asset of await call(admin,'animal_deletion_assets',{p_animal_id:id,p_actor:actor})){localQuery(`update private.media_assets set cleanup_after=now()-interval '1 second' where id='${asset}'`);const paths=await call(admin,'cleanup_manifest',{p_asset_id:asset,p_actor:actor});assert.ifError((await admin.storage.from('animal-media').remove(paths)).error);await call(admin,'finish_cleanup',{p_asset_id:asset});}}
try{
  const target=await create(),neighbor=await create();const photos=[await reserve(target.id),await reserve(target.id),await reserve(target.id)];
  await call(owner,'save_animal_edit',{p_animal_id:target.id,p_data:fields(target),p_assets:photos,p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});
  await reserve(target.id);await reserve(target.id,false);
  localQuery(`insert into private.animal_notes(animal_id,profile_id,body) values('${target.id}','${actor}','삭제할 비공개 QA 메모')`);
  const targetArgs=await args(target.id),usage=(await dash()).usage;const result=await call(owner,'delete_animal',targetArgs);assert.equal(result.revision,targetArgs.p_expected+1);checks++;
  const d=await dash();assert.equal(d.animals.some(a=>a.id===target.id),false);assert.equal(d.pending_deletions[0].id,target.id);assert.deepEqual(d.usage,usage);checks++;
  assert.equal((await owner.from('animals').select('id').eq('id',target.id)).data.length,0);checks++;
  assert.equal((await foreign.from('animal_photos').select('asset_id').in('asset_id',photos)).data.length,0);checks++;
  for(const id of photos)assert.equal(await call(admin,'media_access',{p_asset_id:id,p_variant:'thumbnail',p_actor:actor}),null);checks++;
  assert.equal(localQuery(`select count(*) from private.media_assets where animal_id='${target.id}' and state='delete_pending'`).trim(),'5');checks++;
  assert.deepEqual(await call(owner,'delete_animal',targetArgs),result);assert.equal((await dash()).profile.revision,result.revision);checks++;
  await rejects(owner,{...targetArgs,p_animal_id:neighbor.id},/REQUEST_CONFLICT/);
  assert.equal(await call(admin,'finish_animal_deletion',{p_animal_id:target.id,p_actor:actor}),false);checks++;
  assert.ok((await owner.schema('api').rpc('finish_animal_deletion',{p_animal_id:target.id,p_actor:actor})).error);checks++;
  assert.match((await admin.schema('api').rpc('animal_deletion_assets',{p_animal_id:target.id,p_actor:foreignActor})).error.message,/NOT_FOUND/);checks++;
  for(const [name,parameters]of [
    ['update_animal',{p_animal_id:target.id,p_data:fields(target),p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()}],
    ['set_animal_public',{p_animal_id:target.id,p_public:true,p_expected:(await dash()).profile.revision}],
    ['reserve_upload',{p_animal_id:target.id}],['reserve_photo_edit',{p_animal_id:target.id}],
    ['save_animal_edit',{p_animal_id:target.id,p_data:fields(target),p_assets:[],p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()}]]){const b=snapshot(),r=await owner.schema('api').rpc(name,parameters);assert.match(r.error?.message??'',/NOT_FOUND/);assert.equal(snapshot(),b);checks++;}
  await call(owner,'apply_animal_collection',{p_items:[{id:neighbor.id,is_public:true}],p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});assert.equal((await dash()).animals[0].sort_order,0);checks++;
  await call(owner,'set_profile_public',{p_public:true,p_expected:(await dash()).profile.revision});const publicData=await call(client(),'public_page',{p_slug:before.profile.slug});assert.equal(publicData.animals.some(a=>a.id===target.id),false);assert.ok(!JSON.stringify(publicData).includes('pending_deletions'));checks++;
  while(created.length<20)await create();
  assert.match((await owner.schema('api').rpc('create_animal',{p_data:{name:'한도',species:'게코'},p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()})).error.message,/QUOTA_EXCEEDED/);checks++;
  await finishAssets(target.id);assert.equal(await call(admin,'finish_animal_deletion',{p_animal_id:target.id,p_actor:actor}),true);assert.equal(localQuery(`select count(*) from private.animal_notes where animal_id='${target.id}'`).trim(),'0');checks++;
  assert.deepEqual(await call(owner,'delete_animal',targetArgs),result);checks++;
  await create();assert.equal((await dash()).animals.length,20);checks++;
  const live=(await dash()).animals[0],valid=await args(live.id);
  await rejects(owner,{...valid,p_expected:null},/VERSION_CONFLICT/);await rejects(owner,{...valid,p_request_id:null},/VALIDATION_FAILED/);await rejects(owner,{...valid,p_animal_id:null},/VALIDATION_FAILED/);
  await rejects(client(),valid,null);await rejects(foreign,valid,/NOT_FOUND/);await rejects(pending,valid,/ACCOUNT_NOT_ACTIVE/);
  localQuery(`update private.account_state set status='suspended' where user_id='${actor}'`);await rejects(owner,valid,/ACCOUNT_NOT_ACTIVE/);localQuery(`update private.account_state set status='active' where user_id='${actor}'`);
  const consent=localQuery(`select to_jsonb(c) from private.consents c where user_id='${actor}' and document_kind='terms'`).trim();localQuery(`delete from private.consents where user_id='${actor}' and document_kind='terms'`);await rejects(owner,valid,/CONSENT_REQUIRED/);localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${consent.replaceAll("'","''")}')`);
  const same=await args(live.id),twice=await Promise.all([call(owner,'delete_animal',same),call(owner,'delete_animal',same)]);assert.deepEqual(twice[0],twice[1]);assert.equal(twice[0].revision,same.p_expected+1);checks++;
  await call(admin,'finish_animal_deletion',{p_animal_id:live.id,p_actor:actor});checks++;
  const next=(await dash()).animals[0],race=await args(next.id),results=await Promise.all([race,{...race,p_request_id:crypto.randomUUID()}].map(p=>owner.schema('api').rpc('delete_animal',p)));assert.equal(results.filter(r=>!r.error).length,1);assert.match(results.find(r=>r.error).error.message,/NOT_FOUND|VERSION_CONFLICT/);checks++;
  localQuery('update private.project_budget set writes_enabled=false where id=1');const paused=(await dash()).animals[0];await call(owner,'delete_animal',await args(paused.id));assert.equal((await dash()).animals.some(a=>a.id===paused.id),false);checks++;
  localQuery('update private.project_budget set writes_enabled=true where id=1');
  localQuery(`update private.mutation_receipts set expires_at=now()-interval '1 second' where actor_id='${actor}' and request_id='${targetArgs.p_request_id}'`);await rejects(owner,targetArgs,/REQUEST_EXPIRED/);
  assert.ok((await owner.from('animals').delete().eq('id',(await dash()).animals[0].id)).error);checks++;
  console.log(`Passed ${checks} animal-deletion DB checks: ownership, atomic visibility/quota, receipts/concurrency, tombstone guards, live sorting, notes and deferred cleanup.`);
}finally{
  localQuery(`update private.account_state set status='active' where user_id='${actor}';update private.project_budget set writes_enabled=${oldWrites==='t'?'true':'false'} where id=1`);
  for(const id of assets){localQuery(`delete from public.animal_photos where asset_id='${id}';update private.media_assets set cleanup_after=now()-interval '1 second' where id='${id}'`);const r=await admin.schema('api').rpc('cleanup_manifest',{p_asset_id:id,p_actor:actor});if(r.error)continue;if(r.data?.length)assert.ifError((await admin.storage.from('animal-media').remove(r.data)).error);await call(admin,'finish_cleanup',{p_asset_id:id});}
  for(const id of created)localQuery(`delete from public.animals where id='${id}' and profile_id='${actor}'`);
  await call(owner,'set_profile_public',{p_public:before.profile.is_published,p_expected:(await dash()).profile.revision});
}
