import assert from 'node:assert/strict';import{createAccount,finishAccount,call,client}from'./account-qa.mjs';import{localQuery}from'./local-utils.mjs';
const users=[];let checks=0;const old=localQuery('select writes_enabled from private.project_budget where id=1').trim();
const make=async p=>{const x=await createAccount(p);users.push(x);return x;},summary=x=>call(x.c,'my_notification_summary');
async function denied(c,pattern){const r=await c.schema('api').rpc('my_notification_summary');assert.ok(r.error);assert.match(r.error.message,pattern);checks++;}
try{
 const owner=await make(),writer=await make(),other=await make(),pending=await make({active:false,profile:false}),noProfile=await make({profile:false});
 assert.deepEqual(await summary(owner),{unread:0});checks++;
 await denied(client(),/permission denied/);await denied(pending.c,/ACCOUNT_NOT_ACTIVE/);await denied(noProfile.c,/NOT_FOUND/);
 let d=await call(owner.c,'my_dashboard');await call(owner.c,'set_profile_public',{p_public:true,p_expected:d.profile.revision});d=await call(owner.c,'my_dashboard');const a=await call(owner.c,'create_animal',{p_expected:d.profile.revision,p_request_id:crypto.randomUUID(),p_data:{name:'요약 QA',species:'게코',sex:'unknown',morph:'',description:'',listing_status:'not_listed',is_public:true}});
 const comment=await call(writer.c,'create_comment',{p_animal_id:a.id,p_body:'비공개 전달 금지 본문',p_request_id:crypto.randomUUID()});await call(writer.c,'set_profile_like',{p_slug:owner.slug,p_liked:true,p_request_id:crypto.randomUUID()});
 let page=await call(owner.c,'my_notifications');assert.equal(page.unread,2);assert.deepEqual(await summary(owner),{unread:page.unread});checks++;
 assert.deepEqual(await summary(other),{unread:0});assert.ifError((await other.c.auth.updateUser({data:{role:'service_role',id:owner.id}})).error);assert.deepEqual(await summary(other),{unread:0});checks++;
 await call(owner.c,'hide_comment',{p_comment_id:comment.id,p_request_id:crypto.randomUUID()});assert.deepEqual(await summary(owner),{unread:2});assert.deepEqual(Object.keys(await summary(owner)),['unread']);checks++;
 localQuery('update private.project_budget set writes_enabled=false where id=1');await call(owner.c,'read_notifications',{p_ids:[page.rows.find(r=>r.kind==='comment').id],p_request_id:crypto.randomUUID()});assert.deepEqual(await summary(owner),{unread:1});checks++;
 localQuery('update private.project_budget set writes_enabled=true where id=1');await call(writer.c,'set_profile_like',{p_slug:owner.slug,p_liked:false,p_request_id:crypto.randomUUID()});assert.deepEqual(await summary(owner),{unread:0});checks++;
 localQuery(`update private.notifications set read_at=null,created_at=now()-interval '90 days' where recipient_id='${owner.id}'`);assert.deepEqual(await summary(owner),{unread:0});checks++;
 localQuery(`update private.notifications set created_at=now()-interval '89 days 23 hours 59 minutes' where recipient_id='${owner.id}'`);assert.deepEqual(await summary(owner),{unread:1});checks++;
 localQuery(`update private.account_state set status='suspended' where user_id='${owner.id}'`);await denied(owner.c,/ACCOUNT_NOT_ACTIVE/);localQuery(`update private.account_state set status='active' where user_id='${owner.id}'`);
 assert.equal(localQuery("select has_table_privilege('authenticated','private.notifications','select')or has_function_privilege('anon','api.my_notification_summary()','execute')").trim(),'f');checks++;
 await call(owner.c,'request_account_deletion',{p_expected:(await call(owner.c,'my_dashboard')).profile.revision,p_request_id:crypto.randomUUID(),p_confirm:'탈퇴'});await denied(owner.c,/ACCOUNT_NOT_ACTIVE/);
 console.log(`Passed ${checks} notification summary DB checks: minimal own count, real create/read/unlike/hidden/expiry, active/foreign/anonymous denial and paused writes.`);
}finally{localQuery('update private.project_budget set writes_enabled=true where id=1');for(const x of users)await finishAccount(x);localQuery(`update private.project_budget set writes_enabled=${old==='t'?'true':'false'} where id=1`);}
