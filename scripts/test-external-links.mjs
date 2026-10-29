import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {localStatus,localQuery,fixturePassword} from './local-utils.mjs';
const s=localStatus(),client=()=>createClient(s.url,s.publishable,{auth:{persistSession:false,autoRefreshToken:false}});
async function login(email){const c=client();assert.ifError((await c.auth.signInWithPassword({email,password:fixturePassword})).error);return c;}
const a=await login('qa-other@reptilelink.test'),b=await login('qa-owner@reptilelink.test'),pending=await login('pending@reptilelink.test'),guest=client();
async function call(c,name,args){const r=await c.schema('api').rpc(name,args);assert.ifError(r.error);return r.data;}
const dash=c=>call(c,'my_dashboard'),view=(c=a)=>call(c,'my_external_links'),ad=await dash(a),bd=await dash(b),actor=ad.profile.id,other=bd.profile.id,created=[];
assert.equal((await view()).links.length,0);assert.equal((await view(b)).links.length,0);
let checks=0,consent;
const quote=v=>JSON.stringify(v).replaceAll("'","''");
const oldWrites=localQuery('select writes_enabled from private.project_budget where id=1').trim();
const item=(title='링크 QA',url='https://example.com/',color_token='green')=>({title,url,color_token});
const saveArgs=async(p_data=item(),p_link_id=null,c=a)=>({p_link_id,p_data,p_expected:(await dash(c)).profile.revision,p_request_id:crypto.randomUUID()});
const applyArgs=async(p_items,p_remove=[])=>({p_items:p_items??(await view()).links.map(({id,is_public})=>({id,is_public})),p_remove,p_expected:(await dash(a)).profile.revision,p_request_id:crypto.randomUUID()});
const snapshot=()=>localQuery(`select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(l) order by id) from public.external_links l where profile_id in('${actor}','${other}')),'revision',(select revision from public.profiles where id='${actor}'),'receipts',(select count(*) from private.mutation_receipts where actor_id='${actor}'))`).trim();
async function rejects(c,name,args,pattern=/VALIDATION_FAILED/){const before=snapshot(),r=await c.schema('api').rpc(name,args);assert.ok(r.error);if(pattern)assert.match(r.error.message,pattern);assert.equal(snapshot(),before);checks++;}
async function create(c=a,data=item()){const args=await saveArgs(data,null,c),r=await call(c,'save_external_link',args);created.push(r.id);return r;}
try{
 for(const url of ['https://example.com/','https://example.com:8443/a?x=%20#ok','https://localhost/','https://[::1]:443/','https://127.0.0.1:0/','https://xn--bcher-kva.example/']){assert.equal(localQuery(`select private.valid_https_url('${url}')`).trim(),'t');checks++;}
 for(const url of ['http://example.com/','javascript:alert(1)','data:text/plain,x','https://u:p@example.com/','https://@example.com/','https://example.com\\path','https://example.com/\nfoo','https://:443/','https://example.com:65536/','https://999.1.1.1/','https://a.123/','https://example..com/','https://example.com/%zz','https://[]/','https://[gg::]/']){await rejects(a,'save_external_link',await saveArgs(item('주소 검사',url)));}
 const firstArgs=await saveArgs(item('\uFEFF  '+ '🦎'.repeat(40)+' \uFEFF')),first=await call(a,'save_external_link',firstArgs);created.push(first.id);const original=(await view()).links[0];assert.equal(original.title,'🦎'.repeat(40));assert.equal(original.is_public,false);assert.equal(first.revision,firstArgs.p_expected+1);checks++;
 assert.deepEqual(await call(a,'save_external_link',firstArgs),first);assert.equal((await view()).links.length,1);checks++;
 await rejects(a,'save_external_link',{...firstArgs,p_data:item('다른 본문')},/REQUEST_CONFLICT/);
 for(const data of [item(' '),item('🦎'.repeat(41)),item('색상','https://example.com/','custom'),{...item(),extra:true},{...item(),is_public:true},{...item(),title:42},item('주소','https://example.com/'+'a'.repeat(2048))])await rejects(a,'save_external_link',await saveArgs(data));
 const peer=await create(b);await rejects(a,'save_external_link',await saveArgs(item(),peer.id),/NOT_FOUND/);await rejects(b,'save_external_link',{...await saveArgs(item(),first.id),p_expected:(await dash(b)).profile.revision},/NOT_FOUND/);
 await rejects(guest,'save_external_link',await saveArgs(),null);await rejects(pending,'save_external_link',await saveArgs(),/ACCOUNT_NOT_ACTIVE/);
 assert.ok((await a.from('external_links').insert({profile_id:actor,...item(),sort_order:5})).error);assert.equal((await guest.from('external_links').select('id').eq('id',first.id)).data.length,0);checks++;
 const edit=await saveArgs(item('변경된 링크','https://example.org/path?q=%22','blue'),first.id);await call(a,'save_external_link',edit);assert.equal((await view()).links[0].is_public,false);assert.equal((await view()).links[0].url,'https://example.org/path?q=%22');checks++;
 await call(a,'set_profile_public',{p_public:true,p_expected:(await dash(a)).profile.revision});assert.equal((await call(guest,'public_page',{p_slug:ad.profile.slug})).links.length,0);checks++;
 const second=await create(),third=await create();const published=[third.id,first.id,second.id].map(id=>({id,is_public:true}));const applied=await applyArgs(published),result=await call(a,'apply_external_links',applied);assert.equal(result.revision,applied.p_expected+1);assert.deepEqual((await view()).links.map(r=>r.id),published.map(r=>r.id));checks++;
 assert.deepEqual(await call(a,'apply_external_links',applied),result);checks++;
 const pub=await call(guest,'public_page',{p_slug:ad.profile.slug});assert.deepEqual(pub.links.map(r=>r.id),published.map(r=>r.id));assert.ok(!JSON.stringify(pub.links).match(/profile_id|created_at|is_public|sort_order|revision/));checks++;
 for(const [items,remove]of [[published.slice(1),[]],[[published[0],published[0],published[1]],[]],[[{id:peer.id,is_public:true},...published.slice(1)],[]],[published,[first.id]],[published,[peer.id]],[[{...published[0],url:'https://evil.example/'},...published.slice(1)],[]]])await rejects(a,'apply_external_links',await applyArgs(items,remove));
 await rejects(a,'apply_external_links',{...await applyArgs(published),p_expected:null},/VERSION_CONFLICT/);
 const race=await saveArgs(item('동시 수정'),first.id),rr=await Promise.all([race,{...race,p_request_id:crypto.randomUUID()}].map(x=>a.schema('api').rpc('save_external_link',x)));assert.equal(rr.filter(r=>!r.error).length,1);assert.match(rr.find(r=>r.error).error.message,/VERSION_CONFLICT/);checks++;
 const replay=await applyArgs(published);const replayed=await Promise.all([call(a,'apply_external_links',replay),call(a,'apply_external_links',replay)]);assert.deepEqual(replayed[0],replayed[1]);checks++;
 consent=JSON.parse(localQuery(`select to_jsonb(c) from private.consents c where user_id='${actor}' and document_kind='terms'`).trim());localQuery(`delete from private.consents where user_id='${actor}' and document_kind='terms'`);await rejects(a,'save_external_link',await saveArgs(),/CONSENT_REQUIRED/);localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${quote(consent)}')`);consent=null;
 const suspendedArgs=await applyArgs(published);localQuery(`update private.account_state set status='suspended' where user_id='${actor}'`);await rejects(a,'apply_external_links',suspendedArgs,/ACCOUNT_NOT_ACTIVE/);assert.equal(await call(guest,'public_page',{p_slug:ad.profile.slug}),null);checks++;localQuery(`update private.account_state set status='active' where user_id='${actor}'`);
 while((await view()).links.length<10)await create();await rejects(a,'save_external_link',await saveArgs(),/QUOTA_EXCEEDED/);
 localQuery('update private.project_budget set writes_enabled=false where id=1');const current=(await view()).links,removed=current[0].id,remaining=current.slice(1).map(({id})=>({id,is_public:false}));await call(a,'apply_external_links',await applyArgs(remaining,[removed]));assert.equal((await view()).links.length,9);assert.equal((await view()).links[0].sort_order,0);assert.equal((await call(guest,'public_page',{p_slug:ad.profile.slug})).links.length,0);checks++;
 await rejects(a,'apply_external_links',await applyArgs([...remaining].reverse()),/SERVICE_UNAVAILABLE/);await rejects(a,'apply_external_links',await applyArgs(remaining.map((r,i)=>({...r,is_public:i===0}))),/SERVICE_UNAVAILABLE/);await rejects(a,'save_external_link',await saveArgs(),/SERVICE_UNAVAILABLE/);
 localQuery('update private.project_budget set writes_enabled=true where id=1');await create();assert.equal((await view()).links.length,10);checks++;
 const removeAll=await applyArgs([],(await view()).links.map(r=>r.id));const gone=await call(a,'apply_external_links',removeAll);assert.equal((await view()).links.length,0);assert.deepEqual(await call(a,'apply_external_links',removeAll),gone);checks++;
 localQuery(`update private.mutation_receipts set expires_at=now()-interval '1 second' where actor_id='${actor}' and request_id='${firstArgs.p_request_id}'`);await rejects(a,'save_external_link',firstArgs,/REQUEST_EXPIRED/);
 console.log(`Passed ${checks} external-link DB checks: URL/field/ownership rules, full-set atomic apply, visibility/delete/reorder, pause reductions, quotas, receipts/concurrency and public DTO isolation.`);
}finally{
 localQuery(`update private.account_state set status='active' where user_id='${actor}';update private.project_budget set writes_enabled=${oldWrites==='t'?'true':'false'} where id=1`);
 if(consent)localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${quote(consent)}') on conflict do nothing`);
 for(const id of created)localQuery(`delete from public.external_links where id='${id}' and profile_id in('${actor}','${other}')`);
 await call(a,'set_profile_public',{p_public:ad.profile.is_published,p_expected:(await dash(a)).profile.revision});
}
