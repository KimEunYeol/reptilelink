import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { fixturePassword, localAdmin, localQuery, localStatus } from './local-utils.mjs';

const status = localStatus(), admin = localAdmin(), options = { auth: { persistSession: false, autoRefreshToken: false } };
const guest = createClient(status.url, status.publishable, options);
async function login(email) { const client = createClient(status.url, status.publishable, options); const result = await client.auth.signInWithPassword({ email, password: fixturePassword }); assert.ifError(result.error); return client; }
async function rpc(client, name, args) { const result = await client.schema('api').rpc(name, args); assert.ifError(result.error); return result.data; }
async function expectError(client, name, args, pattern) { const result = await client.schema('api').rpc(name, args); assert.ok(result.error, `${name} should fail`); if (pattern) assert.match(result.error.message, pattern); }
const a = await login('qa-owner@reptilelink.test'), b = await login('qa-other@reptilelink.test'), pending = await login('pending@reptilelink.test');
const aId = (await a.auth.getUser()).data.user.id, bId = (await b.auth.getUser()).data.user.id;
let checked = 0;
await expectError(guest, 'my_dashboard'); checked++;
await expectError(pending, 'save_profile', { p_slug: 'pending-room', p_name: '대기', p_bio: '', p_expected: 0, p_publish: false, p_accept_terms: true }, /ACCOUNT_NOT_ACTIVE/); checked++;
for (const [client, slug] of [[a,'qa-owner'],[b,'qa-other']]) {
  const dash = await rpc(client, 'my_dashboard');
  if (!dash.profile) await rpc(client, 'save_profile', { p_slug: slug, p_name: slug, p_bio: '로컬 권한 테스트', p_expected: 0, p_publish: false, p_accept_terms: true });
}
// Only these dedicated QA fixtures may be reset; localStatus refuses every non-loopback server.
const oldAssets = JSON.parse(localQuery(`select coalesce(json_agg(json_build_object('id',id,'profile_id',profile_id)),'[]') from private.media_assets where profile_id in ('${aId}','${bId}');`).trim());
for (const row of oldAssets) { localQuery(`delete from public.animal_photos where asset_id='${row.id}'; update private.media_assets set cleanup_after=now()-interval '1 second' where id='${row.id}'`); const paths=await rpc(admin,'cleanup_manifest',{p_asset_id:row.id,p_actor:row.profile_id}); if(paths?.length) assert.ifError((await admin.storage.from('animal-media').remove(paths)).error); await rpc(admin,'finish_cleanup',{p_asset_id:row.id}); }
localQuery(`delete from public.animals where profile_id in ('${aId}'::uuid,'${bId}'::uuid);`);
let dash = await rpc(a, 'my_dashboard');
await rpc(a, 'set_profile_public', { p_public: false, p_expected: dash.profile.revision });
dash = await rpc(a, 'my_dashboard');
assert.equal(await rpc(guest, 'public_page', { p_slug: 'qa-owner' }), null); checked++;
await expectError(a, 'save_profile', { p_slug: 'qa-owner', p_name: 'QA', p_bio: '', p_expected: null, p_publish: false, p_accept_terms: false }, /VERSION_CONFLICT/); checked++;
const requestId = crypto.randomUUID(), animalData = { name: '권한 테스트 개체', species: '크레스티드 게코', is_public: false };
const created = await rpc(a, 'create_animal', { p_data: animalData, p_expected: dash.profile.revision, p_request_id: requestId });
const replay = await rpc(a, 'create_animal', { p_data: animalData, p_expected: dash.profile.revision, p_request_id: requestId });
assert.equal(created.id,replay.id); checked++;
await expectError(a,'create_animal',{p_data:{...animalData,name:'다른 본문'},p_expected:created.revision,p_request_id:requestId},/REQUEST_CONFLICT/); checked++;
const bDash = await rpc(b, 'my_dashboard');
await expectError(b,'set_animal_public',{p_animal_id:created.id,p_public:true,p_expected:bDash.profile.revision},/NOT_FOUND/); checked++;
const direct = await b.from('animals').update({profile_id:bId}).eq('id',created.id); assert.ok(direct.error); checked++;
const hidden = await b.from('animals').select('id').eq('id',created.id); assert.ok(hidden.error); checked++;
await expectError(a,'complete_upload',{p_asset_id:crypto.randomUUID(),p_actor:aId,p_objects:[]}); checked++;
await expectError(a,'media_access',{p_asset_id:crypto.randomUUID(),p_variant:'thumbnail',p_actor:aId}); checked++;
const reservations = await Promise.all(Array.from({length:5},()=>a.schema('api').rpc('reserve_upload',{p_animal_id:created.id})));
assert.equal(reservations.filter(result=>!result.error).length,2); checked++;
const usage = (await rpc(a,'my_dashboard')).usage; assert.equal(usage.reserved_bytes,614400); checked++;
for (const reserved of reservations.filter(result=>!result.error)) { localQuery(`update private.media_assets set cleanup_after=now()-interval '1 second' where id='${reserved.data.asset_id}' and profile_id='${aId}'`); await rpc(admin,'cleanup_manifest',{p_asset_id:reserved.data.asset_id,p_actor:aId}); await rpc(admin,'finish_cleanup',{p_asset_id:reserved.data.asset_id}); }
assert.equal((await rpc(a,'my_dashboard')).usage.reserved_bytes,0); checked++;
let revision = (await rpc(a,'my_dashboard')).profile.revision;
revision=(await rpc(a,'set_animal_public',{p_animal_id:created.id,p_public:true,p_expected:revision})).revision;
revision=(await rpc(a,'set_profile_public',{p_public:true,p_expected:revision})).revision;
const visible = await rpc(guest,'public_page',{p_slug:'qa-owner'}); assert.equal(visible.animals.length,1); assert.ok(!('profile_id' in visible.animals[0])); checked++;
assert.ok(!JSON.stringify(visible).includes('qa-owner@')); checked++;
await expectError(a,'save_profile',{p_slug:'new-qa-address',p_name:'QA',p_bio:'',p_expected:revision,p_publish:true,p_accept_terms:false},/SLUG_LOCKED/); checked++;
for (let index=1;index<20;index++) revision=(await rpc(a,'create_animal',{p_data:{name:`QA ${index}`,species:'게코',is_public:false},p_expected:revision,p_request_id:crypto.randomUUID()})).revision;
await expectError(a,'create_animal',{p_data:animalData,p_expected:revision,p_request_id:crypto.randomUUID()},/QUOTA_EXCEEDED/); checked++;
localQuery(`update private.account_state set status='suspended' where user_id='${aId}';`);
assert.equal(await rpc(guest,'public_page',{p_slug:'qa-owner'}),null); checked++;
await expectError(a,'set_profile_public',{p_public:true,p_expected:revision},/ACCOUNT_NOT_ACTIVE/); checked++;
localQuery(`update private.account_state set status='active' where user_id='${aId}';`);
await rpc(a,'set_profile_public',{p_public:false,p_expected:revision});
console.log(`Passed ${checked} real local Auth/DB/RLS/quota checks.`);
