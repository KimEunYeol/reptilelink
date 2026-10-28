import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { fixturePassword, localQuery, localStatus } from './local-utils.mjs';

const { url, publishable } = localStatus();
const client = () => createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(email) { const c = client(); const result = await c.auth.signInWithPassword({ email, password: fixturePassword }); assert.ifError(result.error); return c; }
const owner = await login('qa-owner@reptilelink.test'), other = await login('qa-other@reptilelink.test');
const pending = await login('pending@reptilelink.test'), guest = client();
const actor = (await owner.auth.getUser()).data.user.id;
const call = async (c, name, args) => { const r = await c.schema('api').rpc(name, args); assert.ifError(r.error); return r.data; };
const dash = () => call(owner, 'my_dashboard');
let current = await dash();
if (!current.animals.length) {
  await call(owner, 'create_animal', { p_data: { name: '수정 QA', species: '게코' }, p_expected: current.profile.revision, p_request_id: crypto.randomUUID() });
  current = await dash();
}
const animal = current.animals[0];
const original = JSON.parse(localQuery(`select to_jsonb(a) from public.animals a where id='${animal.id}';`).trim());
const originallyPublished = current.profile.is_published;
const originalNote = JSON.parse(localQuery(`select coalesce((select to_jsonb(n) from private.animal_notes n where animal_id='${animal.id}'),'null'::jsonb);`).trim());
const originalConsent = JSON.parse(localQuery(`select to_jsonb(c) from private.consents c where user_id='${actor}' and document_kind='terms' and document_version='local-preview-v1';`).trim());
const quote = value => JSON.stringify(value).replaceAll("'", "''");
let checks = 0;
const valid = { name: '수정된 QA', species: '크레스티드 게코', morph: '릴리화이트', sex: 'female', birth_date: '2024-02-29', description: '저장 확인', listing_status: 'reserved' };
const args = async (data = valid, requestId = crypto.randomUUID()) => ({ p_animal_id: animal.id, p_data: data, p_expected: (await dash()).profile.revision, p_request_id: requestId });
const snapshot = async () => { const d = await dash(); return JSON.stringify({ animal: d.animals.find(a => a.id === animal.id), revision: d.profile.revision,
  receipts: localQuery(`select count(*) from private.mutation_receipts where actor_id='${actor}';`).trim() }); };
async function rejects(c, parameters, pattern = /VALIDATION_FAILED/) {
  const before = await snapshot();
  const r = await c.schema('api').rpc('update_animal', parameters);
  assert.ok(r.error, 'Update should be rejected');
  if (pattern) assert.match(r.error.message, pattern);
  assert.equal(await snapshot(), before, 'Rejected command must not mutate data, revision or receipts');
  checks++;
}

