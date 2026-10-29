import type {SupabaseClient} from '@supabase/supabase-js';
type Job={id:string;request_id:string;sessions_revoked:boolean;data_deleted:boolean};
export type AccountCleanupResult={deleted:boolean;cleanup_pending:boolean;phase:'sessions'|'files'|'auth'|'complete'};
async function rpc<T>(admin:SupabaseClient,name:string,args?:Record<string,unknown>):Promise<T>{const r=await admin.schema('api').rpc(name,args);if(r.error)throw new Error(r.error.message);return r.data as T;}
const pending=(phase:'sessions'|'files'|'auth'):AccountCleanupResult=>({deleted:false,cleanup_pending:true,phase});
/** One bounded pass: at most four assets, preserving upload leases and actual-byte accounting. */
export async function processAccountDeletion(admin:SupabaseClient,actor:string,jwt?:string):Promise<AccountCleanupResult>{
 const job=await rpc<Job|null>(admin,'account_deletion_job',{p_actor:actor});if(!job)throw new Error('NOT_FOUND');
 if(!job.sessions_revoked){
  if(!jwt)return pending('sessions');
  const revoked=await admin.auth.admin.signOut(jwt,'global');if(revoked.error)return pending('sessions');
  await rpc(admin,'mark_account_sessions_revoked',{p_actor:actor});
 }
 const assets=await rpc<string[]>(admin,'account_deletion_assets',{p_actor:actor});
 for(const id of assets){try{
  const paths=await rpc<string[]|null>(admin,'cleanup_manifest',{p_asset_id:id,p_actor:actor});if(!paths)continue;
  const removed=await admin.storage.from('animal-media').remove(paths);if(removed.error)continue;
  await rpc(admin,'finish_cleanup',{p_asset_id:id});
 }catch{/* The durable job and asset remain for the next bounded pass. */}}
 if(!await rpc<boolean>(admin,'finish_account_data',{p_actor:actor}))return pending('files');
 try{
  const current=await admin.auth.admin.getUserById(actor);
  if(current.error&&current.error.status!==404)return pending('auth');
  if(!current.error){const removed=await admin.auth.admin.deleteUser(actor,false);if(removed.error)return pending('auth');}
  // Includes reconciliation after deleteUser succeeded but its response was lost.
  await rpc(admin,'complete_account_deletion',{p_actor:actor});
  return {deleted:true,cleanup_pending:false,phase:'complete'};
 }catch{return pending('auth');}
}
