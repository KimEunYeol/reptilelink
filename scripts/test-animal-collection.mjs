import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { fixturePassword, localQuery, localStatus } from './local-utils.mjs';

const { url, publishable } = localStatus();
const client = () => createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(email) { const c = client(); assert.ifError((await c.auth.signInWithPassword({ email, password: fixturePassword })).error); return c; }
const owner = await login('qa-owner@reptilelink.test'), other = await login('qa-other@reptilelink.test');
const pending = await login('pending@reptilelink.test'), guest = client();
const actor = (await owner.auth.getUser()).data.user.id, otherActor = (await other.auth.getUser()).data.user.id;
const call = async (c, name, args) => { const r = await c.schema('api').rpc(name, args); assert.ifError(r.error); return r.data; };
const dash = (c = owner) => call(c, 'my_dashboard');
const items = d => d.animals.map(a => ({ id: a.id, is_public: a.is_public }));
const args = async (data, id = crypto.randomUUID(), c = owner) => ({ p_items: data ?? items(await dash(c)), p_expected: (await dash(c)).profile.revision, p_request_id: id });
const quote = value => JSON.stringify(value).replaceAll("'", "''");
const originals = JSON.parse(localQuery(`select coalesce(jsonb_agg(to_jsonb(a) order by a.sort_order),'[]') from public.animals a where profile_id='${actor}'`).trim());
const originalPublic = (await dash()).profile.is_published;
const consent = JSON.parse(localQuery(`select to_jsonb(c) from private.consents c where user_id='${actor}' and document_kind='terms' and document_version='local-preview-v1'`).trim());
const writesEnabled = localQuery('select writes_enabled from private.project_budget where id=1').trim();
const created = [];
let checks = 0;
const snapshot = () => localQuery(`select jsonb_build_object('animals',(select jsonb_agg(to_jsonb(a) order by a.id) from public.animals a where profile_id='${actor}'),
  'revision',(select revision from public.profiles where id='${actor}'),'receipts',(select count(*) from private.mutation_receipts where actor_id='${actor}'))`).trim();
