import { localAdmin } from './local-utils.mjs';
const args=process.argv.slice(2);
const target=args.length===2&&args[0]==='--account'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(args[1])?args[1]:null;
if(args.length&&!target)throw new Error('Usage: node scripts/local-cleanup.mjs [--account UUID]');
const admin = localAdmin();
if(!target){
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

}
const {processAccountDeletion}=await import('../worker/account-cleanup.ts');
const accounts=target?{data:[target],error:null}:await admin.schema('api').rpc('pending_account_deletions');
if(accounts.error)throw accounts.error;
let completedAccounts=0,pendingAccounts=0;
for(const id of accounts.data){try{const result=await processAccountDeletion(admin,id);if(result.deleted)completedAccounts++;else pendingAccounts++;}catch{pendingAccounts++;}}
console.log(`Account cleanup: ${completedAccounts} completed, ${pendingAccounts} pending. Sessions awaiting confirmation require the account owner to retry after sign-in.`);
