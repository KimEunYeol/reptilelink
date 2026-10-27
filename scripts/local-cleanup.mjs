import { localAdmin } from './local-utils.mjs';
const admin = localAdmin();
const rows = await admin.schema('api').rpc('expired_uploads');
if (rows.error) throw rows.error;
let count = 0;
for (const row of rows.data) {
  const manifest = await admin.schema('api').rpc('cleanup_manifest', { p_asset_id: row.id, p_actor: row.profile_id });
  if (manifest.error) throw manifest.error;
  const removed = await admin.storage.from('animal-media').remove(manifest.data);
  if (removed.error) throw removed.error;
  const result = await admin.schema('api').rpc('finish_cleanup', { p_asset_id: row.id });
  if (result.error) throw result.error;
  count++;
}
console.log(`Cleaned ${count} expired local upload reservations.`);
