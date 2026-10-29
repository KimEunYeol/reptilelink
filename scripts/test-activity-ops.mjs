import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createAccount,finishAccount,call} from './account-qa.mjs';
import {localQuery} from './local-utils.mjs';
const owner=await createAccount(),writer=await createAccount(),jobName=`qa-activity-probe-${crypto.randomUUID()}`;let jobId=null,checks=0;
const cli=args=>JSON.parse(execFileSync(process.execPath,['scripts/local-moderate.mjs',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
try{
 const d=await call(owner.c,'my_dashboard');await call(owner.c,'set_profile_public',{p_public:true,p_expected:d.profile.revision});const target=await call(owner.c,'create_animal',{p_data:{name:'운영 QA',species:'게코',morph:'',sex:'unknown',description:'',listing_status:'not_listed',is_public:true},p_expected:(await call(owner.c,'my_dashboard')).profile.revision,p_request_id:crypto.randomUUID()});
 const comment=await call(writer.c,'create_comment',{p_animal_id:target.id,p_body:'운영 검토 QA',p_request_id:crypto.randomUUID()}),report=await call(writer.c,'create_content_report',{p_animal_id:null,p_comment_id:comment.id,p_reason:'other',p_detail:'테스트 자료만 처리',p_request_id:crypto.randomUUID()});
 const list=cli(['list']);assert.ok(list.rows.some(r=>r.id===report.id));checks++;
 const args=['resolve','--id',report.id,'--decision','hide','--request',crypto.randomUUID()],resolved=cli(args);assert.equal(resolved.action,'hide');assert.deepEqual(cli(args),resolved);assert.equal((await call(writer.c,'my_comment',{p_comment_id:comment.id})).status,'hidden');checks++;
 assert.throws(()=>cli(['resolve','--id',report.id,'--decision','dismiss','--request',crypto.randomUUID()]));assert.throws(()=>cli(['prune','--actor','not-a-uuid']));checks++;
 localQuery(`update public.comments set body=null,status='deleted',deleted_at=now()-interval '8 days' where id='${comment.id}';update private.content_reports set resolved_at=now()-interval '91 days' where id='${report.id}';update private.action_buckets set expires_at=now()-interval '1 second' where actor_id='${writer.id}';`);
 const clean=cli(['prune','--actor',writer.id]);assert.equal(clean.comments,1);assert.equal(localQuery(`select count(*) from public.comments where id='${comment.id}'`).trim(),'0');checks++;
 const expired=crypto.randomUUID();localQuery(`insert into public.comments(id,profile_id,animal_id,author_id,body,status,deleted_at) values('${expired}','${owner.id}','${target.id}','${writer.id}',null,'deleted',now()-interval '8 days')`);
 const configured=JSON.parse(localQuery("select json_build_object('active',active,'schedule',schedule,'command',command) from cron.job where jobname='reptilelink-activity-retention'").trim());assert.equal(configured.active,true);assert.equal(configured.schedule,'17 * * * *');assert.ok(configured.command.includes('private.prune_activity()'));assert.equal(localQuery("select has_schema_privilege('anon','cron','usage') or has_schema_privilege('authenticated','cron','usage')").trim(),'f');checks++;
 jobId=Number(localQuery(`select cron.schedule('${jobName}','1 second','select private.prune_activity(''${writer.id}''::uuid);')`).trim());assert.ok(Number.isInteger(jobId));let succeeded=false;
 for(let i=0;i<30;i++){const status=localQuery(`select status from cron.job_run_details where jobid=${jobId} order by runid desc limit 1`).trim();if(status==='succeeded'){succeeded=true;break;}if(status==='failed')throw new Error('Scoped Cron QA job failed.');await new Promise(resolve=>setTimeout(resolve,500));}
 assert.equal(succeeded,true);assert.equal(localQuery(`select count(*) from public.comments where id='${expired}'`).trim(),'0');assert.equal((await call(owner.c,'my_dashboard')).account_status,'active');checks++;
 console.log(`Passed ${checks} activity operations checks: real service-only CLI list/resolve/replay/conflict/scoped prune and actual pg_cron execution against only this run's disposable actor.`);
}finally{
 if(jobId!==null){localQuery(`select cron.unschedule(${jobId});delete from cron.job_run_details where jobid=${jobId};`);}
 await finishAccount(writer);await finishAccount(owner);
}
