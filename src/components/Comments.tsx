import {publicLoginHref} from '../lib/authReturn';
import {useEffect,useRef,useState,type FormEvent,type MutableRefObject} from 'react';
import {Link} from 'react-router-dom';
import {X} from 'lucide-react';
import {rpc,supabase} from '../lib/supabase';
import {userMessage} from '../lib/domain';
import {useUnsavedChanges} from '../lib/useUnsavedChanges';
import {ProfileImage} from './ProfileImage';
import {activityError,activityTime,commentText,definiteActivityFailure,reportReasons,reportText,type ActivityContext,type CommentPage,type CommentRow} from '../lib/activity';

type Command={method:string;operation:string;args:Record<string,unknown>};
type Target={id:string;kind:'animal'|'comment'};
export function Comments({animalId,manage=false,closeGuard,onClose,onCount}:{animalId:string;manage?:boolean;closeGuard?:MutableRefObject<(()=>boolean)|null>;onClose?:()=>void;onCount?:(n:number)=>void}){
 const [page,setPage]=useState<CommentPage|null>(null),[context,setContext]=useState<ActivityContext|null>(null),[loaded,setLoaded]=useState(false),[body,setBody]=useState(''),[report,setReport]=useState<Target|null>(null),[reason,setReason]=useState<keyof typeof reportReasons>('spam'),[detail,setDetail]=useState(''),[confirm,setConfirm]=useState<{row:CommentRow;hide:boolean}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<Command|null>(null),[closing,setClosing]=useState(false);
 const submitting=useRef(false),identity=useRef<string|undefined>(undefined),[identityChanged,setIdentityChanged]=useState(false),focus=useRef<HTMLButtonElement>(null);
 const dirty=Boolean(body||report||confirm),locked=dirty||busy||Boolean(pending),navigation=useUnsavedChanges(locked,busy||Boolean(pending));
 const countRef=useRef(onCount);countRef.current=onCount;
 const readMethod=manage?'my_animal_comments':'public_animal_comments';
 async function read(){return rpc<CommentPage|null>(readMethod,{p_animal_id:animalId});}
 function accept(result:CommentPage|null){setPage(result);setLoaded(true);if(!manage)countRef.current?.(result?.total??0);}
 useEffect(()=>{let active=true;setLoaded(false);Promise.all([read(),rpc<ActivityContext>('activity_context')]).then(([result,c])=>{if(active){accept(result);setContext(c);}}).catch(e=>{if(active)setError(userMessage(e));});supabase.auth.getSession().then(({data})=>{if(active)identity.current=data.session?.user.id??'';});const listener=supabase.auth.onAuthStateChange((_event,session)=>{const next=session?.user.id??'';if(identity.current!==undefined&&identity.current!==next&&active)setIdentityChanged(true);});return()=>{active=false;listener.data.subscription.unsubscribe();};},[animalId,manage]);
 useEffect(()=>{if(closing)focus.current?.focus();},[closing]);
 function requestClose(){if(locked){setClosing(true);return false;}return true;}
 useEffect(()=>{if(closeGuard)closeGuard.current=requestClose;return()=>{if(closeGuard)closeGuard.current=null;};});
 async function refresh(){if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try{const [result,c]=await Promise.all([read(),rpc<ActivityContext>('activity_context')]);accept(result);setContext(c);}catch(e){setError(userMessage(e));}finally{submitting.current=false;setBusy(false);}}
 async function run(command:Command){if(submitting.current||identityChanged)return;submitting.current=true;setBusy(true);setError('');setNotice('');setPending(command);let acknowledged=false,definite=false;
  try{
   // Replay the exact command: the server validates the body hash before
   // accepting its receipt, even when the target became private after commit.
   try{await rpc(command.method,command.args);acknowledged=true;}catch(e){definite=definiteActivityFailure(e);throw e;}
   const result=await read();accept(result);setPending(null);setConfirm(null);setClosing(false);
   if(command.operation==='comment_create')setBody('');
   if(command.operation==='report_create'){setReport(null);setDetail('');setReason('spam');setNotice('신고를 접수했습니다. 운영자가 확인합니다.');}
   else setNotice(command.operation==='comment_create'?'댓글을 작성했습니다.':command.operation==='comment_delete'?'댓글을 삭제했습니다.':'댓글을 숨겼습니다.');
  }catch(e){
   if(definite&&!acknowledged){try{accept(await read());setPending(null);}catch{/* Keep the command frozen until the actual state can be read. */}}
   const message=activityError(e);setError(message===String((e as {message?:string})?.message??e)?userMessage(e):message);
  }finally{submitting.current=false;setBusy(false);}
 }
 function create(e:FormEvent){e.preventDefault();try{const value=commentText(body);void run({method:'create_comment',operation:'comment_create',args:{p_animal_id:animalId,p_body:value,p_request_id:crypto.randomUUID()}});}catch(e){setError((e as Error).message);}}
 function sendReport(e:FormEvent){e.preventDefault();if(!report)return;try{void run({method:'create_content_report',operation:'report_create',args:{p_animal_id:report.kind==='animal'?report.id:null,p_comment_id:report.kind==='comment'?report.id:null,p_reason:reason,p_detail:reportText(detail),p_request_id:crypto.randomUUID()}});}catch(e){setError((e as Error).message);}}
 async function more(){if(!page?.next||submitting.current||locked)return;submitting.current=true;setBusy(true);try{const next=await rpc<CommentPage|null>(readMethod,{p_animal_id:animalId,p_before:page.next.before,p_before_id:page.next.id});if(!next)accept(null);else {setPage({...next,rows:[...page.rows,...next.rows.filter(r=>!page.rows.some(old=>old.id===r.id))]});if(!manage)countRef.current?.(next.total??0);}}catch(e){setError(userMessage(e));}finally{submitting.current=false;setBusy(false);}}
 function discard(forNavigation=false){if(busy||pending)return;setBody('');setReport(null);setConfirm(null);setDetail('');setClosing(false);if(forNavigation)navigation.leave();else onClose?.();}
 const disabled=busy||Boolean(pending)||identityChanged,actionsDisabled=disabled||Boolean(body||report||confirm);
 return <section className="comments" aria-label={manage?'개체 댓글 관리':'댓글'}>
  <h3 className="sr-only">{manage?'개체 댓글 관리':'댓글'}</h3>
  {identityChanged&&<p className="notice" role="alert">로그인 계정이 변경됐습니다. 현재 입력을 복사한 뒤 화면을 새로 열어주세요.</p>}
  {loaded&&!page&&<p className="notice">현재 댓글을 조회할 수 없습니다. 공개 상태와 개체 정보를 확인해주세요.</p>}
  {page?.rows.map(row=><article key={row.id} className="comment-row" aria-label={`댓글 ${row.author.name}`}>
   <span className="comment-avatar"><ProfileImage asset={row.author.avatar_asset_id} purpose="avatar"/></span>
   <div className="comment-content"><p>{row.author.slug?<Link to={`/u/${row.author.slug}`} className="comment-name">{row.author.name}</Link>:<strong className="comment-name">{row.author.name}</strong>}{' '}{row.body??'삭제된 댓글입니다.'}</p><time dateTime={row.created_at}>{activityTime(row.created_at)}</time>{manage&&<span className="comment-state">{{visible:'공개',hidden:'숨김',deleted:'삭제'}[row.status??'visible']}</span>}
    <div className="comment-actions">{row.can_delete&&<button type="button" className="text-button" disabled={actionsDisabled} onClick={()=>setConfirm({row,hide:false})}>삭제</button>}{row.can_hide&&<button type="button" className="text-button" disabled={actionsDisabled} onClick={()=>setConfirm({row,hide:true})}>숨김</button>}{!manage&&row.can_report&&<button type="button" className="text-button" disabled={actionsDisabled} onClick={()=>setReport({id:row.id,kind:'comment'})}>신고</button>}</div>
   </div>
  </article>)}
  {loaded&&page&&!page.rows.length&&<p className="comment-empty">아직 댓글이 없습니다.</p>}
  {page?.next&&<button type="button" className="growth-more" disabled={locked} onClick={()=>void more()}>댓글 더보기</button>}
  {page&&!manage&&!report&&!confirm&&<><form onSubmit={create} className="comment-compose"><label className="sr-only" htmlFor={`comment-${animalId}`}>댓글 내용</label><textarea id={`comment-${animalId}`} rows={1} value={body} disabled={disabled||!context?.ready} onChange={e=>setBody(e.target.value)} placeholder={context?.ready?'댓글을 입력해주세요':'로그인 후 댓글 작성이 가능합니다'}/><button className="button" disabled={disabled||!context?.ready||!body.trim()}>작성</button></form><p className="comment-hint">{context?.ready?`${context.public_name} 이름으로 작성 · 최대 500자`:context?.signed_in?<Link to="/onboarding">승인·필수 동의를 확인해주세요</Link>:context?<Link to={publicLoginHref(window.location.pathname)}>로그인하고 댓글 작성하기</Link>:'작성 권한을 확인하고 있습니다.'}</p>{context?.ready&&<button type="button" className="text-button comment-report" disabled={actionsDisabled} onClick={()=>setReport({id:animalId,kind:'animal'})}>개체 신고</button>}</>}
  {confirm&&<div className="edit-conflict" role="group" aria-label="댓글 처리 확인"><p>{confirm.hide?'이 댓글을 공개 목록에서 숨길까요?':'이 댓글을 삭제할까요? 삭제한 내용은 복구할 수 없습니다.'}</p><button type="button" className="text-button" disabled={disabled} onClick={()=>setConfirm(null)}>취소</button><button type="button" className="button" disabled={disabled} onClick={()=>void run({method:confirm.hide?'hide_comment':'delete_comment',operation:confirm.hide?'comment_hide':'comment_delete',args:{p_comment_id:confirm.row.id,p_request_id:crypto.randomUUID()}})}>{confirm.hide?'댓글 숨기기':'댓글 삭제하기'}</button></div>}
  {report&&<form className="comment-report-form edit-fields" onSubmit={sendReport} aria-label="신고 접수"><h4>{report.kind==='comment'?'댓글':'개체'} 신고</h4><label>사유<select aria-label="신고 사유" value={reason} disabled={disabled} onChange={e=>setReason(e.target.value as keyof typeof reportReasons)}>{Object.entries(reportReasons).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label><label>설명<textarea aria-label="신고 설명" rows={3} value={detail} disabled={disabled} onChange={e=>setDetail(e.target.value)}/></label><small>설명은 500자 이내로 입력해주세요. 신고 내용은 운영자만 확인합니다.</small><div className="edit-actions"><button type="button" className="button ghost" disabled={disabled} onClick={()=>{setReport(null);setDetail('');}}>취소</button><button className="button" disabled={disabled}>신고 접수하기</button></div></form>}
  {pending&&<div className="edit-conflict"><p className="notice" role="alert">처리 결과를 확인하고 있습니다. 확인될 때까지 입력과 이동이 잠깁니다.</p><button type="button" className="text-button" disabled={busy||identityChanged} onClick={()=>void run(pending)}>같은 요청 결과 확인</button></div>}
  {(closing||navigation.blocked)&&<div className="edit-conflict" data-navigation-prompt><p className="notice" role="alert">{busy||pending?'요청 결과를 먼저 확인해주세요.':'작성 중인 내용이 있습니다. 닫으면 입력이 사라집니다.'}</p><button ref={navigation.blocked?navigation.stayButton:focus} type="button" className="text-button" onClick={()=>{setClosing(false);navigation.stay();}}>계속 작성</button><button type="button" className="text-button" disabled={busy||Boolean(pending)} onClick={()=>discard(navigation.blocked)}>입력 버리고 이동</button></div>}
  {notice&&<p role="status" className="comment-hint">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}
  {!pending&&<button type="button" className="text-button comment-refresh" disabled={locked} onClick={()=>void refresh()}>{loaded?'댓글 새로 확인':'댓글 다시 불러오기'}</button>}
 </section>;
}

export function ManagedComments({animalId,onClose}:{animalId:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),guard=useRef<(()=>boolean)|null>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[]);
 function close(){if(guard.current?.()!==false)onClose();}
 return <dialog ref={dialog} className="animal-edit" aria-labelledby="comment-manage-title" onCancel={e=>{e.preventDefault();close();}}><header className="animal-edit-heading"><h2 id="comment-manage-title">댓글 관리</h2><button type="button" className="icon-button" aria-label="댓글 관리 닫기" onClick={close}><X size={20}/></button></header><div className="animal-edit-body"><Comments animalId={animalId} manage closeGuard={guard} onClose={onClose}/></div></dialog>;
}
