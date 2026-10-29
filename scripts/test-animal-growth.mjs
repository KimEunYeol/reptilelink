import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {localStatus,localQuery,fixturePassword} from './local-utils.mjs';
const s=localStatus(),client=()=>createClient(s.url,s.publishable,{auth:{persistSession:false,autoRefreshToken:false}});
async function login(email){const c=client();assert.ifError((await c.auth.signInWithPassword({email,password:fixturePassword})).error);return c;}
const owner=await login('qa-other@reptilelink.test'),foreign=await login('qa-owner@reptilelink.test'),pending=await login('pending@reptilelink.test'),guest=client();
const initialAnimalDigest=localQuery("select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from public.animals a").trim();
async function call(c,name,args){const r=await c.schema('api').rpc(name,args);assert.ifError(r.error);return r.data;}
const dash=()=>call(owner,'my_dashboard'),initial=await dash(),actor=initial.profile.id,created=[];assert.equal(initial.animals.length,0);
const today=localQuery("select (now() at time zone 'Asia/Seoul')::date").trim();
const day=days=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
let checks=0;
const row=(date=today,weight='34.25')=>({id:crypto.randomUUID(),measured_on:date,weight_g:weight,note:'개별 비공개 메모'});
const data=(upsert=[],remove=[],note='개체 비공개 메모',show_growth=false)=>({upsert,remove,note,show_growth});
const args=async(id,p_data)=>({p_animal_id:id,p_data,p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});
async function create(){const r=await call(owner,'create_animal',{p_data:{name:'성장 QA',species:'게코',is_public:true},p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});created.push(r.id);return r.id;}
const view=(id,period='month',before=null)=>call(owner,'my_animal_growth',{p_animal_id:id,p_period:period,p_before:before});
const pub=(id,period='month',before=null)=>call(guest,'public_animal_growth',{p_animal_id:id,p_period:period,p_before:before});
const snapshot=()=>localQuery(`select jsonb_build_object('records',(select jsonb_agg(to_jsonb(g) order by id) from public.growth_records g where profile_id='${actor}'),'notes',(select jsonb_agg(to_jsonb(n) order by record_id) from private.growth_notes n where profile_id='${actor}'),'animal_notes',(select jsonb_agg(to_jsonb(n) order by animal_id) from private.animal_notes n where profile_id='${actor}'),'animals',(select jsonb_agg(to_jsonb(a) order by id) from public.animals a where profile_id='${actor}'),'revision',(select revision from public.profiles where id='${actor}'),'receipts',(select count(*) from private.mutation_receipts where actor_id='${actor}'))`).trim();
async function reject(c,parameters,pattern){const before=snapshot(),r=await c.schema('api').rpc('save_animal_growth',parameters);assert.ok(r.error,'expected error');if(pattern)assert.match(r.error.message,pattern);assert.equal(snapshot(),before);checks++;}
const oldWrites=localQuery('select writes_enabled from private.project_budget where id=1').trim();
const quote=v=>JSON.stringify(v).replaceAll("'","''");
let consent;
try{
 const id=await create(),other=await create(),r1=row(day(-1),'32'),r2=row();
 const first=await args(id,data([r1,r2])),saved=await call(owner,'save_animal_growth',first);assert.equal(saved.revision,first.p_expected+1);let v=await view(id);assert.equal(v.total,2);assert.equal(v.latest.weight_g,34.25);assert.equal(v.note,'개체 비공개 메모');assert.equal(v.records[0].note,r2.note);checks++;
 assert.deepEqual(await call(owner,'save_animal_growth',first),saved);assert.equal((await dash()).profile.revision,saved.revision);checks++;
 assert.equal(await pub(id),null);assert.ok((await guest.from('growth_records').select('id,measured_on,weight_g')).error);checks++;
 assert.ok((await foreign.from('growth_records').select('id,measured_on,weight_g').eq('animal_id',id)).error);checks++;
 assert.ok((await owner.from('growth_records').insert({id:crypto.randomUUID(),animal_id:id,measured_on:today,weight_g:1})).error);assert.ok((await owner.from('growth_records').select('profile_id')).error);checks++;
 await reject(foreign,await args(id,data()),/NOT_FOUND/);await reject(guest,await args(id,data()),null);await reject(pending,await args(id,data()),/ACCOUNT_NOT_ACTIVE/);
 for(const patch of [{weight_g:'0'},{weight_g:'-1'},{weight_g:'100000.01'},{weight_g:'3.001'},{weight_g:3},{weight_g:'NaN'},{weight_g:'1e2'},{measured_on:day(1)},{measured_on:'2024-02-30'},{measured_on:'0000-01-01'},{note:'a'.repeat(1001)},{extra:true}])await reject(owner,await args(id,data([{...row(day(-2)),...patch}])),/VALIDATION_FAILED/);
 await reject(owner,await args(id,data([row(today)])),/VALIDATION_FAILED/);
 await reject(owner,await args(id,{...data(),note:'a'.repeat(2001)}),/VALIDATION_FAILED/);
 await reject(owner,await args(id,{...data(),show_growth:'true'}),/VALIDATION_FAILED/);
 await reject(owner,await args(id,{...data(),extra:true}),/VALIDATION_FAILED/);
 await reject(owner,{...await args(id,data()),p_expected:null},/VERSION_CONFLICT/);
 await reject(owner,{...first,p_data:data()},/REQUEST_CONFLICT/);
 const otherRow=row(day(-2));await call(owner,'save_animal_growth',await args(other,data([otherRow])));
 await reject(owner,await args(id,data([otherRow])),/NOT_FOUND/);await reject(owner,await args(id,data([],[otherRow.id])),/NOT_FOUND/);
 await reject(owner,await args(id,data([r1],[r1.id])),/VALIDATION_FAILED/);
 await call(owner,'save_animal_growth',await args(id,data([{...r1,measured_on:today},{...r2,measured_on:day(-1)}])));assert.equal((await view(id)).records[0].id,r1.id);checks++;
 const race=await args(id,data([{...r1,measured_on:today,weight_g:'40'}]));const concurrent=await Promise.all([call(owner,'save_animal_growth',race),call(owner,'save_animal_growth',race)]);assert.deepEqual(concurrent[0],concurrent[1]);assert.equal(concurrent[0].revision,race.p_expected+1);checks++;
 const race2=await args(id,data([{...r1,measured_on:today,weight_g:'41'}]));const rr=await Promise.all([race2,{...race2,p_request_id:crypto.randomUUID()}].map(p=>owner.schema('api').rpc('save_animal_growth',p)));assert.equal(rr.filter(r=>!r.error).length,1);assert.match(rr.find(r=>r.error).error.message,/VERSION_CONFLICT/);checks++;
 consent=JSON.parse(localQuery(`select to_jsonb(c) from private.consents c where user_id='${actor}' and document_kind='terms'`).trim());localQuery(`delete from private.consents where user_id='${actor}' and document_kind='terms'`);await reject(owner,await args(id,data()),/CONSENT_REQUIRED/);localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${quote(consent)}')`);consent=null;
 localQuery(`update private.account_state set status='suspended' where user_id='${actor}'`);await reject(owner,{...first,p_request_id:crypto.randomUUID()},/ACCOUNT_NOT_ACTIVE/);localQuery(`update private.account_state set status='active' where user_id='${actor}'`);
 await call(owner,'save_animal_growth',await args(id,data([],[],'개체 비공개 메모',true)));assert.equal(await pub(id),null);checks++;
 await call(owner,'set_profile_public',{p_public:true,p_expected:(await dash()).profile.revision});const visible=await pub(id);assert.equal(visible.records.length,2);assert.ok(!JSON.stringify(visible).match(/note|profile_id|revision|profile_total|개체 비공개|개별 비공개/));checks++;
 await call(owner,'set_animal_public',{p_animal_id:id,p_public:false,p_expected:(await dash()).profile.revision});assert.equal(await pub(id),null);checks++;await call(owner,'set_animal_public',{p_animal_id:id,p_public:true,p_expected:(await dash()).profile.revision});
 localQuery(`update private.account_state set status='suspended' where user_id='${actor}'`);assert.equal(await pub(id),null);checks++;localQuery(`update private.account_state set status='active' where user_id='${actor}'`);
 // Only this execution's animal receives the bulk fixture. Original user records are untouched.
 localQuery(`insert into public.growth_records(id,profile_id,animal_id,measured_on,weight_g) select gen_random_uuid(),'${actor}','${id}',date '${today}'-n,10+n from generate_series(2,2980) n`);
 v=await view(id,'year');assert.equal(v.chart.length,120);assert.equal(v.chart[0].measured_on,day(-364));assert.equal(v.chart.at(-1).measured_on,today);assert.equal(new Set(v.chart.map(r=>r.measured_on)).size,120);checks++;
 assert.equal((await view(id,'week')).chart.length,7);assert.equal((await view(id,'month')).chart.length,30);checks++;
 const next=await view(id,'month',v.next_before);assert.equal(v.records.length,20);assert.equal(next.records.length,20);assert.ok(next.records.every(r=>r.measured_on<v.next_before));checks++;
 assert.equal((await pub(id,'year')).chart.length,120);assert.equal((await pub(id,'month',v.next_before)).records.length,20);checks++;
 localQuery(`insert into public.growth_records(id,profile_id,animal_id,measured_on,weight_g) select gen_random_uuid(),'${actor}','${id}',date '${today}'-n,1 from generate_series(2981,2998) n`);
 assert.equal((await view(id)).profile_total,3000);await reject(owner,await args(id,data([row(day(-2999))])),/QUOTA_EXCEEDED/);
 const r=await view(id);localQuery('update private.project_budget set writes_enabled=false where id=1');await reject(owner,await args(id,data([row(day(-2999))],[],'개체 비공개 메모',true)),/SERVICE_UNAVAILABLE/);
 await call(owner,'save_animal_growth',await args(id,data([],[r.records[0].id],'',false)));assert.equal((await view(id)).profile_total,2999);assert.equal(await pub(id),null);assert.equal((await view(id)).note,'');checks++;localQuery('update private.project_budget set writes_enabled=true where id=1');
 await call(owner,'save_animal_growth',await args(id,data([row(day(-2999))])));assert.equal((await view(id)).profile_total,3000);checks++;
 localQuery(`update private.mutation_receipts set expires_at=now()-interval '1 second' where actor_id='${actor}' and request_id='${first.p_request_id}'`);await reject(owner,first,/REQUEST_EXPIRED/);
 assert.ok((await owner.schema('api').rpc('my_animal_growth',{p_animal_id:id,p_period:'all'})).error);checks++;
 await call(owner,'delete_animal',{p_animal_id:id,p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()});assert.equal(await pub(id),null);assert.match((await owner.schema('api').rpc('my_animal_growth',{p_animal_id:id})).error.message,/NOT_FOUND/);await reject(owner,await args(id,data()),/NOT_FOUND/);checks++;
 localQuery(`delete from public.animals where id='${id}' and profile_id='${actor}'`);assert.equal(localQuery(`select count(*) from public.growth_records where animal_id='${id}'`).trim(),'0');assert.equal(localQuery(`select count(*) from private.growth_notes where profile_id='${actor}' and record_id in('${r1.id}','${r2.id}')`).trim(),'0');checks++;
 console.log(`Passed ${checks} growth DB checks: strict dates/decimals, ownership/privacy, opt-in, atomic quota/receipts/concurrency, real-date sampling/pagination and deletion cascade.`);
}finally{
 localQuery(`update private.account_state set status='active' where user_id='${actor}';update private.project_budget set writes_enabled=${oldWrites==='t'?'true':'false'} where id=1`);
 if(consent)localQuery(`insert into private.consents select * from jsonb_populate_record(null::private.consents,'${quote(consent)}') on conflict do nothing`);
 for(const id of created)localQuery(`delete from public.animals where id='${id}' and profile_id='${actor}'`);
 await call(owner,'set_profile_public',{p_public:initial.profile.is_published,p_expected:(await dash()).profile.revision});
 const p={before:initialAnimalDigest,after:localQuery("select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from public.animals a").trim()};assert.equal(p.after,p.before);mkdirSync('.local',{recursive:true});writeFileSync('.local/growth-test-preservation.json',JSON.stringify(p)+'\n');
}
