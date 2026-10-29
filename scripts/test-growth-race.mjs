import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {localStatus,localQuery,fixturePassword} from './local-utils.mjs';
const s=localStatus(),client=()=>createClient(s.url,s.publishable,{auth:{persistSession:false,autoRefreshToken:false}});
async function login(email){const c=client();assert.ifError((await c.auth.signInWithPassword({email,password:fixturePassword})).error);return c;}
const a=await login('qa-other@reptilelink.test'),b=await login('qa-owner@reptilelink.test');
async function dash(c){const r=await c.schema('api').rpc('my_dashboard');assert.ifError(r.error);return r.data;}
const ad=await dash(a),bd=await dash(b);assert.equal(ad.animals.length,0);assert.ok(bd.animals.length>0);
const ar=await a.schema('api').rpc('create_animal',{p_data:{name:'성장 ID 경합 QA',species:'게코'},p_expected:ad.profile.revision,p_request_id:crypto.randomUUID()});assert.ifError(ar.error);
const aid=ar.data.id,bid=bd.animals.at(-1).id,record=crypto.randomUUID(),request=crypto.randomUUID(),today=localQuery("select (now() at time zone 'Asia/Seoul')::date").trim();
const original=JSON.parse(localQuery(`select to_jsonb(a) from public.animals a where id='${bid}'`).trim());
const originalNote=JSON.parse(localQuery(`select coalesce((select to_jsonb(n) from private.animal_notes n where animal_id='${bid}'),'null')`).trim());
const originalProfile=JSON.parse(localQuery(`select to_jsonb(p) from public.profiles p where id='${bd.profile.id}'`).trim());
const snapshot=()=>localQuery(`select jsonb_build_object('animal',(select to_jsonb(a) from public.animals a where id='${bid}'),'note',(select to_jsonb(n) from private.animal_notes n where animal_id='${bid}'),'profile',(select to_jsonb(p) from public.profiles p where id='${bd.profile.id}'),'receipt',(select count(*) from private.mutation_receipts where actor_id='${bd.profile.id}' and request_id='${request}'))`).trim();
const before=snapshot(),sql=spawn('docker',['exec','-i','supabase_db_reptilelink','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let committed=false,inFlight;
const ready=new Promise((resolve,reject)=>{let out='';sql.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/ROW_READY:(\d+)/);if(m)resolve(m[1]);});sql.on('error',reject);sql.on('exit',code=>{if(code)reject(new Error('Local race transaction failed'));});});
try{
 sql.stdin.write(`begin;insert into public.growth_records(id,profile_id,animal_id,measured_on,weight_g) values('${record}','${ad.profile.id}','${aid}',date '${today}',10);select 'ROW_READY:'||pg_current_xact_id()::text;\n`);
 const xid=await ready;
 inFlight=b.schema('api').rpc('save_animal_growth',{p_animal_id:bid,p_data:{upsert:[{id:record,measured_on:today,weight_g:'99',note:''}],remove:[],note:'',show_growth:false},p_expected:bd.profile.revision,p_request_id:request}).then(r=>r);
 let blocked=false;for(let i=0;i<80;i++){if(localQuery(`select exists(select 1 from pg_locks where locktype='transactionid' and transactionid='${xid}'::xid and not granted)`).trim()==='t'){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,50));}
 assert.ok(blocked,'Second owner must reach the concurrent unique-ID conflict before first transaction commits');
 sql.stdin.end('commit;\n');committed=true;const result=await inFlight;
 assert.match(result.error?.message??'',/NOT_FOUND/,'Concurrent conflict must recheck the record owner');
 assert.equal(localQuery(`select weight_g from public.growth_records where id='${record}'`).trim(),'10');
 assert.equal(snapshot(),before);
 console.log('Passed 3 cross-owner growth-ID race checks: conflicting request rejected, original record unchanged, second owner state/receipt unchanged.');
}finally{
 if(!committed)sql.stdin.end('rollback;\n');
 if(inFlight)await inFlight;
 // Restore only this run's dedicated QA mutation if the pre-fix regression exposed it.
 const quote=v=>JSON.stringify(v).replaceAll("'","''");
 localQuery(`delete from private.mutation_receipts where actor_id='${bd.profile.id}' and request_id='${request}';update public.animals a set show_growth=r.show_growth,updated_at=r.updated_at from jsonb_populate_record(null::public.animals,'${quote(original)}') r where a.id=r.id;update public.profiles p set revision=r.revision,updated_at=r.updated_at from jsonb_populate_record(null::public.profiles,'${quote(originalProfile)}') r where p.id=r.id;delete from private.animal_notes where animal_id='${bid}' and profile_id='${bd.profile.id}';delete from public.growth_records where id='${record}' and profile_id in('${ad.profile.id}','${bd.profile.id}');delete from public.animals where id='${aid}' and profile_id='${ad.profile.id}'`);
 if(originalNote)localQuery(`insert into private.animal_notes select * from jsonb_populate_record(null::private.animal_notes,'${quote(originalNote)}')`);
}