try {
  const first = await args();
  const saved = await call(owner, 'update_animal', first);
  assert.equal(saved.revision, first.p_expected + 1); checks++;
  const edited = (await dash()).animals.find(a => a.id === animal.id);
  for (const [key, value] of Object.entries(valid)) assert.equal(edited[key], value);
  assert.equal(edited.is_public, original.is_public);
  assert.equal(edited.profile_id, actor);
  assert.equal(edited.show_growth, original.show_growth);
  assert.equal(edited.sort_order, original.sort_order);
  assert.deepEqual(edited.photos, animal.photos); checks++;
  assert.deepEqual(await call(owner, 'update_animal', first), saved);
  assert.equal((await dash()).profile.revision, saved.revision); checks++;
  const duplicate = await args({ ...valid, description: '중복 동시 요청' });
  const double = await Promise.all([call(owner, 'update_animal', duplicate), call(owner, 'update_animal', duplicate)]);
  assert.deepEqual(double[0], double[1]); assert.equal(double[0].revision, duplicate.p_expected + 1); checks++;
  await rejects(owner, { ...first, p_data: { ...valid, name: '요청 변조' } }, /REQUEST_CONFLICT/);
  if (current.animals.length > 1) await rejects(owner, { ...first, p_animal_id: current.animals[1].id }, /REQUEST_CONFLICT/);
  await rejects(owner, { ...await args(), p_expected: null }, /VERSION_CONFLICT/);
  await rejects(owner, { ...await args(), p_expected: first.p_expected }, /VERSION_CONFLICT/);
  await rejects(owner, { ...await args(), p_request_id: null });
  await rejects(owner, { ...await args(), p_animal_id: null });

  const parallel = await args();
  const race = await Promise.all(['동시 수정 A', '동시 수정 B'].map(name => owner.schema('api').rpc('update_animal', {
    ...parallel, p_request_id: crypto.randomUUID(), p_data: { ...valid, name },
  })));
  assert.equal(race.filter(r => !r.error).length, 1);
  assert.match(race.find(r => r.error).error.message, /VERSION_CONFLICT/);
  assert.equal((await dash()).profile.revision, parallel.p_expected + 1); checks++;

  const future = `${new Date().getUTCFullYear() + 1}-01-01`;
  const bad = [
    { name: '   ' }, { name: '\t\n' }, { name: '\uFEFF' }, { species: '\uFEFF' }, { name: '가'.repeat(41) }, { species: '' }, { species: '가'.repeat(81) },
    { morph: '가'.repeat(121) }, { description: '가'.repeat(501) }, { sex: 'admin' }, { listing_status: 'paid' },
    { name: null }, { species: 12 }, { description: {} }, { birth_date: future }, { birth_date: '2023-02-29' },
    { birth_date: '2024-02-30' }, { birth_date: '2024-2-01' }, { birth_date: '' }, { birth_date: '0000-01-01' }, { birth_date: true },
    { is_public: !original.is_public }, { profile_id: actor }, { photos: [] }, { sort_order: 0 }, { show_growth: true },
  ];
  for (const invalid of bad) await rejects(owner, await args({ ...valid, ...invalid }));
  for (const invalid of [null, [], 'animal', Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'name'))]) await rejects(owner, await args(invalid));
  await rejects(guest, await args(), null);
  await rejects(other, { ...await args(), p_expected: (await call(other, 'my_dashboard')).profile.revision }, /NOT_FOUND/);
  await rejects(pending, await args(), /ACCOUNT_NOT_ACTIVE/);
  localQuery(`update private.account_state set status='suspended' where user_id='${actor}';`);
  const suspended = await owner.schema('api').rpc('update_animal', { ...first, p_request_id: crypto.randomUUID() });
  assert.match(suspended.error?.message ?? '', /ACCOUNT_NOT_ACTIVE/); checks++;
  localQuery(`update private.account_state set status='active' where user_id='${actor}';`);
  localQuery(`delete from private.consents where user_id='${actor}' and document_kind='terms' and document_version='local-preview-v1';`);
  await rejects(owner, await args(), /CONSENT_REQUIRED/);
  localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${quote(originalConsent)}');`);
  const direct = await owner.from('animals').update({ name: 'direct write' }).eq('id', animal.id);
  assert.ok(direct.error); checks++;

  await call(owner, 'update_animal', await args({ ...valid, name: '\uFEFF '+ '🦎'.repeat(40) +' \uFEFF', description: '\uFEFF설명\uFEFF' }));
  const normalized = (await dash()).animals.find(a => a.id === animal.id);
  assert.equal(normalized.name, '🦎'.repeat(40)); assert.equal(normalized.description, '설명'); checks++;
  const today = localQuery("select (statement_timestamp() at time zone 'Asia/Seoul')::date;").trim();
  await call(owner, 'update_animal', await args({ ...valid, name: '🦎'.repeat(40), birth_date: today })); checks++;
  await rejects(owner, await args({ ...valid, name: '🦎'.repeat(41) }));
  await call(owner, 'update_animal', await args({ ...valid, birth_date: null }));
  assert.equal((await dash()).animals.find(a => a.id === animal.id).birth_date, null); checks++;
  const relogged = await login('qa-owner@reptilelink.test');
  assert.equal((await call(relogged, 'my_dashboard')).animals.find(a => a.id === animal.id).name, valid.name); checks++;

  let revision = (await dash()).profile.revision;
  revision = (await call(owner, 'set_profile_public', { p_public: true, p_expected: revision })).revision;
  revision = (await call(owner, 'set_animal_public', { p_animal_id: animal.id, p_public: true, p_expected: revision })).revision;
  await call(owner, 'update_animal', { ...await args(), p_expected: revision });
  localQuery(`insert into private.animal_notes(animal_id,profile_id,body) values('${animal.id}','${actor}','private-edit-regression') on conflict(animal_id) do update set body=excluded.body;`);
  const page = await call(guest, 'public_page', { p_slug: (await dash()).profile.slug });
  const publicAnimal = page.animals.find(a => a.id === animal.id);
  assert.equal(publicAnimal.birth_date, valid.birth_date);
  assert.equal(publicAnimal.name, valid.name);
  assert.ok(!JSON.stringify(page).match(/private-edit-regression|profile_id|object_path|qa-owner@/)); checks++;
  await call(owner, 'set_animal_public', { p_animal_id: animal.id, p_public: false, p_expected: (await dash()).profile.revision });
  await call(owner, 'update_animal', await args({ ...valid, name: '계속 비공개' }));
  assert.ok(!(await call(guest, 'public_page', { p_slug: page.profile.slug })).animals.some(a => a.id === animal.id)); checks++;
  const stale = (await dash()).profile.revision;
  const retry = await args();
  await call(owner, 'update_animal', retry);
  localQuery(`update private.mutation_receipts set expires_at=now()-interval '1 minute' where actor_id='${actor}' and request_id='${retry.p_request_id}';`);
  await rejects(owner, { ...retry, p_expected: stale }, /REQUEST_EXPIRED/);
} finally {
  // Dedicated QA accounts only; restore all temporarily changed fixture state even on failure.
  localQuery(`update private.account_state set status='active' where user_id='${actor}';
    insert into private.consents select * from jsonb_populate_record(null::private.consents,'${quote(originalConsent)}') on conflict do nothing;
    update public.animals a set name=r.name,species=r.species,morph=r.morph,sex=r.sex,birth_date=r.birth_date,
      description=r.description,listing_status=r.listing_status,is_public=r.is_public,updated_at=r.updated_at
      from jsonb_populate_record(null::public.animals,'${quote(original)}') r where a.id=r.id;
    delete from private.animal_notes where animal_id='${animal.id}';`);
  if (originalNote) localQuery(`insert into private.animal_notes select * from jsonb_populate_record(null::private.animal_notes,'${quote(originalNote)}');`);
  await call(owner, 'set_profile_public', { p_public: originallyPublished, p_expected: (await dash()).profile.revision });
}
console.log(`Passed ${checks} real local animal-edit checks: input, ownership, concurrency, replay, persistence and public isolation.`);
