const key='reptilelink-public-return-v1',ttl=10*60*1000;
function storage(){try{return typeof window==='undefined'?null:window.sessionStorage;}catch{return null;}}
export function publicReturnPath(value:unknown):string|null{
 if(typeof value!=='string'||value.length>120)return null;
 return /^\/u\/[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])(?:\/animals\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.test(value)?value:null;
}
export function publicLoginHref(path:string){const safe=publicReturnPath(path);return safe?`/auth/login?returnTo=${encodeURIComponent(safe)}`:'/auth/login';}
export function rememberPublicReturn(value:unknown,now=Date.now(),store:Storage|null=storage()){
 const path=publicReturnPath(value);try{if(path&&Number.isFinite(now))store?.setItem(key,JSON.stringify({path,createdAt:now}));else store?.removeItem(key);}catch{/* A blocked tab store falls back to normal management entry. */}
}
export function pendingPublicReturn(consume=false,now=Date.now(),store:Storage|null=storage()):string|null{
 try{const raw=store?.getItem(key);if(!raw)return null;let result:null|string=null;if(raw.length<=512){const v=JSON.parse(raw);if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===2&&typeof v.createdAt==='number'&&Number.isFinite(v.createdAt)&&Number.isFinite(now)&&now>=v.createdAt&&now-v.createdAt<ttl)result=publicReturnPath(v.path);}if(!result||consume)store?.removeItem(key);return result;}catch{try{store?.removeItem(key);}catch{/* unavailable */}return null;}
}
export function authIssue(search:string,hash:string):'cancelled'|'failed'|null{
 const query=new URLSearchParams(search.startsWith('?')?search.slice(1):search),fragment=new URLSearchParams(hash.startsWith('#')?hash.slice(1):hash);
 for(const p of[query,fragment]){if(p.has('error')||p.has('error_code'))return p.get('error')==='access_denied'?'cancelled':'failed';}return null;
}
export function authIssueText(issue:'cancelled'|'failed'){return issue==='cancelled'?'로그인이 취소됐습니다. 다시 시작할 수 있어요.':'로그인을 완료하지 못했습니다. 다시 시작해주세요.';}
