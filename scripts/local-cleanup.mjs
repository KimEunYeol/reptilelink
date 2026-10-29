import { localAdmin } from './local-utils.mjs';
const admin = localAdmin();
const rows = await admin.schema('api').rpc('expired_uploads');
if (rows.error) throw rows.error;
let count = 0;
for (const row of rows.data) {
  const manifest = await admin.schema('api').rpc('cleanup_manifest', { p_asset_id: row.id, p_actor: row.profile_id });
  if (manifest.error) throw manifest.error;
  if (!manifest.data) continue;
  const removed = await admin.storage.from('animal-media').remove(manifest.data);
  if (removed.error) throw removed.error;
  const result = await admin.schema('api').rpc('finish_cleanup', { p_asset_id: row.id });
  if (result.error) throw result.error;
  count++;
}
console.log(`Cleaned ${count} expired local upload reservations.`);
const jobs = await admin.schema('api').rpc('pending_animal_deletions');
if (jobs.error) throw jobs.error;
let animals = 0;
for (const row of jobs.data) {
  const finished = await admin.schema('api').rpc('finish_animal_deletion', { p_animal_id: row.id, p_actor: row.profile_id });
  if (finished.error) throw finished.error;
  if (finished.data) animals++;
}
console.log(`Finished ${animals} local animal deletions.`);
