import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { fixturePassword, localStatus, localAdmin, localQuery } from './local-utils.mjs';
const status=localStatus(), admin=localAdmin();
const client=()=>createClient(status.url,status.publishable,{auth:{persistSession:false,autoRefreshToken:false}});
async function login(email){const c=client();assert.ifError((await c.auth.signInWithPassword({email,password:fixturePassword})).error);return c;}
const owner=await login('qa-owner@reptilelink.test'),other=await login('qa-other@reptilelink.test'),pending=await login('pending@reptilelink.test');
async function call(c,name,args){const r=await c.schema('api').rpc(name,args);assert.ifError(r.error);return r.data;}
const dash=()=>call(owner,'my_dashboard');
const original=await dash(),animal=original.animals[0],actor=original.profile.id,created=[],createdAnimals=[];
assert.equal(animal.photos.length,0,'Use test:db QA fixtures before this suite.');
const fields=a=>Object.fromEntries(['name','species','morph','sex','birth_date','description','listing_status'].map(k=>[k,a[k]]));
let checks=0;
async function args(assets,data=fields(animal)){return {p_animal_id:animal.id,p_data:data,p_assets:assets,p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()};}
const snapshot=()=>localQuery(`select jsonb_build_object('animals',(select jsonb_agg(to_jsonb(a) order by id) from public.animals a where profile_id='${actor}'),'photos',(select jsonb_agg(to_jsonb(p) order by asset_id) from public.animal_photos p where profile_id='${actor}'),'media',(select jsonb_agg(to_jsonb(m) order by id) from private.media_assets m where profile_id='${actor}'),'revision',(select revision from public.profiles where id='${actor}'),'receipts',(select count(*) from private.mutation_receipts where actor_id='${actor}'))`).trim();
async function rejects(c,parameters,pattern=/VALIDATION_FAILED/){const before=snapshot();const r=await c.schema('api').rpc('save_animal_edit',parameters);assert.ok(r.error);if(pattern)assert.match(r.error.message,pattern);assert.equal(snapshot(),before);checks++;}
async function reserve(c=owner,id=animal.id,ready=true){const r=await call(c,'reserve_photo_edit',{p_animal_id:id});const who=(await c.auth.getUser()).data.user.id;created.push({id:r.asset_id,actor:who});if(ready)await call(admin,'complete_upload',{p_asset_id:r.asset_id,p_actor:who,p_objects:['original_display','thumbnail'].map(variant=>({variant,bytes:100,width:10,height:10,sha256:'a'.repeat(64)}))});return r.asset_id;}
const current=async()=> (await dash()).animals.find(a=>a.id===animal.id);
try {
  const ids=[await reserve(),await reserve(),await reserve()];
  const leaseAsset=await reserve(owner,original.animals[1].id,false);localQuery(`update private.media_assets set cleanup_after=now()+interval '1 hour' where id='${leaseAsset}'`);
  await call(admin,'register_upload_lease',{p_asset_id:leaseAsset,p_actor:actor});assert.equal(localQuery(`select cleanup_after>now()+interval '2 hours' from private.media_assets where id='${leaseAsset}'`).trim(),'t');checks++;
  assert.ok((await owner.schema('api').rpc('register_upload_lease',{p_asset_id:leaseAsset,p_actor:actor})).error);checks++;
  const capped=await owner.schema('api').rpc('reserve_photo_edit',{p_animal_id:animal.id});assert.match(capped.error.message,/QUOTA_EXCEEDED/);checks++;
  assert.equal((await current()).photos.length,0);checks++;
  const first=await args(ids,{...fields(animal),name:'사진과 일반 정보 동시 저장'}), result=await call(owner,'save_animal_edit',first);
  assert.equal(result.revision,first.p_expected+1);assert.equal((await current()).name,first.p_data.name);assert.deepEqual((await current()).photos.map(p=>p.asset_id),ids);checks++;
  for(const key of ['is_public','show_growth','sort_order','profile_id'])assert.equal((await current())[key],animal[key]);checks++;
  assert.deepEqual(await call(owner,'save_animal_edit',first),result);assert.equal((await dash()).profile.revision,result.revision);checks++;
  await rejects(owner,{...first,p_assets:[...ids].reverse()},/REQUEST_CONFLICT/);
  await rejects(owner,{...first,p_data:{...first.p_data,name:'다른 요청'}},/REQUEST_CONFLICT/);
  const staged=[await reserve(),await reserve(),await reserve()];
  const replaced=await args(staged);await call(owner,'save_animal_edit',replaced);
  assert.deepEqual((await current()).photos.map(p=>p.asset_id),staged);assert.equal(localQuery(`select count(*) from private.media_assets where id=any(array[${ids.map(id=>`'${id}'::uuid`).join(',')}]) and state='delete_pending'`).trim(),'3');checks++;
  for(const id of ids)assert.equal(await call(admin,'media_access',{p_asset_id:id,p_variant:'thumbnail',p_actor:actor}),null);checks++;
  const beforeUsage=(await dash()).usage;assert.equal(await call(admin,'cleanup_manifest',{p_asset_id:ids[0],p_actor:actor}),null);
  assert.match((await admin.schema('api').rpc('finish_cleanup',{p_asset_id:ids[0]})).error.message,/CLEANUP_PENDING/);assert.deepEqual((await dash()).usage,beforeUsage);checks++;
  for(const invalid of [null,{},'bad',[null],['bad'],[staged[0],staged[0]],[...staged,staged[0]],[{asset_id:staged[0]}],[crypto.randomUUID()]]) await rejects(owner,await args(invalid),Array.isArray(invalid)&&invalid.length===1&&typeof invalid[0]==='string'&&invalid[0].includes('-')?/NOT_FOUND/:/VALIDATION_FAILED/);
  const od=await call(other,'my_dashboard'); const oa=await call(other,'create_animal',{p_data:{name:'사진 권한 QA',species:'게코',is_public:false},p_expected:od.profile.revision,p_request_id:crypto.randomUUID()});createdAnimals.push(oa.id);
  const foreign=await reserve(other,oa.id);
  await rejects(owner,await args([foreign]),/NOT_FOUND/);
  const wrongAnimal=await reserve(owner,original.animals[1].id);
  await rejects(owner,await args([wrongAnimal]),/NOT_FOUND/);
  const reserved=await reserve(owner,animal.id,false);await rejects(owner,await args([reserved]),/NOT_FOUND/);
  await call(admin,'cleanup_manifest',{p_asset_id:reserved,p_actor:actor});await rejects(owner,await args([reserved]),/NOT_FOUND/);
  const expired=await reserve();localQuery(`update private.media_assets set expires_at=now()-interval '1 second' where id='${expired}'`);await rejects(owner,await args([expired]),/NOT_FOUND/);
  for(const data of [{...fields(animal),name:'\ufeff '},{...fields(animal),birth_date:'2999-01-01'},{...fields(animal),photos:[]},{...fields(animal),species:1},{...fields(animal),sex:'none'}]) await rejects(owner,await args(staged,data));
  await rejects(owner,{...await args(staged),p_request_id:null});await rejects(owner,{...await args(staged),p_expected:null},/VERSION_CONFLICT/);
  await rejects(client(),await args(staged),null);await rejects(other,await args(staged),/NOT_FOUND/);await rejects(pending,await args(staged),/ACCOUNT_NOT_ACTIVE/);
  const suspendedArgs=await args(staged);localQuery(`update private.account_state set status='suspended' where user_id='${actor}'`);await rejects(owner,suspendedArgs,/ACCOUNT_NOT_ACTIVE/);localQuery(`update private.account_state set status='active' where user_id='${actor}'`);
  const consent=localQuery(`select to_jsonb(c) from private.consents c where user_id='${actor}' and document_kind='terms'`).trim();
  localQuery(`delete from private.consents where user_id='${actor}' and document_kind='terms'`);
  await rejects(owner,await args(staged),/CONSENT_REQUIRED/);
  localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${consent.replaceAll("'","''")}')`);
  const same=await args(staged.toReversed());const duplicate=await Promise.all([call(owner,'save_animal_edit',same),call(owner,'save_animal_edit',same)]);assert.deepEqual(duplicate[0],duplicate[1]);assert.equal(duplicate[0].revision,same.p_expected+1);checks++;
  const race=await args(staged);const results=await Promise.all([race,{...race,p_assets:[],p_request_id:crypto.randomUUID()}].map(p=>owner.schema('api').rpc('save_animal_edit',p)));assert.equal(results.filter(r=>!r.error).length,1);assert.match(results.find(r=>r.error).error.message,/VERSION_CONFLICT/);checks++;
  const nowPhotos=(await current()).photos.map(p=>p.asset_id);
  localQuery('update private.project_budget set writes_enabled=false where id=1');
  await rejects(owner,await args(nowPhotos,{...fields(animal),name:'쓰기 중지 변경'}),/SERVICE_UNAVAILABLE/);
  await call(owner,'save_animal_edit',await args([]));assert.equal((await current()).photos.length,0);checks++;
  localQuery('update private.project_budget set writes_enabled=true where id=1');
  localQuery(`update private.mutation_receipts set expires_at=now()-interval '1 second' where actor_id='${actor}' and request_id='${same.p_request_id}'`);await rejects(owner,same,/REQUEST_EXPIRED/);
  const denied=await owner.from('animal_photos').insert({profile_id:actor,animal_id:animal.id,asset_id:staged[0],sort_order:0});assert.ok(denied.error);checks++;
  const clean=created.find(c=>c.actor===actor);localQuery(`update private.media_assets set cleanup_after=now()-interval '1 second' where id='${clean.id}'`);
  assert.equal((await call(admin,'cleanup_manifest',{p_asset_id:clean.id,p_actor:actor})).length,2);await call(admin,'finish_cleanup',{p_asset_id:clean.id});await call(admin,'finish_cleanup',{p_asset_id:clean.id});checks++;
  console.log(`Passed ${checks} photo-edit DB checks: atomic fields/photos, full replacement, receipts, ownership, staged/expired assets, concurrency, privacy, quotas and deferred cleanup.`);
} finally {
  localQuery(`update private.account_state set status='active' where user_id='${actor}';update private.project_budget set writes_enabled=true where id=1`);
  await call(owner,'update_animal',{p_animal_id:animal.id,p_data:fields(animal),p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});
  for(const row of created){localQuery(`delete from public.animal_photos where asset_id='${row.id}';update private.media_assets set cleanup_after=now()-interval '1 second' where id='${row.id}'`);const r=await admin.schema('api').rpc('cleanup_manifest',{p_asset_id:row.id,p_actor:row.actor});if(r.error)continue;if(r.data?.length)assert.ifError((await admin.storage.from('animal-media').remove(r.data)).error);await call(admin,'finish_cleanup',{p_asset_id:row.id});}
  for(const id of createdAnimals)localQuery(`delete from public.animals where id='${id}'`);
}
