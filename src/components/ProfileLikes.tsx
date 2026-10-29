import {PolicyRenewalLink} from './PolicyRenewalLink';
import {publicLoginHref} from '../lib/authReturn';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Heart,X} from 'lucide-react';
import {ProfileImage} from './ProfileImage';
import {rpc,supabase} from '../lib/supabase';
import {userMessage,type PublicPage} from '../lib/domain';
import {useUnsavedChanges} from '../lib/useUnsavedChanges';
import {activityTime,definiteActivityFailure} from '../lib/activity';
import {likeError,likeRequestExpired,type LikeCommand,type LikeMembers,type LikeState} from '../lib/likes';

// Mount only while a command is pending. Public animal comments register their
// own router blocker; the parent disables opening them during this command.
function PendingLikeNavigation(){
 const navigation=useUnsavedChanges(true,true);
 return navigation.blocked?<div className="edit-conflict" data-navigation-prompt><p className="notice" role="alert">좋아요 요청 결과를 먼저 확인해주세요.</p><button ref={navigation.stayButton} type="button" className="text-button" onClick={navigation.stay}>계속 확인</button></div>:null;
}

function LikeMemberList({onClose}:{onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[data,setData]=useState<LikeMembers|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),sending=useRef(false),mounted=useRef(true);
 async function load(more=false){if(sending.current)return;sending.current=true;setBusy(true);setError('');try{const cursor=more?data?.next:null,next=await rpc<LikeMembers>('my_profile_likes',cursor?{p_before:cursor.before,p_before_id:cursor.id}:undefined);if(mounted.current)setData(old=>more&&old?{...next,rows:[...old.rows,...next.rows.filter(r=>!old.rows.some(p=>p.id===r.id))]}:next);}catch(e){if(mounted.current)setError(userMessage(e));}finally{sending.current=false;if(mounted.current)setBusy(false);}}
 useEffect(()=>{mounted.current=true;const previous=document.activeElement as HTMLElement|null,element=dialog.current;element?.showModal();void load();return()=>{mounted.current=false;element?.close();previous?.focus();};},[]);
 return <dialog ref={dialog} className="animal-edit" aria-labelledby="like-members-title" onCancel={e=>{e.preventDefault();onClose();}}><header className="animal-edit-heading"><h2 id="like-members-title">좋아요 회원</h2><button type="button" className="icon-button" aria-label="좋아요 회원 닫기" onClick={onClose}><X size={20}/></button></header><div className="animal-edit-body"><section aria-label="좋아요 회원 목록">{data&&<p className="comment-hint">총 {data.total}명 · 공개 프로필만 이름과 주소를 표시합니다.</p>}{data?.rows.map(row=><article key={row.id} className="comment-row"><span className="comment-avatar"><ProfileImage purpose="avatar" asset={row.author.avatar_asset_id}/></span><div className="comment-content"><p>{row.author.slug?<Link className="comment-name" to={`/u/${row.author.slug}`}>{row.author.name}</Link>:<strong className="comment-name">{row.author.name}</strong>}</p><time dateTime={row.created_at}>{activityTime(row.created_at)}</time></div></article>)}{data&&!data.rows.length&&<p className="comment-empty">아직 좋아요가 없습니다.</p>}{data?.next&&<button type="button" className="growth-more" disabled={busy} onClick={()=>void load(true)}>회원 더보기</button>}{busy&&<p role="status" className="comment-hint">불러오고 있습니다.</p>}{error&&<p className="notice" role="alert">{error}<PolicyRenewalLink message={error}/></p>}<button type="button" className="text-button" disabled={busy} onClick={()=>void load()}>회원 목록 새로 확인</button></section></div></dialog>;
}

const ignoreLock=(_value:boolean)=>{};
function useProfileLike(slug:string,onLocked:(value:boolean)=>void=ignoreLock){
 const [state,setState]=useState<LikeState|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loginHint,setLoginHint]=useState(false),[members,setMembers]=useState(false),[pending,setPending]=useState<LikeCommand|null>(null),[expired,setExpired]=useState(false),[identityChanged,setIdentityChanged]=useState(false);
 const pendingRef=useRef<LikeCommand|null>(null),sending=useRef(false),identity=useRef<string|undefined>(undefined),mounted=useRef(true),version=useRef(0);
 function assign(command:LikeCommand|null){pendingRef.current=command;setPending(command);}
 function accept(current:LikeState|null){setState(current);setLoaded(true);}
 async function read():Promise<LikeState|null>{const current=await rpc<LikeState|null>('public_profile_likes',{p_slug:slug});if(current)return {...current,available:true};const own=await rpc<{liked:boolean;can_cancel:boolean;signed_in:boolean}>('my_existing_profile_like',{p_slug:slug});return own.liked?{count:null,liked:true,ready:own.can_cancel,signed_in:own.signed_in,is_owner:false,available:false}:null;}
 async function refresh(){if(sending.current||pendingRef.current)return;sending.current=true;setBusy(true);setError('');const request=++version.current;try{const current=await read();if(mounted.current&&request===version.current)accept(current);}catch(e){if(mounted.current&&request===version.current)setError(userMessage(e));}finally{sending.current=false;if(mounted.current)setBusy(false);}}
 useEffect(()=>{mounted.current=true;void refresh();const listener=supabase.auth.onAuthStateChange((_event,session)=>{const next=session?.user.id??'';if(identity.current!==undefined&&identity.current!==next){setMembers(false);if(pendingRef.current)setIdentityChanged(true);else setTimeout(()=>{if(mounted.current)void refresh();},0);}identity.current=next;});return()=>{mounted.current=false;listener.data.subscription.unsubscribe();};},[slug]);
 useEffect(()=>{onLocked(busy||Boolean(pending));return()=>onLocked(false);},[busy,pending,onLocked]);
 async function run(command:LikeCommand){if(sending.current||identityChanged)return;if(likeRequestExpired(command.started,performance.now(),command.wallStarted,Date.now())){setExpired(true);setNotice('요청 보장 시간이 지났습니다. 재전송하지 않고 최신 상태를 확인해주세요.');return;}sending.current=true;setBusy(true);onLocked(true);assign(command);version.current++;setError('');setNotice('');setLoginHint(false);let acknowledged=false,definite=false;
  try{try{await rpc('set_profile_like',{p_slug:command.slug,p_liked:command.liked,p_request_id:command.id});acknowledged=true;}catch(e){definite=definiteActivityFailure(e);throw e;}accept(await read());assign(null);setExpired(false);setNotice('현재 좋아요 상태를 확인했습니다.');}
  catch(e){if(definite&&!acknowledged){try{accept(await read());assign(null);}catch{/* Preserve the exact command on an uncertain read. */}}setError(likeError(e)??userMessage(e));}
  finally{sending.current=false;if(mounted.current)setBusy(false);}
 }
 async function inspectExpired(){if(sending.current||identityChanged)return;sending.current=true;setBusy(true);setError('');try{accept(await read());assign(null);setExpired(false);setNotice('이전 요청은 재전송하지 않았습니다. 현재 상태를 확인한 뒤 새로 선택해주세요.');}catch(e){setError(userMessage(e));}finally{sending.current=false;setBusy(false);}}
 function click(){if(!state||busy||pending)return;if(state.is_owner){setMembers(true);return;}if(!state.ready){setLoginHint(true);return;}void run({slug:slug,liked:!state.liked,id:crypto.randomUUID(),started:performance.now(),wallStarted:Date.now()});}
 const label=state?.is_owner?`좋아요 회원 보기 ${state.count}명`:state?.ready?(state.liked?'좋아요 취소':'좋아요 하기'):'좋아요 이용 안내';
 return {state,loaded,busy,error,notice,loginHint,members,setMembers,pending,expired,identityChanged,refresh,run,inspectExpired,click,label};
}

