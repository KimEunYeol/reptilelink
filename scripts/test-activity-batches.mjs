import assert from 'node:assert/strict';
import {createAccount,finishAccount,call,admin} from './account-qa.mjs';
import {localQuery} from './local-utils.mjs';
const owner=await createAccount(),writer=await createAccount(),jobs=[];let checks=0;
const remaining=(table,where)=>Number(localQuery(`select count(*) from ${table} where ${where}`).trim());
async function scheduled(actor){
 const stored=localQuery("select command from cron.job where jobname='reptilelink-activity-retention'").trim();assert.ok(stored.includes('cleanup_actor uuid := NULL;'));assert.ok(stored.includes('COMMIT;'));
 const command=stored.replace('cleanup_actor uuid := NULL;',`cleanup_actor uuid := '${actor}'::uuid;`).replaceAll("'","''"),name=`qa-activity-batches-${crypto.randomUUID()}`,id=Number(localQuery(`select cron.schedule('${name}','10 seconds','${command}')`).trim());jobs.push(id);assert.ok(Number.isInteger(id));
 let completed=false;
 for(let n=0;n<100;n++){const status=localQuery(`select status from cron.job_run_details where jobid=${id} order by runid limit 1`).trim();if(status==='succeeded'){completed=true;break;}if(status==='failed')throw new Error(localQuery(`select return_message from cron.job_run_details where jobid=${id} order by runid limit 1`).trim());await new Promise(r=>setTimeout(r,200));}
 localQuery(`select cron.unschedule(${id})`);assert.equal(completed,true);assert.equal(remaining('cron.job_run_details',`jobid=${id}`),1);checks++;
}
try{
 const animals=[];for(let n=0;n<4;n++)animals.push((await call(owner.c,'create_animal',{p_data:{name:`배치 QA${n}`,species:'게코',morph:'',sex:'unknown',description:'',listing_status:'not_listed',is_public:false},p_expected:(await call(owner.c,'my_dashboard')).profile.revision,p_request_id:crypto.randomUUID()})).id);
 const seedBuckets=n=>localQuery(`insert into private.action_buckets(actor_id,action,window_started_at,window_seconds,count,expires_at) select '${owner.id}','comment',date_trunc('minute',now()-interval '90 hours')+make_interval(mins=>i),60,1,now()-interval '1 second' from generate_series(1,${n}) i on conflict do nothing`);
 seedBuckets(610);assert.equal((await call(admin,'prune_activity',{p_actor:owner.id})).buckets,500);assert.equal(remaining('private.action_buckets',`actor_id='${owner.id}'`),110);checks++;
 seedBuckets(610);await scheduled(owner.id);assert.equal(remaining('private.action_buckets',`actor_id='${owner.id}'`),0);checks++;console.log('One actual scheduled run drained610 buckets after reproducing the old500-row remainder.');
 const ids=animals.map(id=>`'${id}'::uuid`).join(',');localQuery(`insert into public.comments(profile_id,animal_id,author_id,body,created_at) select '${owner.id}',(array[${ids}])[1+(i%4)],'${writer.id}','보관 배치 QA',now()-interval '91 days' from generate_series(1,610)i;insert into private.notifications(recipient_id,comment_id,created_at) select '${owner.id}',id,now()-interval '91 days' from public.comments where profile_id='${owner.id}';`);
 await scheduled(owner.id);assert.equal(remaining('private.notifications',`recipient_id='${owner.id}'`),0);assert.equal(remaining('public.comments',`profile_id='${owner.id}'`),610);checks++;console.log('One actual scheduled run drained610 notifications while preserving the visible comments.');
 localQuery(`update public.comments set status='deleted',body=null,deleted_at=now()-interval '7 days' where profile_id='${owner.id}'`);await scheduled(writer.id);assert.equal(remaining('public.comments',`author_id='${writer.id}'`),0);checks++;console.log('One actual scheduled run drained610 deleted comment rows.');
 localQuery(`insert into private.content_reports(reporter_id,profile_id,animal_id,reason,status,resolved_at,resolution_action,resolution_request_id) select '${writer.id}','${owner.id}','${animals[0]}','other','resolved',now()-interval '90 days','dismiss',gen_random_uuid() from generate_series(1,610);`);await scheduled(writer.id);assert.equal(remaining('private.content_reports',`reporter_id='${writer.id}'`),0);checks++;console.log('One actual scheduled run drained610 resolved reports.');
 console.log(`Passed ${checks} retention batch regression checks: first-run-only pg_cron execution, separate commits, and over500 eligible buckets/notifications/comments/reports without touching existing actors.`);
}finally{for(const id of jobs){localQuery(`select cron.unschedule(jobid) from cron.job where jobid=${id};delete from cron.job_run_details where jobid=${id};`);}await finishAccount(writer);await finishAccount(owner);}
