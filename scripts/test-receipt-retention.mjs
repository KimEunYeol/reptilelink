import assert from'node:assert/strict';
import{createAccount,finishAccount,call,client,admin}from'./account-qa.mjs';
import{localQuery}from'./local-utils.mjs';
const users=[],jobs=[];let checks=0;
const oldLimit=Number(localQuery('select receipt_limit from private.project_budget where id=1').trim());
const make=async()=>{const a=await createAccount();users.push(a);return a;};
async function denied(c,n,p,re){const r=await c.schema('api').rpc(n,p);assert.ok(r.error);assert.match(r.error.message,re);checks++;}
const seed=(a,n)=>localQuery(`insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref,created_at,expires_at)select '${a.id}',gen_random_uuid(),'qa_retention',md5(i::text),'{}',now()-interval '27 hours',now()-interval '3 hours'from generate_series(1,${n})i`);
const remaining=a=>Number(localQuery(`select count(*)from private.mutation_receipts where actor_id='${a.id}'and operation='qa_retention'`).trim());
try{
 const owner=await make(),other=await make(),withdraw=await make();
 const d=()=>call(owner.c,'my_dashboard');
 const creation={p_data:{name:'영수증 QA',species:'게코',is_public:false},p_expected:(await d()).profile.revision,p_request_id:crypto.randomUUID()};
 const animal=await call(owner.c,'create_animal',creation);
 await denied(client(),'prune_mutation_receipts',{p_actor:owner.id},/permission denied/);
 await denied(owner.c,'prune_mutation_receipts',{p_actor:other.id},/permission denied/);
 assert.equal(localQuery("select has_function_privilege('service_role','api.prune_mutation_receipts(uuid)','execute')and not has_table_privilege('authenticated','private.mutation_receipts','select')and not has_function_privilege('authenticated','private.prune_mutation_receipts(uuid)','execute')").trim(),'t');checks++;
 const reserved={p_animal_id:animal.id,p_request_id:crypto.randomUUID()},asset=await call(owner.c,'reserve_self_photo',reserved);
 const before=(await d()).profile.revision;
 localQuery('update private.project_budget set receipt_limit=0 where id=1');
 assert.equal((await call(owner.c,'create_animal',creation)).id,animal.id);checks++;
 await denied(owner.c,'create_animal',{...creation,p_expected:before,p_request_id:crypto.randomUUID()},/SERVICE_UNAVAILABLE/);
 assert.equal((await d()).profile.revision,before);assert.equal((await d()).animals.length,1);checks++;
 assert.equal(await call(owner.c,'cancel_self_photo_request',reserved),asset.asset_id);checks++;
 const bucketBefore=localQuery(`select coalesce(sum(count),0)from private.action_buckets where actor_id='${owner.id}'and action='upload_cancel'`).trim();
 await denied(owner.c,'cancel_self_photo_request',{p_animal_id:animal.id,p_request_id:crypto.randomUUID()},/SERVICE_UNAVAILABLE/);
 assert.equal(localQuery(`select coalesce(sum(count),0)from private.action_buckets where actor_id='${owner.id}'and action='upload_cancel'`).trim(),bucketBefore);checks++;
 const withdrawal={p_expected:(await call(withdraw.c,'my_dashboard')).profile.revision,p_request_id:crypto.randomUUID(),p_confirm:'탈퇴'};
 await call(withdraw.c,'request_account_deletion',withdrawal);checks++;
 localQuery(`update private.project_budget set receipt_limit=${oldLimit} where id=1;update private.mutation_receipts set expires_at=now()-interval '3 days'where actor_id='${withdraw.id}'`);
 assert.equal((await call(admin,'prune_mutation_receipts',{p_actor:withdraw.id})).receipts,0);assert.ok(await call(withdraw.c,'request_account_deletion',withdrawal));checks++;
 // Only a new cancellation tombstone consumes the shared hourly120 budget.
 const cmds=Array.from({length:119},(_,i)=>i%3===0?['cancel_profile_upload_request',{p_purpose:'avatar',p_request_id:crypto.randomUUID()}]:i%3===1?['cancel_parent_photo_request',{p_animal_id:animal.id,p_role:'father',p_request_id:crypto.randomUUID()}]:['cancel_self_photo_request',{p_animal_id:animal.id,p_request_id:crypto.randomUUID()}]);
 for(const[n,p]of cmds)await call(owner.c,n,p);
 const same={p_animal_id:animal.id,p_request_id:crypto.randomUUID()};await Promise.all(Array.from({length:8},()=>call(owner.c,'cancel_self_photo_request',same)));
 assert.equal(localQuery(`select sum(count)from private.action_buckets where actor_id='${owner.id}'and action='upload_cancel'`).trim(),'120');checks++;
 await denied(owner.c,'cancel_profile_upload_request',{p_purpose:'cover',p_request_id:crypto.randomUUID()},/RATE_LIMITED/);
 await call(owner.c,cmds[0][0],cmds[0][1]);await call(owner.c,'cancel_self_photo_request',reserved);
 assert.equal(localQuery(`select sum(count)from private.action_buckets where actor_id='${owner.id}'and action='upload_cancel'`).trim(),'120');checks++;
 localQuery(`update private.action_buckets set window_started_at=window_started_at-interval '1 hour'where actor_id='${owner.id}'and action='upload_cancel'`);
 await call(owner.c,'cancel_self_photo_request',{p_animal_id:animal.id,p_request_id:crypto.randomUUID()});checks++;
 const size=Number(localQuery('select count(*)from private.mutation_receipts').trim());localQuery(`update private.project_budget set receipt_limit=${size} where id=1`);
 await denied(owner.c,'cancel_self_photo_request',{p_animal_id:animal.id,p_request_id:crypto.randomUUID()},/SERVICE_UNAVAILABLE/);
 assert.equal((await call(owner.c,'create_animal',creation)).id,animal.id);checks++;
 localQuery(`update private.project_budget set receipt_limit=${oldLimit} where id=1`);
 const recent=crypto.randomUUID(),eligible=crypto.randomUUID();localQuery(`insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref,expires_at)values('${owner.id}','${recent}','qa_boundary','a','{}',now()-interval '59 minutes'),('${owner.id}','${eligible}','qa_boundary','a','{}',now()-interval '61 minutes');update private.mutation_receipts set expires_at=now()-interval '3 hours'where actor_id='${owner.id}'and request_id='${reserved.p_request_id}';update private.media_assets set cleanup_after=now()+interval '1 hour'where id='${asset.asset_id}'and profile_id='${owner.id}'`);
 assert.equal((await call(admin,'prune_mutation_receipts',{p_actor:owner.id})).receipts,1);assert.equal(localQuery(`select count(*)from private.mutation_receipts where actor_id='${owner.id}'and request_id in('${recent}','${reserved.p_request_id}')`).trim(),'2');checks++;
 localQuery(`update private.media_assets set cleanup_after=now()-interval '1 second'where id='${asset.asset_id}'and profile_id='${owner.id}'`);assert.equal((await call(admin,'prune_mutation_receipts',{p_actor:owner.id})).receipts,1);checks++;
 seed(owner,610);seed(other,1);const first=await call(admin,'prune_mutation_receipts',{p_actor:owner.id});assert.equal(first.receipts,500);assert.equal(remaining(owner),110);checks++;
 const parallel=await Promise.all([call(admin,'prune_mutation_receipts',{p_actor:owner.id}),call(admin,'prune_mutation_receipts',{p_actor:owner.id})]);assert.equal(parallel.reduce((n,r)=>n+r.receipts,0),110);assert.equal(remaining(owner),0);assert.equal(remaining(other),1);checks++;
 seed(owner,610);
 const command=localQuery("select command from cron.job where jobname='reptilelink-activity-retention'").trim();assert.equal(command.match(/COMMIT;/g).length,4);assert.ok(command.includes('private.prune_mutation_receipts(cleanup_actor)'));
 const scoped=command.replace('cleanup_actor uuid := NULL;',`cleanup_actor uuid := '${owner.id}'::uuid;`).replaceAll("'","''"),job=Number(localQuery(`select cron.schedule('qa-receipts-${crypto.randomUUID()}','10 seconds','${scoped}')`).trim());jobs.push(job);
 let done=false;for(let i=0;i<100;i++){const status=localQuery(`select status from cron.job_run_details where jobid=${job} order by runid limit 1`).trim();if(status==='succeeded'){done=true;break;}if(status==='failed')throw Error(localQuery(`select return_message from cron.job_run_details where jobid=${job} order by runid limit 1`).trim());await new Promise(r=>setTimeout(r,200));}
 localQuery(`select cron.unschedule(${job})`);assert.ok(done);assert.equal(remaining(owner),0);assert.equal(remaining(other),1);assert.equal(localQuery(`select count(*)from cron.job_run_details where jobid=${job}`).trim(),'1');checks++;
 console.log(`Passed ${checks} receipt-retention DB/Cron checks: roles, soft budget/rollback/free replay/withdrawal, shared cancellation120/replay/concurrency, expiry margin/live lease/active job,500/parallel drain and first scheduled610/scoped preservation.`);
}finally{
 localQuery(`update private.project_budget set receipt_limit=${oldLimit} where id=1`);
 for(const id of jobs)localQuery(`select cron.unschedule(jobid)from cron.job where jobid=${id};delete from cron.job_run_details where jobid=${id}`);
 for(const a of users)await finishAccount(a);
}
