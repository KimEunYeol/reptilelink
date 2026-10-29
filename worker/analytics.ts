import type {SupabaseClient} from '@supabase/supabase-js';
export type ViewResult={accepted:boolean;day?:string;seconds_until_next_day?:number};
export async function analyticsDigest(secret:string,profile:string,day:string,session:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(secret??''))throw new Error('CONFIGURATION_REQUIRED');
 const bytes=Uint8Array.from(atob(secret.replace(/-/g,'+').replace(/_/g,'/')+'='),c=>c.charCodeAt(0));
 if(bytes.length!==32)throw new Error('CONFIGURATION_REQUIRED');
 const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`reptilelink-view-v1\0${profile.toLowerCase()}\0${day}\0${session.toLowerCase()}`));
 return Array.from(new Uint8Array(signed),v=>v.toString(16).padStart(2,'0')).join('');
}
/** No raw session, address, agent, path, count or target UUID leaves this boundary. */
export async function collectPageView(admin:SupabaseClient,secret:string,slug:string,session:string):Promise<ViewResult>{
 for(let attempt=0;attempt<2;attempt++){
  const target=await admin.schema('api').rpc('analytics_target',{p_slug:slug});if(target.error)throw new Error('COLLECTION_UNAVAILABLE');if(!target.data)return{accepted:false};
  const {profile_id,day}=target.data as{profile_id:string;day:string};
  const hash=await analyticsDigest(secret,profile_id,day,session);
  const record=await admin.schema('api').rpc('record_page_view',{p_profile_id:profile_id,p_day:day,p_session_hash:hash});
  if(record.error){if(attempt===0&&record.error.message==='DAY_CHANGED')continue;throw new Error('COLLECTION_UNAVAILABLE');}
  const result=record.data as ViewResult;
  return result?.accepted&&typeof result.day==='string'&&Number.isFinite(result.seconds_until_next_day)?{accepted:true,day:result.day,seconds_until_next_day:Math.max(0,Math.min(86400,result.seconds_until_next_day!))}:{accepted:false};
 }
 return{accepted:false};
}