function LikeNotice({control:c}:{control:ReturnType<typeof useProfileLike>}){
 if(!c.pending&&!c.error&&!c.notice&&!c.loginHint&&!c.identityChanged&&!(c.loaded&&(!c.state||c.state.available===false)))return null;
 return <section className="profile-like-status" aria-label="좋아요 상태">
  {c.identityChanged&&<p className="notice" role="alert">로그인 계정이 변경됐습니다. 이전 계정의 요청을 재전송하지 않도록 화면을 새로 열어주세요.</p>}
  {c.loaded&&(!c.state||c.state.available===false)&&<p className="comment-hint">공개 정보를 조회할 수 없습니다. 본인이 남긴 좋아요만 취소할 수 있습니다.</p>}
  {c.loginHint&&<p className="comment-hint">{c.state?.signed_in?<Link to="/onboarding">승인·필수 동의를 확인해주세요</Link>:<Link to={publicLoginHref(window.location.pathname)}>로그인하고 좋아요 누르기</Link>}</p>}
  {c.pending&&<><p className="notice" role="alert">좋아요 요청 결과가 확인될 때까지 이동과 다른 조작이 잠깁니다.</p><button type="button" className="text-button" disabled={c.busy||c.identityChanged} onClick={()=>c.expired?void c.inspectExpired():void c.run(c.pending!)}>{c.expired?'최신 좋아요 상태 확인':'같은 좋아요 요청 확인'}</button><PendingLikeNavigation/></>}
  {c.error&&<p className="notice" role="alert">{c.error}<PolicyRenewalLink message={c.error}/></p>}{c.notice&&<p className="comment-hint" role="status">{c.notice}</p>}
  {!c.pending&&<button type="button" className="text-button" disabled={c.busy} onClick={()=>void c.refresh()}>좋아요 다시 확인</button>}
 </section>;
}

export function ProfileLikes({profile,initialCount,onLocked,children,account}:{children?:ReactNode;account?:ReactNode;profile:PublicPage['profile'];initialCount?:number;onLocked:(value:boolean)=>void}){
 const c=useProfileLike(profile.slug,onLocked);
 return <><div className={`public-cover theme-${profile.theme_token||'green'}`}><ProfileImage purpose="cover" asset={profile.cover_asset_id} publicOnly/>{account}<div className="profile-reactions"><button type="button" className="profile-like-button" aria-label={c.label} aria-pressed={c.state?.ready&&!c.state.is_owner?c.state.liked:undefined} disabled={c.busy||Boolean(c.pending)||!c.state||c.identityChanged} onClick={c.click}><Heart size={22} aria-hidden="true" fill={c.state?.liked?'currentColor':'none'}/><span>{c.state?.count??(c.loaded?'—':initialCount??'…')}</span></button>{children}</div></div><div className="public-avatar"><ProfileImage purpose="avatar" asset={profile.avatar_asset_id} publicOnly/></div><LikeNotice control={c}/>{c.members&&<LikeMemberList onClose={()=>c.setMembers(false)}/>}</>;
}

/** An unavailable page reveals only an action the signed-in caller already owns. */
export function ExistingLikeRemoval({slug}:{slug:string}){
 const c=useProfileLike(slug);
 if(!c.state?.liked&&!c.pending&&!c.notice&&!c.error)return null;
 return <section aria-label="내 좋아요 정리">{c.state?.liked&&<button type="button" className="text-button" disabled={c.busy||Boolean(c.pending)||c.identityChanged||!c.state.ready} onClick={()=>void c.run({slug,liked:false,id:crypto.randomUUID(),started:performance.now(),wallStarted:Date.now()})}>내 좋아요 취소</button>}<LikeNotice control={c}/></section>;
}
