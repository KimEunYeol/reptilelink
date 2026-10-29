import assert from 'node:assert/strict';
import {createAccount,finishAccount,call,client,admin} from './account-qa.mjs';
import {localQuery} from './local-utils.mjs';

const owner=await createAccount(),other=await createAccount(),pending=await createAccount({active:false,profile:false});
const guest=client(),users=[owner,other,pending];
const originalWrites=localQuery('select writes_enabled from private.project_budget where id=1').trim();
let checks=0;
const dash=(a=owner)=>call(a.c,'my_dashboard');
const fields=a=>Object.fromEntries(['name','species','morph','sex','birth_date','adoption_date','description','listing_status'].map(k=>[k,a[k]]));
const legacy=a=>Object.fromEntries(Object.entries(fields(a)).filter(([k])=>k!=='adoption_date'));
const snapshot=()=>localQuery(`select jsonb_build_object('animals',(select jsonb_agg(to_jsonb(a)order by id)from public.animals a where profile_id in('${owner.id}','${other.id}')),'photos',(select jsonb_agg(to_jsonb(a)order by id)from public.animal_photos a where profile_id in('${owner.id}','${other.id}')),'media',(select jsonb_agg(to_jsonb(a)order by id)from private.media_assets a where profile_id in('${owner.id}','${other.id}')),'profiles',(select jsonb_agg(to_jsonb(a)order by id)from public.profiles a where id in('${owner.id}','${other.id}')),'receipts',(select jsonb_agg(to_jsonb(a)order by actor_id,request_id)from private.mutation_receipts a where actor_id in('${owner.id}','${other.id}')),'usage',(select jsonb_agg(to_jsonb(a)order by profile_id)from private.storage_usage a where profile_id in('${owner.id}','${other.id}')),'budget',(select to_jsonb(a)from private.project_budget a where id=1))`);
async function reject(c,name,args,pattern){const before=snapshot(),r=await c.schema('api').rpc(name,args);assert.ok(r.error,`${name} should reject`);if(pattern)assert.match(r.error.message,pattern);assert.equal(snapshot(),before,'rejected command must roll back all related state');checks++;}
async function animal(a=owner,extra={}){return call(a.c,'create_animal',{p_data:{name:'부모 QA',species:'게코',morph:'',sex:'unknown',description:'',listing_status:'not_listed',is_public:true,...extra},p_expected:(await dash(a)).profile.revision,p_request_id:crypto.randomUUID()});}
const current=async id=>(await dash()).animals.find(a=>a.id===id);
async function args(id,patch={}){const a=await current(id);return {p_animal_id:id,p_data:fields(a),p_assets:a.photos.map(p=>p.asset_id),p_parents:{father:a.father_asset_id,mother:a.mother_asset_id},p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID(),...patch};}
function metadata(){return ['original_display','thumbnail'].map(variant=>({variant,bytes:100,width:10,height:10,sha256:'a'.repeat(64)}));}
async function reserve(id,role,a=owner,ready=true){const request=crypto.randomUUID(),parameters={p_animal_id:id,p_role:role,p_request_id:request},value=await call(a.c,'reserve_parent_photo',parameters);if(ready)await call(admin,'complete_upload',{p_asset_id:value.asset_id,p_actor:a.id,p_objects:metadata()});return {...value,parameters,request};}
async function ownPhoto(id){const v=await call(owner.c,'reserve_photo_edit',{p_animal_id:id});await call(admin,'complete_upload',{p_asset_id:v.asset_id,p_actor:owner.id,p_objects:metadata()});return v.asset_id;}

