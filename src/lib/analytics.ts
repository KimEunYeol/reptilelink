const sessionKey='reptilelink-view-session-v1';
let memorySession:string|undefined;
const cache=new Map<string,number>(),pending=new Map<string,Promise<void>>();
const validSession=(value:string|null)=>value!==null&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function tabSession(){if(memorySession)return memorySession;let stored:string|null=null;try{stored=sessionStorage.getItem(sessionKey);}catch{/* Storage is optional. */}memorySession=validSession(stored)?stored!.toLowerCase():crypto.randomUUID();try{sessionStorage.setItem(sessionKey,memorySession);}catch{/* Keep an ephemeral tab session when storage is disabled. */}return memorySession;}
/** Best-effort, bounded and detached from rendering. No auth token or user draft. */
export async function recordPageView(slug:string){
 try{
  if((cache.get(slug)??0)>performance.now())return;
  const existing=pending.get(slug);if(existing)return existing;
  const session=tabSession(),started=performance.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2500);
  const run=(async()=>{let until=performance.now()+60000;try{const response=await fetch('/api/analytics/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,session}),signal:controller.signal,keepalive:true});if(response.ok){const data=await response.json()as{accepted:boolean;seconds_until_next_day?:number};if(data.accepted&&Number.isFinite(data.seconds_until_next_day))until=started+Math.max(0,(Math.min(86400,data.seconds_until_next_day!)-2)*1000);}}catch{/* Statistics never block the public page. */}finally{clearTimeout(timer);if(cache.size>=20&&!cache.has(slug))cache.delete(cache.keys().next().value!);cache.set(slug,until);pending.delete(slug);}})();pending.set(slug,run);await run;pending.delete(slug);
 }catch{/* Disabled storage or crypto does not affect the public page. */}
}
export type AnalyticsData={available:boolean;day?:string;started_at?:string;collecting?:boolean;limited?:boolean;today?:number|null;yesterday?:number|null;week?:number;month?:number;total?:number;chart?:{day:string;views:number|null}[]};
