import {useEffect,useRef,useState} from 'react';
import {rpc} from '../lib/supabase';
import {userMessage} from '../lib/domain';
import {commandMessage,definitiveLinkError,httpsUrl} from '../lib/links';
import {fullSocials,socialInputSchema,socialNames,socialPlatforms,type PublicSocial,type SocialItem,type SocialSnapshot} from '../lib/socials';
import {useUnsavedChanges} from '../lib/useUnsavedChanges';

export function PublicSocials({links}:{links:PublicSocial[]}){
 const rows=socialPlatforms.flatMap(platform=>{const r=links.find(x=>x.platform===platform);return r&&httpsUrl(r.url)?[r]:[];});
 return rows.length>0?<section className="public-socials" aria-label="공개 SNS">{rows.map(r=><a key={r.platform} href={httpsUrl(r.url)!} target="_blank" rel="noopener noreferrer" aria-label={`${socialNames[r.platform]} 바로가기`}><img src={`/brand/social/${r.platform}.png`} width="40" height="40" alt=""/></a>)}</section>:null;
}

type Command={p_items:SocialItem[];p_expected:number;p_request_id:string};
export function SocialLinks({revision,refreshDashboard,onLocked}:{revision:number;refreshDashboard:()=>Promise<unknown>;onLocked:(value:boolean)=>void}){
 const [snapshot,setSnapshot]=useState<SocialSnapshot|null>(null),[draft,setDraft]=useState<SocialItem[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[unresolved,setUnresolved]=useState(false),[conflict,setConflict]=useState(false),[latest,setLatest]=useState<SocialSnapshot|null>(null);
 const submitting=useRef(false),pending=useRef<Command|null>(null),serial=useRef(0),blockRead=useRef(false),state=useRef<SocialSnapshot|null>(null);
 const dirty=Boolean(snapshot&&JSON.stringify(draft)!==JSON.stringify(fullSocials(snapshot.links))),locked=dirty||busy||unresolved||conflict;
 state.current=snapshot;blockRead.current=locked;const navigation=useUnsavedChanges(locked,busy);
 function accept(v:SocialSnapshot){setSnapshot(v);setDraft(fullSocials(v.links));setLatest(null);setConflict(false);setUnresolved(false);setLoading(false);pending.current=null;}
 useEffect(()=>{onLocked(locked);return()=>onLocked(false);},[locked,onLocked]);
 useEffect(()=>{if(submitting.current||blockRead.current||state.current?.revision===revision)return;const request=++serial.current;setLoading(true);rpc<SocialSnapshot>('my_social_links').then(v=>{if(request!==serial.current)return;if(blockRead.current){setConflict(true);setError('다른 화면에서 변경됐습니다. 최신 SNS를 확인해주세요.');return;}accept(v);}).catch(reason=>{if(request===serial.current)setError(userMessage(reason));}).finally(()=>{if(request===serial.current)setLoading(false);});return()=>{serial.current++;};},[revision]);
 async function fresh(){serial.current++;await refreshDashboard();return rpc<SocialSnapshot>('my_social_links');}
 async function settle(){if(!pending.current)return;try{await rpc('save_social_links',pending.current);}catch(reason){if(!definitiveLinkError(reason))throw reason;pending.current=null;}}
 async function reload(){if(submitting.current)return;submitting.current=true;setLoading(true);setError('');try{accept(await fresh());}catch(reason){setError(userMessage(reason));}finally{submitting.current=false;setLoading(false);}}
 async function cancel(){if(submitting.current)return false;submitting.current=true;setBusy(true);try{if(unresolved||conflict){await settle();accept(await fresh());}else if(snapshot)accept(snapshot);setError('');setSaved(false);return true;}catch(reason){setError(`실제 저장 상태를 확인하지 못했습니다. ${userMessage(reason)}`);return false;}finally{submitting.current=false;setBusy(false);}}
 async function save(){if(submitting.current||!snapshot||conflict||(!dirty&&!unresolved))return;
  if(!pending.current){const parsed=socialInputSchema.safeParse(draft);if(!parsed.success){setError(parsed.error.issues[0]?.message??'SNS 주소를 확인해주세요.');return;}pending.current={p_items:parsed.data,p_expected:snapshot.revision,p_request_id:crypto.randomUUID()};}
  submitting.current=true;setBusy(true);setUnresolved(true);setError('');setSaved(false);
  try{await rpc('save_social_links',pending.current);accept(await fresh());setSaved(true);}catch(reason){if(definitiveLinkError(reason)){pending.current=null;setUnresolved(false);if(/VERSION_CONFLICT|NOT_FOUND/.test(commandMessage(reason)))setConflict(true);}setError(userMessage(reason));}finally{submitting.current=false;setBusy(false);}
 }
 async function inspect(){if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try{await settle();const v=await fresh();pending.current=null;setUnresolved(false);setLatest(v);setConflict(true);}catch(reason){setError(userMessage(reason));}finally{submitting.current=false;setBusy(false);}}
 function change(index:number,patch:Partial<SocialItem>){setDraft(rows=>rows.map((r,i)=>i===index?{...r,...patch}:r));setSaved(false);setError('');}
 return <section className="social-manager" aria-label="SNS 관리">
  {loading&&<p role="status" className="edit-photo-hint">SNS를 불러오고 있습니다.</p>}
  {snapshot&&<form onSubmit={e=>{e.preventDefault();void save();}}><div className="social-fields"><span className="social-section-label">SNS</span><fieldset disabled={busy||loading||unresolved||conflict}><legend className="sr-only">SNS 주소와 공개 설정</legend>{draft.map((r,i)=><div className="social-row" key={r.platform}><div><label htmlFor={`social-${r.platform}`}>{socialNames[r.platform]}</label><button className="link-switch" type="button" role="switch" aria-label={`${socialNames[r.platform]} 공개`} aria-checked={r.is_public} onClick={()=>change(i,{is_public:!r.is_public})}><span/></button></div><input id={`social-${r.platform}`} aria-label={`${socialNames[r.platform]} 주소`} type="url" placeholder="https://" value={r.url} onChange={e=>change(i,{url:e.target.value})}/></div>)}</fieldset></div>
  {error&&<p className="notice" role="alert">{error}</p>}{unresolved&&<p className="edit-photo-hint">저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 적용하거나 취소해주세요.</p>}
  {(unresolved||conflict)&&<button type="button" className="text-button" disabled={busy} onClick={()=>void inspect()}>최신 SNS 확인</button>}
  {latest&&<section className="edit-conflict" aria-label="최신 SNS 내용"><ul>{fullSocials(latest.links).map(r=><li key={r.platform}>{socialNames[r.platform]} · {r.url||'주소 없음'} · {r.is_public?'공개':'비공개'}</li>)}</ul><button type="button" className="text-button" onClick={()=>void navigator.clipboard.writeText(draft.map(r=>`${socialNames[r.platform]}: ${r.url}`).join('\n')).catch(()=>setError('입력 내용을 직접 복사해주세요.'))}>입력 복사</button><button type="button" className="text-button" onClick={()=>{accept(latest);setError('최신 SNS를 불러왔습니다. 변경할 내용을 다시 확인해주세요.');}}>최신 SNS 사용</button></section>}
  {navigation.blocked&&<div data-navigation-prompt><p className="notice" role="alert">적용하지 않은 SNS 변경이 있습니다.</p><button ref={navigation.stayButton} type="button" className="text-button" onClick={navigation.stay}>계속 수정</button><button type="button" className="text-button" disabled={busy} onClick={async()=>{if(await cancel())navigation.leave();}}>변경 버리고 이동</button></div>}
  <div className="social-apply"><button className="button" disabled={busy||loading||conflict||(!dirty&&!unresolved)}>적용하기</button>{locked&&<button type="button" className="text-button" disabled={busy} onClick={()=>void cancel()}>변경 취소</button>}{saved&&<p role="status" className="success">SNS를 적용했어요.</p>}</div></form>}
  {!snapshot&&!loading&&<><p role="alert" className="notice">{error||'SNS를 불러오지 못했습니다.'}</p><button type="button" className="text-button" onClick={()=>void reload()}>다시 불러오기</button></>}
 </section>;
}
