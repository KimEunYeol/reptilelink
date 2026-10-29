import assert from 'node:assert/strict';
import {createAccount,finishAccount,call,client} from './account-qa.mjs';
import {localQuery} from './local-utils.mjs';
let checks=0;function ok(v){assert.ok(v);checks++;}function eq(a,b){assert.deepEqual(a,b);checks++;}
async function denied(c,name,args,code){const r=await c.schema('api').rpc(name,args);assert.match(r.error?.message||'',new RegExp(code));checks++;}
const a=await createAccount(),b=await createAccount(),fresh=await createAccount({profile:false}),pending=await createAccount({active:false,profile:false});
try{
 const anon=client(),context=await call(anon,'policy_context');eq(context.mode,'preview');eq(context.version,'local-preview-v1');eq(context.accepted,false);ok(context.terms.includes('미리보기'));ok(context.privacy.includes('테스트'));
 eq(Object.keys(context).sort(),['accepted','digest','mode','privacy','terms','version']);
 const before=localQuery(`select json_agg(json_build_array(document_kind,document_version,accepted_at)order by document_kind)from private.consents where user_id='${a.id}'`).trim();
 eq((await call(a.c,'policy_context')).accepted,true);eq((await call(a.c,'my_dashboard')).policy.accepted,true);
 const args={p_version:context.version,p_digest:context.digest,p_terms:true,p_privacy:true};
 await denied(anon,'accept_required_policy',args,'permission denied');await denied(pending.c,'accept_required_policy',args,'ACCOUNT_NOT_ACTIVE');
 await denied(a.c,'accept_required_policy',{...args,p_version:'other-version'},'POLICY_CHANGED');await denied(a.c,'accept_required_policy',{...args,p_digest:'0'.repeat(64)},'POLICY_CHANGED');await denied(a.c,'accept_required_policy',{...args,p_terms:false},'CONSENT_REQUIRED');await denied(a.c,'accept_required_policy',{...args,p_privacy:null},'CONSENT_REQUIRED');
 await call(a.c,'accept_required_policy',args);await call(a.c,'accept_required_policy',args);eq(localQuery(`select json_agg(json_build_array(document_kind,document_version,accepted_at)order by document_kind)from private.consents where user_id='${a.id}'`).trim(),before);
 localQuery(`delete from private.consents where user_id='${a.id}'`);eq((await call(a.c,'my_dashboard')).policy.accepted,false);eq((await call(b.c,'my_dashboard')).policy.accepted,true);
 const d=await call(a.c,'my_dashboard');await denied(a.c,'save_profile',{p_slug:a.slug,p_name:'동의 빠진 프로필',p_bio:'',p_expected:d.profile.revision,p_publish:false,p_accept_terms:true},'CONSENT_REQUIRED');
 await denied(a.c,'create_animal',{p_data:{name:'동의 없이 생성',species:'게코',morph:'',sex:'unknown',description:'',listing_status:'not_listed',is_public:false},p_expected:d.profile.revision,p_request_id:crypto.randomUUID()},'CONSENT_REQUIRED');
 await call(a.c,'accept_required_policy',args);eq((await call(a.c,'my_dashboard')).policy.accepted,true);eq(localQuery(`select count(*)from private.consents where user_id='${a.id}'`).trim(),'2');
 await call(fresh.c,'accept_required_policy',args);await call(fresh.c,'save_profile',{p_slug:fresh.slug,p_name:'명시적 확인',p_bio:'',p_expected:0,p_publish:false,p_accept_terms:false});ok((await call(fresh.c,'my_dashboard')).profile);
 // Actual version/mode changes run wholly inside a rolled-back SQL transaction: no operating document is published.
 const sql=`begin;set local request.jwt.claim.sub='${a.id}';
 insert into private.policy_versions(version,terms_body,privacy_body,is_preview)values('local-preview-policy-qa','두번째 개발 안내','두번째 개발 개인정보 안내',true);
 update private.policy_settings set required_version='local-preview-policy-qa' where id=1;
 do $$declare v private.policy_versions;status jsonb;begin
 if private.has_required_consents('${a.id}') then raise exception 'old version wrongly accepted';end if;
 begin perform api.accept_required_policy('local-preview-v1','${context.digest}',true,true);raise exception 'expected changed';exception when others then if sqlerrm<>'POLICY_CHANGED' then raise;end if;end;
 select * into v from private.policy_versions where version='local-preview-policy-qa';
 perform api.accept_required_policy(v.version,v.digest,true,true);
 if not private.has_required_consents('${a.id}') then raise exception 'new consent not recorded';end if;
 begin update private.policy_versions set terms_body='교체' where version=v.version;raise exception 'expected immutable';exception when others then if sqlerrm<>'POLICY_VERSION_IMMUTABLE' then raise;end if;end;
 begin delete from private.policy_versions where version=v.version;raise exception 'expected immutable';exception when others then if sqlerrm<>'POLICY_VERSION_IMMUTABLE' then raise;end if;end;
 begin update private.policy_settings set mode='published' where id=1;raise exception 'expected mismatch';exception when others then if sqlerrm<>'POLICY_MODE_MISMATCH' then raise;end if;end;
 update private.policy_settings set mode='unconfigured' where id=1;
 begin perform api.accept_required_policy(v.version,v.digest,true,true);raise exception 'expected not ready';exception when others then if sqlerrm<>'POLICY_NOT_READY' then raise;end if;end;
 if private.has_required_consents('${a.id}') then raise exception 'unready accepted';end if;
 if api.policy_context()?'terms' then raise exception 'unready body exposed';end if;
 -- Exercise the configured-document branch only inside this transaction, then roll everything back.
 insert into private.policy_versions(version,terms_body,privacy_body,is_preview)values('policy-qa-transaction','검사용 본문','검사용 개인정보 본문',false);
 update private.policy_settings set mode='published',required_version='policy-qa-transaction' where id=1;
 update private.account_state set status='active' where user_id='${pending.id}';
 perform set_config('request.jwt.claim.sub','${pending.id}',true);
 begin perform api.save_profile('${pending.slug}','검사 프로필','',0,false,true);raise exception 'legacy boolean unexpectedly accepted a configured document';exception when others then if sqlerrm<>'CONSENT_REQUIRED' then raise;end if;end;
 select * into v from private.policy_versions where version='policy-qa-transaction';
 perform api.accept_required_policy(v.version,v.digest,true,true);
 if not private.has_required_consents('${pending.id}') then raise exception 'explicit configured acknowledgement missing';end if;
 perform api.save_profile('${pending.slug}','검사 프로필','',0,false,false);
 if not exists(select 1 from public.profiles where id='${pending.id}')then raise exception 'explicit configured acknowledgement did not permit onboarding';end if;
 end$$;rollback;`;
 localQuery(sql);checks+=11;
 eq((await call(pending.c,'my_dashboard')).account_status,'pending');eq((await call(a.c,'policy_context')).version,'local-preview-v1');eq(localQuery("select count(*)from private.policy_versions where version in('local-preview-policy-qa','policy-qa-transaction')").trim(),'0');
 for(const role of['anon','authenticated','service_role'])for(const table of['policy_settings','policy_versions']){eq(localQuery(`select has_table_privilege('${role}','private.${table}','select,insert,update,delete')`).trim(),'f');}
 eq(localQuery("select count(*)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in('policy_settings','policy_versions')and c.relrowsecurity").trim(),'2');
 // Cleanup remains possible without current consent, even when no policy is ready.
 localQuery(`delete from private.consents where user_id='${fresh.id}'`);await finishAccount(fresh);ok(!(await call(a.c,'my_dashboard')).account_deletion);
 console.log(`Policy version/acknowledgement: ${checks} checks passed.`);
}finally{for(const x of[pending,fresh,b,a])await finishAccount(x);}