async function rejects(c, parameters, pattern = /VALIDATION_FAILED/) {
  const before = snapshot();
  const r = await c.schema('api').rpc('apply_animal_collection', parameters);
  assert.ok(r.error, 'Collection should be rejected');
  if (pattern) assert.match(r.error.message, pattern);
  assert.equal(snapshot(), before, 'Rejected apply must leave rows, revision and receipts intact'); checks++;
}
try {
  const d = await dash(); assert.equal(d.animals.length, 20, 'Run test:db first');
  const changed = items(d).reverse().map((a, i) => ({ ...a, is_public: i % 2 === 0 }));
  const first = await args(changed), saved = await call(owner, 'apply_animal_collection', first);
  assert.equal(saved.revision, first.p_expected + 1); checks++;
  const after = await dash(); assert.deepEqual(items(after), changed);
  for (const [i, a] of after.animals.entries()) {
    assert.equal(a.sort_order, i);
    const old = originals.find(o => o.id === a.id);
    for (const key of ['name','species','morph','sex','birth_date','description','listing_status','profile_id','show_growth']) assert.deepEqual(a[key], old[key]);
  } checks++;
  assert.deepEqual(await call(owner, 'apply_animal_collection', first), saved);
  assert.equal((await dash()).profile.revision, saved.revision); checks++;
  await rejects(owner, { ...first, p_items: changed.toReversed() }, /REQUEST_CONFLICT/);
  const same = await args(changed.toReversed());
  const double = await Promise.all([call(owner, 'apply_animal_collection', same), call(owner, 'apply_animal_collection', same)]);
  assert.deepEqual(double[0], double[1]); assert.equal(double[0].revision, same.p_expected + 1); checks++;
  const race = await args(changed);
  const results = await Promise.all([changed, changed.map(a => ({ ...a, is_public: !a.is_public }))].map(p_items => owner.schema('api').rpc('apply_animal_collection', { ...race, p_items, p_request_id: crypto.randomUUID() })));
  assert.equal(results.filter(r => !r.error).length, 1); assert.match(results.find(r => r.error).error.message, /VERSION_CONFLICT/); checks++;
  const current = await dash(), editAnimal = current.animals[0];
  const mixed = await Promise.all([
    owner.schema('api').rpc('apply_animal_collection', { p_items:items(current).toReversed(),p_expected:current.profile.revision,p_request_id:crypto.randomUUID() }),
    owner.schema('api').rpc('update_animal', { p_animal_id:editAnimal.id,p_data:Object.fromEntries(['name','species','morph','sex','birth_date','description','listing_status'].map(key=>[key,editAnimal[key]])),p_expected:current.profile.revision,p_request_id:crypto.randomUUID() }),
  ]);
  assert.equal(mixed.filter(r=>!r.error).length,1); assert.match(mixed.find(r=>r.error).error.message,/VERSION_CONFLICT/); checks++;
  const base = items(await dash());
  for (const data of [null, {}, 'items', [null], [], base.slice(1), [...base, base[0]], base.map(() => base[0]),
    base.map((a,i) => i ? a : { ...a, id: 'not-a-uuid' }), base.map((a,i) => i ? a : { ...a, id: crypto.randomUUID() }),
    base.map((a,i) => i ? a : { id:a.id }), base.map((a,i) => i ? a : { ...a, is_public:'true' }),
    base.map((a,i) => i ? a : { ...a, sort_order:0 }), base.map((a,i) => i ? a : { ...a, name:'forbidden' }),
    base.map((a,i) => i ? a : { ...a, show_growth:true }), base.map((a,i) => i ? a : { ...a, profile_id:actor })]) {
    await rejects(owner, { ...await args(base), p_items:data });
  }
  await rejects(owner, { ...await args(base), p_request_id:null });
  await rejects(owner, { ...await args(base), p_expected:null }, /VERSION_CONFLICT/);
  await rejects(owner, { ...await args(base), p_expected:first.p_expected }, /VERSION_CONFLICT/);
  const foreignReceipt = localQuery(`select request_id from private.mutation_receipts where actor_id='${actor}' and operation='create_animal' limit 1`).trim();
  await rejects(owner, { ...await args(base), p_request_id:foreignReceipt }, /REQUEST_CONFLICT/);
  await rejects(guest, await args(base), null);
  await rejects(other, await args(base, crypto.randomUUID(), other));
  await rejects(pending, await args(base), /ACCOUNT_NOT_ACTIVE/);
  for (const status of ['pending','suspended','deleting']) {
    localQuery(`update private.account_state set status='${status}' where user_id='${actor}'`);
    const r = await owner.schema('api').rpc('apply_animal_collection', first);
    assert.match(r.error?.message ?? '', /ACCOUNT_NOT_ACTIVE/); checks++;
  }
  localQuery(`update private.account_state set status='active' where user_id='${actor}';delete from private.consents where user_id='${actor}' and document_kind='terms' and document_version='local-preview-v1'`);
  await rejects(owner, await args(base), /CONSENT_REQUIRED/);
  localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${quote(consent)}')`);
  await call(owner, 'apply_animal_collection', await args(base.map(a => ({ ...a, is_public:true }))));
  localQuery('update private.project_budget set writes_enabled=false where id=1');
  await rejects(owner, await args(items(await dash()).toReversed()), /SERVICE_UNAVAILABLE/);
  const hidden = items(await dash()).map(a => ({ ...a, is_public:false }));
  await call(owner, 'apply_animal_collection', await args(hidden)); assert.ok((await dash()).animals.every(a => !a.is_public)); checks++;
  await rejects(owner, await args(hidden.map(a => ({ ...a, is_public:true }))), /SERVICE_UNAVAILABLE/);
  localQuery('update private.project_budget set writes_enabled=true where id=1');
  await call(owner, 'set_profile_public', { p_public:true, p_expected:(await dash()).profile.revision });
  const publicItems = hidden.toReversed().map((a,i) => ({ ...a, is_public:i < 3 }));
  await call(owner, 'apply_animal_collection', await args(publicItems));
  const publicPage = await call(guest, 'public_page', { p_slug:(await dash()).profile.slug });
  assert.deepEqual(publicPage.animals.map(a => a.id), publicItems.filter(a => a.is_public).map(a => a.id));
  assert.ok(!JSON.stringify(publicPage).match(/profile_id|request_hash|object_path|qa-owner@/)); checks++;
  await call(owner, 'set_profile_public', { p_public:false, p_expected:(await dash()).profile.revision });
  assert.equal(await call(guest, 'public_page', { p_slug:(await dash()).profile.slug }), null); checks++;
  const expired = await args(items(await dash())); await call(owner, 'apply_animal_collection', expired);
  localQuery(`update private.mutation_receipts set expires_at=now()-interval '1 minute' where actor_id='${actor}' and request_id='${expired.p_request_id}'`);
  await rejects(owner, expired, /REQUEST_EXPIRED/);
  // Only dedicated QA-other rows created below may be removed. No developer animals are touched.
  assert.equal((await dash(other)).animals.length,0);
  for (const count of [0,1,10,11,20]) {
    while ((await dash(other)).animals.length < count) {
      const now=await dash(other);
      const made=await call(other,'create_animal',{p_data:{name:`목록 QA ${now.animals.length}`,species:'게코'},p_expected:now.profile.revision,p_request_id:crypto.randomUUID()});
      created.push(made.id);
    }
    const now=await dash(other), list=items(now).toReversed().map(a => ({ ...a,is_public:true }));
    const result=await call(other,'apply_animal_collection',await args(list,crypto.randomUUID(),other));
    assert.deepEqual(items(await dash(other)),list);
    assert.equal(result.revision,now.profile.revision+(count ? 1:0)); checks++;
  }
  const foreign = items(await dash(other))[0];
  await rejects(owner, await args(items(await dash()).map((a,i)=>i?a:foreign)));
} finally {
  localQuery(`update private.account_state set status='active' where user_id='${actor}';
    update private.project_budget set writes_enabled=${writesEnabled === 't' ? 'true':'false'} where id=1;
    insert into private.consents select * from jsonb_populate_record(null::private.consents,'${quote(consent)}') on conflict do nothing;
    update public.animals a set sort_order=r.sort_order,is_public=r.is_public,updated_at=r.updated_at
      from jsonb_populate_recordset(null::public.animals,'${quote(originals)}') r where a.id=r.id;
    update public.profiles set is_published=${originalPublic} where id='${actor}';`);
  if (created.length) localQuery(`delete from public.animals where profile_id='${otherActor}' and id=any(array[${created.map(id=>`'${id}'::uuid`).join(',')}])`);
}
console.log(`Passed ${checks} real local collection checks: atomic full-set apply, authorization, replay, concurrency, privacy and 0/1/10/11/20 items.`);
