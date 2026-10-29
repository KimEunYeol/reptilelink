import assert from 'node:assert/strict';
import {createAccount,finishAccount,call,client} from './account-qa.mjs';
import {localQuery} from './local-utils.mjs';
const owner=await createAccount(),other=await createAccount(),guest=client(),tables=['profiles','animals','animal_photos','growth_records','social_links','external_links','schedules'];let checks=0;
const dash=()=>call(owner.c,'my_dashboard'),page=(c=guest)=>call(c,'public_page',{p_slug:owner.slug});
async function publish(value){await call(owner.c,'set_profile_public',{p_public:value,p_expected:(await dash()).profile.revision});}
try{
 for(const c of[guest,owner.c,other.c])for(const table of tables){const r=await c.from(table).select('*').limit(1);assert.ok(r.error,`${table} raw SELECT must be denied`);assert.match(r.error.message,/permission denied/);checks++;}
 assert.equal(localQuery(`select count(*) from information_schema.column_privileges where table_schema='public' and table_name=any(array[${tables.map(t=>`'${t}'`).join(',')}]) and grantee in('anon','authenticated')`).trim(),'0');checks++;
 const visible=(await call(owner.c,'create_animal',{p_data:{name:'공개 개체',species:'게코',is_public:true},p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()})).id;
 const hidden=(await call(owner.c,'create_animal',{p_data:{name:'비공개 비밀',species:'게코',is_public:false},p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()})).id;
 assert.equal(await page(),null);await publish(true);const dto=await page();assert.deepEqual(Object.keys(dto.profile).sort(),['slug','display_name','bio','tagline','theme_token','avatar_asset_id','cover_asset_id'].sort());assert.equal(dto.animals.length,1);assert.equal(dto.animals[0].id,visible);assert.ok(!JSON.stringify(dto).includes(hidden));assert.ok(!JSON.stringify(dto).match(/profile_id|revision|created_at|updated_at|reservation_bytes|object_path/));assert.ok(!JSON.stringify(dto).includes(owner.id));checks++;
 for(const c of[owner.c,other.c])assert.deepEqual((await page(c)).animals.map(a=>a.id),[visible]);checks++;
 assert.equal(await call(guest,'public_animal_growth',{p_animal_id:visible}),null);assert.equal(await call(guest,'public_animal_growth',{p_animal_id:hidden}),null);checks++;
 const today=localQuery("select(now()at time zone 'Asia/Seoul')::date").trim();
 localQuery(`update public.animals set show_growth=true where id='${visible}';insert into public.growth_records(id,profile_id,animal_id,measured_on,weight_g)values(gen_random_uuid(),'${owner.id}','${visible}','${today}',12.5)`);
 const growth=await call(guest,'public_animal_growth',{p_animal_id:visible});assert.equal(growth.latest.weight_g,12.5);assert.deepEqual(Object.keys(growth.records[0]).sort(),['measured_on','weight_g']);checks++;
 localQuery(`update public.animals set is_public=false where id='${visible}'`);assert.equal((await page(owner.c)).animals.length,0);assert.equal(await call(owner.c,'public_animal_growth',{p_animal_id:visible}),null);checks++;
 const deleted=localQuery(`begin;update public.animals set is_public=true,deleted_at=now()where id='${visible}';set local role anon;select jsonb_array_length(api.public_page('${owner.slug}')->'animals')=0 and api.public_animal_growth('${visible}')is null;rollback;`);assert.match(deleted,/^t$/m);checks++;
 for(const state of['suspended','deleting']){localQuery(`update private.account_state set status='${state}'where user_id='${owner.id}'`);for(const c of[guest,owner.c,other.c]){assert.equal(await page(c),null);assert.equal(await call(c,'public_schedules',{p_slug:owner.slug}),null);assert.equal(await call(c,'public_animal_growth',{p_animal_id:visible}),null);}checks++;}
 localQuery(`update private.account_state set status='active'where user_id='${owner.id}'`);await publish(false);assert.equal(await page(owner.c),null);assert.equal(await call(owner.c,'public_schedules',{p_slug:owner.slug}),null);assert.ok((await dash()).animals.some(a=>a.id===hidden));checks++;
 assert.ifError((await other.c.auth.updateUser({data:{role:'service_role',is_admin:true}})).error);assert.ok((await other.c.from('profiles').select('id,revision')).error);assert.equal(await page(other.c),null);checks++;
 console.log(`Passed ${checks} public boundary checks: raw table/column denial, minimal DTO, owner cannot bypass public flags, hidden/deleted/growth opt-in, suspended/deleting states and forged metadata.`);
}finally{localQuery(`update private.account_state set status='active'where user_id='${owner.id}'`);await finishAccount(owner);await finishAccount(other);}