try{
 const a=await animal(owner,{birth_date:'2020-02-29',adoption_date:'2020-03-01'}),second=await animal(),foreign=await animal(other);
 assert.equal((await current(a.id)).adoption_date,'2020-03-01');assert.equal((await current(second.id)).adoption_date,null);checks++;
 for(const value of ['',true,123,{},'0000-01-01','0001-1-1','2023-02-29','2020-02-30','9999-12-31','infinity','2020-02-28'])await reject(owner.c,'save_animal_details',await args(a.id,{p_data:{...fields(await current(a.id)),adoption_date:value}}),/VALIDATION_FAILED/);
 await reject(owner.c,'create_animal',{p_data:{name:'invalid',species:'게코',birth_date:'2020-03-01',adoption_date:'2020-02-29'},p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()},/VALIDATION_FAILED/);
 for(const role of [null,'self','avatar','Father'])await reject(owner.c,'reserve_parent_photo',{p_animal_id:a.id,p_role:role,p_request_id:crypto.randomUUID()},/VALIDATION_FAILED/);
 await reject(guest,'reserve_parent_photo',{p_animal_id:a.id,p_role:'father',p_request_id:crypto.randomUUID()});
 await reject(other.c,'reserve_parent_photo',{p_animal_id:a.id,p_role:'father',p_request_id:crypto.randomUUID()},/NOT_FOUND/);
 await reject(pending.c,'reserve_parent_photo',{p_animal_id:a.id,p_role:'father',p_request_id:crypto.randomUUID()},/ACCOUNT_NOT_ACTIVE/);
 const tomb={p_animal_id:a.id,p_role:'father',p_request_id:crypto.randomUUID()};assert.equal(await call(owner.c,'cancel_parent_photo_request',tomb),null);assert.equal(await call(owner.c,'cancel_parent_photo_request',tomb),null);checks++;
 await reject(owner.c,'reserve_parent_photo',tomb,/REQUEST_CONFLICT/);
 const father=await reserve(a.id,'father',owner,false);
 assert.equal((await call(owner.c,'reserve_parent_photo',father.parameters)).asset_id,father.asset_id);checks++;
 await reject(owner.c,'reserve_parent_photo',{...father.parameters,p_role:'mother'},/REQUEST_CONFLICT/);
 await reject(owner.c,'reserve_parent_photo',{...father.parameters,p_request_id:crypto.randomUUID()},/QUOTA_EXCEEDED/);
 const mother=await reserve(a.id,'mother',owner,false);
 await reject(owner.c,'reserve_photo_edit',{p_animal_id:second.id},/QUOTA_EXCEEDED/);
 for(const v of [father,mother])await call(admin,'complete_upload',{p_asset_id:v.asset_id,p_actor:owner.id,p_objects:metadata()});
 const photos=[await ownPhoto(a.id),await ownPhoto(a.id),await ownPhoto(a.id)];
 await reject(owner.c,'reserve_photo_edit',{p_animal_id:a.id},/QUOTA_EXCEEDED/);
 assert.equal((await current(a.id)).photos.length,0);assert.equal(await call(admin,'media_access',{p_asset_id:father.asset_id,p_variant:'thumbnail',p_actor:owner.id}),null);checks++;
 const goodParents={father:father.asset_id,mother:mother.asset_id};
 for(const parents of [null,{},[],{father:null},{...goodParents,extra:null},{father:photos[0],mother:mother.asset_id},{father:mother.asset_id,mother:father.asset_id},{father:father.asset_id,mother:father.asset_id},{father:'bad',mother:null}])await reject(owner.c,'save_animal_details',await args(a.id,{p_parents:parents}),/VALIDATION_FAILED|NOT_FOUND/);
 await reject(owner.c,'save_animal_details',await args(a.id,{p_assets:[father.asset_id],p_parents:goodParents}),/NOT_FOUND/);
 await reject(owner.c,'save_animal_edit',{p_animal_id:a.id,p_data:legacy(await current(a.id)),p_assets:[father.asset_id],p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()},/NOT_FOUND/);
 await reject(owner.c,'attach_photo',{p_asset_id:father.asset_id,p_expected:(await dash()).profile.revision},/NOT_FOUND/);
 await reject(owner.c,'save_animal_details',await args(second.id,{p_parents:goodParents}),/NOT_FOUND/);
 const foreignFather=await reserve(foreign.id,'father',other);
 await reject(owner.c,'save_animal_details',await args(a.id,{p_parents:{father:foreignFather.asset_id,mother:mother.asset_id}}),/NOT_FOUND/);
 const bind=await args(a.id,{p_assets:photos,p_parents:goodParents}),saved=await call(owner.c,'save_animal_details',bind);
 assert.equal(saved.revision,bind.p_expected+1);assert.deepEqual((await current(a.id)).photos.map(p=>p.asset_id),photos);assert.equal((await current(a.id)).father_asset_id,father.asset_id);assert.equal((await current(a.id)).mother_asset_id,mother.asset_id);checks++;
 assert.deepEqual(await call(owner.c,'save_animal_details',bind),saved);assert.equal((await dash()).profile.revision,saved.revision);checks++;
 await reject(owner.c,'save_animal_details',{...bind,p_parents:{father:null,mother:mother.asset_id}},/REQUEST_CONFLICT/);
 await reject(owner.c,'save_animal_details',{...bind,p_data:{...bind.p_data,adoption_date:null}},/REQUEST_CONFLICT/);
 for(const v of [father,mother]){await reject(admin,'cleanup_manifest',{p_asset_id:v.asset_id,p_actor:owner.id},/NOT_FOUND/);await reject(owner.c,'cancel_parent_photo_request',v.parameters,/NOT_FOUND/);}
 await call(owner.c,'set_profile_public',{p_public:true,p_expected:(await dash()).profile.revision});
 const page=await call(guest,'public_page',{p_slug:owner.slug}),published=page.animals.find(x=>x.id===a.id);
 assert.equal(published.adoption_date,'2020-03-01');assert.equal(published.father_asset_id,father.asset_id);assert.equal(published.mother_asset_id,mother.asset_id);assert.equal(published.photos.length,3);assert.ok(!JSON.stringify(page).match(/object_path|animal_role|reservation_bytes|request_id|cleanup_after|verified_at/));assert.ok(!JSON.stringify(page).includes(owner.id));checks++;
 for(const asset of [father.asset_id,mother.asset_id,...photos])assert.ok(await call(admin,'media_access',{p_asset_id:asset,p_variant:'thumbnail'}));checks++;
 for(const c of [guest,owner.c,other.c]){assert.ok((await c.from('animals').select('adoption_date,father_asset_id,mother_asset_id')).error);assert.ok((await c.schema('private').from('media_assets').select('animal_role')).error);}checks++;
 const legacyUpdate=legacy(await current(a.id));legacyUpdate.name='기존 명령 보존';await call(owner.c,'update_animal',{p_animal_id:a.id,p_data:legacyUpdate,p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});
 await call(owner.c,'save_animal_edit',{p_animal_id:a.id,p_data:legacy(await current(a.id)),p_assets:photos.toReversed(),p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});
 assert.equal((await current(a.id)).father_asset_id,father.asset_id);assert.equal((await current(a.id)).mother_asset_id,mother.asset_id);assert.equal((await current(a.id)).adoption_date,'2020-03-01');checks++;
 const duplicate=await args(a.id),twice=await Promise.all([call(owner.c,'save_animal_details',duplicate),call(owner.c,'save_animal_details',duplicate)]);assert.deepEqual(twice[0],twice[1]);assert.equal(twice[0].revision,duplicate.p_expected+1);checks++;
 const race=await args(a.id),competing=await Promise.all([race,{...race,p_data:{...race.p_data,name:'동시 수정'},p_request_id:crypto.randomUUID()}].map(p=>owner.c.schema('api').rpc('save_animal_details',p)));assert.equal(competing.filter(r=>!r.error).length,1);assert.match(competing.find(r=>r.error).error.message,/VERSION_CONFLICT/);checks++;
 localQuery(`update private.mutation_receipts set expires_at=now()-interval '1 second' where actor_id='${owner.id}' and request_id='${bind.p_request_id}'`);await reject(owner.c,'save_animal_details',bind,/REQUEST_EXPIRED/);
 const replacement=await reserve(a.id,'father');await call(owner.c,'save_animal_details',await args(a.id,{p_parents:{father:replacement.asset_id,mother:mother.asset_id}}));
 assert.equal(localQuery(`select state from private.media_assets where id='${father.asset_id}'`).trim(),'delete_pending');assert.equal(await call(admin,'media_access',{p_asset_id:father.asset_id,p_variant:'thumbnail',p_actor:owner.id}),null);assert.equal(await call(admin,'cleanup_manifest',{p_asset_id:father.asset_id,p_actor:owner.id}),null);checks++;
 await reject(admin,'finish_cleanup',{p_asset_id:father.asset_id},/CLEANUP_PENDING/);
 localQuery(`update private.media_assets set cleanup_after=now()-interval '1 second' where id='${father.asset_id}'`);await call(admin,'cleanup_manifest',{p_asset_id:father.asset_id,p_actor:owner.id});await call(admin,'finish_cleanup',{p_asset_id:father.asset_id});assert.equal(localQuery(`select count(*)from private.media_assets where id='${father.asset_id}'`).trim(),'0');checks++;
 const candidate=await reserve(a.id,'father');
 localQuery('update private.project_budget set writes_enabled=false where id=1');
 await reject(owner.c,'save_animal_details',await args(a.id,{p_parents:{father:candidate.asset_id,mother:mother.asset_id}}),/SERVICE_UNAVAILABLE/);
 await reject(owner.c,'save_animal_details',await args(a.id,{p_data:{...fields(await current(a.id)),adoption_date:null}}),/SERVICE_UNAVAILABLE/);
 await call(owner.c,'save_animal_details',await args(a.id,{p_assets:[],p_parents:{father:null,mother:mother.asset_id}}));assert.equal((await current(a.id)).father_asset_id,null);assert.equal((await current(a.id)).mother_asset_id,mother.asset_id);assert.equal((await current(a.id)).photos.length,0);checks++;
 assert.equal(await call(owner.c,'cancel_parent_photo_request',candidate.parameters),candidate.asset_id);checks++;
 localQuery('update private.project_budget set writes_enabled=true where id=1');
 await reject(owner.c,'reserve_parent_photo',candidate.parameters,/REQUEST_EXPIRED/);
 const expired=await reserve(second.id,'father');localQuery(`update private.media_assets set expires_at=now()-interval '1 second' where id='${expired.asset_id}'`);await reject(owner.c,'save_animal_details',await args(second.id,{p_parents:{father:expired.asset_id,mother:null}}),/NOT_FOUND/);await call(owner.c,'cancel_parent_photo_request',expired.parameters);
 const unready=await reserve(second.id,'mother',owner,false);await reject(owner.c,'save_animal_details',await args(second.id,{p_parents:{father:null,mother:unready.asset_id}}),/NOT_FOUND/);await call(owner.c,'cancel_parent_photo_request',unready.parameters);
 const consent=localQuery(`select to_jsonb(c)from private.consents c where user_id='${owner.id}'and document_kind='terms'`).trim();localQuery(`delete from private.consents where user_id='${owner.id}'and document_kind='terms'`);
 await reject(owner.c,'save_animal_details',await args(a.id),/CONSENT_REQUIRED/);assert.equal(await call(owner.c,'cancel_parent_photo_request',{p_animal_id:a.id,p_role:'father',p_request_id:crypto.randomUUID()}),null);checks++;
 localQuery(`insert into private.consents select *from jsonb_populate_record(null::private.consents,'${consent.replaceAll("'","''")}')`);
 localQuery(`update private.account_state set status='suspended'where user_id='${owner.id}'`);assert.equal(await call(guest,'public_page',{p_slug:owner.slug}),null);assert.equal(await call(admin,'media_access',{p_asset_id:mother.asset_id,p_variant:'thumbnail',p_actor:owner.id}),null);checks++;
 await reject(owner.c,'reserve_parent_photo',{p_animal_id:second.id,p_role:'father',p_request_id:crypto.randomUUID()},/ACCOUNT_NOT_ACTIVE/);localQuery(`update private.account_state set status='active'where user_id='${owner.id}'`);
 const deletion=await call(owner.c,'delete_animal',{p_animal_id:a.id,p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});assert.ok(deletion.revision);assert.equal(localQuery(`select mother_asset_id is null and father_asset_id is null from public.animals where id='${a.id}'`).trim(),'t');assert.equal(await call(admin,'media_access',{p_asset_id:mother.asset_id,p_variant:'thumbnail',p_actor:owner.id}),null);checks++;
 await reject(owner.c,'reserve_parent_photo',{p_animal_id:a.id,p_role:'father',p_request_id:crypto.randomUUID()},/NOT_FOUND/);
 const survivor=await reserve(second.id,'father');await call(owner.c,'save_animal_details',await args(second.id,{p_parents:{father:survivor.asset_id,mother:null}}));
 await call(owner.c,'request_account_deletion',{p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID(),p_confirm:'탈퇴'});
 assert.equal(await call(guest,'public_page',{p_slug:owner.slug}),null);assert.equal(await call(admin,'media_access',{p_asset_id:survivor.asset_id,p_variant:'thumbnail',p_actor:owner.id}),null);assert.equal(localQuery(`select count(*)from public.animals where profile_id='${owner.id}'and(father_asset_id is not null or mother_asset_id is not null)`).trim(),'0');checks++;
 console.log(`Passed ${checks} parent/adoption DB checks: strict dates, backward compatibility, role/owner/child isolation, quotas, atomic photos/fields/replay/concurrency, public/media gates, lease cleanup, paused reductions, cancellation and pending-animal withdrawal. Synthetic metadata here; real Storage bytes are verified separately.`);
}finally{
 localQuery(`update private.project_budget set writes_enabled=${originalWrites==='t'?'true':'false'} where id=1;update private.account_state set status='active'where user_id='${owner.id}'and status='suspended'`);
 // Restore the current test actor's preview consent only if an earlier assertion interrupted that case.
 localQuery(`insert into private.consents(user_id,document_kind,document_version)select '${owner.id}','terms','local-preview-v1'where exists(select 1 from auth.users where id='${owner.id}')on conflict do nothing`);
 for(const a of users)await finishAccount(a);
}
