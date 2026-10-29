import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {localStatus,localQuery,fixturePassword} from './local-utils.mjs';
const s=localStatus(),client=()=>createClient(s.url,s.publishable,{auth:{persistSession:false,autoRefreshToken:false}});
async function login(email){const c=client();assert.ifError((await c.auth.signInWithPassword({email,password:fixturePassword})).error);return c;}
const a=await login('qa-other@reptilelink.test'),b=await login('qa-owner@reptilelink.test'),pending=await login('pending@reptilelink.test'),guest=client();
const platforms=['band','instagram','facebook','youtube','kakao','naver_blog'];
async function call(c,n,p){const r=await c.schema('api').rpc(n,p);assert.ifError(r.error);return r.data;}
const dash=c=>call(c,'my_dashboard'),view=(c=a)=>call(c,'my_social_links'),ad=await dash(a),bd=await dash(b),actor=ad.profile.id,other=bd.profile.id;
assert.equal((await view()).links.length,0);assert.equal((await view(b)).links.length,0);
const oldWrites=localQuery('select writes_enabled from private.project_budget where id=1').trim(),empty=()=>platforms.map(platform=>({platform,url:'',is_public:false})),filled=()=>platforms.map(platform=>({platform,url:`https://example.com/${platform}`,is_public:false}));
const args=async(p_items=empty(),c=a)=>({p_items,p_expected:(await dash(c)).profile.revision,p_request_id:crypto.randomUUID()});
const snapshot=()=>localQuery(`select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(l) order by profile_id,platform) from public.social_links l where profile_id in('${actor}','${other}')),'revisions',(select jsonb_agg(revision order by id) from public.profiles where id in('${actor}','${other}')),'receipts',(select count(*) from private.mutation_receipts where actor_id in('${actor}','${other}')))`);
let checks=0,consent;async function reject(c,p,pattern=/VALIDATION_FAILED/){const before=snapshot(),r=await c.schema('api').rpc('save_social_links',p);assert.ok(r.error);if(pattern)assert.match(r.error.message,pattern);assert.equal(snapshot(),before);checks++;}
try{
 const noOp=await args();assert.equal((await call(a,'save_social_links',noOp)).revision,noOp.p_expected);assert.deepEqual((await view()).links,[]);checks++;
 const original=await args(filled().reverse()),saved=await call(a,'save_social_links',original);assert.equal(saved.revision,original.p_expected+1);assert.deepEqual((await view()).links.map(l=>l.platform),platforms);assert.ok((await view()).links.every(l=>!l.is_public));checks++;
 assert.deepEqual(await call(a,'save_social_links',original),saved);checks++;
 await reject(a,{...original,p_items:empty()},/REQUEST_CONFLICT/);
 for(const items of [null,{},filled().slice(1),[...filled(),filled()[0]],filled().map((r,i)=>i===5?filled()[0]:r),filled().map((r,i)=>i===5?{...r,platform:'tiktok'}:r),filled().map((r,i)=>i===5?{...r,profile_id:other}:r),filled().map((r,i)=>i===5?{...r,is_public:'true'}:r),filled().map((r,i)=>i===5?{...r,url:null}:r),filled().map((r,i)=>i===5?{...r,url:'',is_public:true}:r)])await reject(a,await args(items));
 for(const url of ['http://example.com/','javascript:alert(1)','https://u:p@example.com/','https://example.com/\nfoo','https://example.com\\x','https://999.1.1.1/','https://example.com:65536/','https://example.com/%zz','https://example.com/'+'a'.repeat(2048)])await reject(a,await args(filled().map((r,i)=>i===5?{...r,url}:r)));
 await reject(guest,await args(),null);await reject(pending,await args(),/ACCOUNT_NOT_ACTIVE/);
 assert.ok((await a.from('social_links').insert({profile_id:other,platform:'band',url:'https://example.com/',sort_order:0})).error);assert.ok((await a.from('social_links').select('id')).error);checks++;
 assert.ok((await guest.from('social_links').select('platform,url').eq('profile_id',actor)).error);checks++;
 const otherItems=filled().map(r=>({...r,url:'https://example.org/'+r.platform}));await call(b,'save_social_links',await args(otherItems,b));assert.deepEqual((await view()).links.map(l=>l.url),platforms.map(p=>'https://example.com/'+p));checks++;
 await call(a,'set_profile_public',{p_public:true,p_expected:(await dash(a)).profile.revision});assert.deepEqual((await call(guest,'public_page',{p_slug:ad.profile.slug})).socials,[]);checks++;
 const publicItems=filled().map((r,i)=>({...r,is_public:i<3}));await call(a,'save_social_links',await args(publicItems));const pub=await call(guest,'public_page',{p_slug:ad.profile.slug});assert.deepEqual(pub.socials,publicItems.slice(0,3).map(({platform,url})=>({platform,url})));assert.ok(!JSON.stringify(pub.socials).match(/profile_id|is_public|revision|created_at/));checks++;
 assert.ok((await guest.from('social_links').select('platform,url').eq('profile_id',actor)).error);checks++;
 await call(a,'set_profile_public',{p_public:false,p_expected:(await dash(a)).profile.revision});assert.equal(await call(guest,'public_page',{p_slug:ad.profile.slug}),null);assert.ok((await guest.from('social_links').select('platform').eq('profile_id',actor)).error);checks++;
 await call(a,'set_profile_public',{p_public:true,p_expected:(await dash(a)).profile.revision});
 const suspended=await args(publicItems);localQuery(`update private.account_state set status='suspended' where user_id='${actor}'`);await reject(a,suspended,/ACCOUNT_NOT_ACTIVE/);assert.equal(await call(guest,'public_page',{p_slug:ad.profile.slug}),null);checks++;localQuery(`update private.account_state set status='active' where user_id='${actor}'`);
 consent=JSON.parse(localQuery(`select to_jsonb(c) from private.consents c where user_id='${actor}' and document_kind='terms'`).trim());localQuery(`delete from private.consents where user_id='${actor}' and document_kind='terms'`);await reject(a,await args(),/CONSENT_REQUIRED/);localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${JSON.stringify(consent).replaceAll("'","''")}')`);consent=null;
 await reject(a,{...await args(publicItems),p_expected:null},/VERSION_CONFLICT/);
 const concurrent=await args(publicItems.map(r=>({...r,url:r.url+'/new'}))),raced=await Promise.all([concurrent,{...concurrent,p_request_id:crypto.randomUUID()}].map(x=>a.schema('api').rpc('save_social_links',x)));assert.equal(raced.filter(r=>!r.error).length,1);assert.match(raced.find(r=>r.error).error.message,/VERSION_CONFLICT/);checks++;
 const next=(await view()).links,replay=await args(next.map(r=>({...r,is_public:!r.is_public}))),replayed=await Promise.all([call(a,'save_social_links',replay),call(a,'save_social_links',replay)]);assert.deepEqual(replayed[0],replayed[1]);assert.equal(replayed[0].revision,replay.p_expected+1);checks++;
 localQuery('update private.project_budget set writes_enabled=false where id=1');const current=(await view()).links,reductions=current.map((r,i)=>i===0?{...r,url:'',is_public:false}:{...r,is_public:false});await call(a,'save_social_links',await args(reductions));assert.equal((await view()).links.length,5);assert.ok((await view()).links.every(r=>!r.is_public));assert.deepEqual((await call(guest,'public_page',{p_slug:ad.profile.slug})).socials,[]);checks++;
 await reject(a,await args(reductions.map((r,i)=>i===0?{...r,url:'https://example.com/new'}:r)),/SERVICE_UNAVAILABLE/);await reject(a,await args(reductions.map((r,i)=>i===1?{...r,url:r.url+'/changed'}:r)),/SERVICE_UNAVAILABLE/);await reject(a,await args(reductions.map((r,i)=>i===1?{...r,is_public:true}:r)),/SERVICE_UNAVAILABLE/);
 const deleted=await args();await call(a,'save_social_links',deleted);assert.deepEqual((await view()).links,[]);await call(a,'save_social_links',deleted);checks++;
 localQuery(`update private.mutation_receipts set expires_at=now()-interval '1 second' where actor_id='${actor}' and request_id='${original.p_request_id}'`);await reject(a,original,/REQUEST_EXPIRED/);
 console.log(`Passed ${checks} social-link DB checks: exact six-platform set, HTTPS/fields, ownership/active/consent, atomic apply, fixed order, privacy, pause reductions and receipts/concurrency.`);
}finally{
 localQuery(`update private.account_state set status='active' where user_id='${actor}';update private.project_budget set writes_enabled=${oldWrites==='t'?'true':'false'} where id=1`);
 if(consent)localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${JSON.stringify(consent).replaceAll("'","''")}') on conflict do nothing`);
 // Both dedicated QA accounts were asserted empty before this run; only this run's fixed platform keys were written.
 localQuery(`delete from public.social_links where profile_id in('${actor}','${other}') and platform=any(array['band','instagram','facebook','youtube','kakao','naver_blog'])`);
 await call(a,'set_profile_public',{p_public:ad.profile.is_published,p_expected:(await dash(a)).profile.revision});
}
