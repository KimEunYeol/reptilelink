import{serverCommand}from'../lib/supabase';
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {Dashboard} from '../lib/domain';
import {userMessage} from '../lib/domain';
import {rpc,serverRequest,supabase} from '../lib/supabase';
import {useUnsavedChanges} from '../lib/useUnsavedChanges';

type Refresh=()=>Promise<Dashboard>;
export function AccountWithdrawal({expected,disabled=false,refresh,onLocked}:{expected:number|null;disabled?:boolean;refresh:Refresh;onLocked?:(value:boolean)=>void}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{onLocked?.(open);return()=>onLocked?.(false);},[open,onLocked]);
 return <section className="account-withdrawal" aria-label="회원탈퇴"><strong>회원탈퇴</strong><p>회원탈퇴 후 회원정보 및 관련 데이터는 복구되지 않습니다.</p><button ref={trigger} type="button" className="text-button" disabled={disabled} onClick={()=>setOpen(true)}>탈퇴하기</button>{open&&<WithdrawalDialog expected={expected} refresh={refresh} close={()=>{setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}}/>}</section>;
}
function WithdrawalDialog({expected:initial,refresh,close}:{expected:number|null;refresh:Refresh;close:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),submitting=useRef(false),request=useRef(crypto.randomUUID()),command=useRef<object>({});
 const [confirm,setConfirm]=useState(''),[expected,setExpected]=useState(initial),[busy,setBusy]=useState(false),[started,setStarted]=useState(false),[conflict,setConflict]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(initial===null),[contextReady,setContextReady]=useState(initial!==null);
 async function loadContext(){setLoading(true);setContextReady(false);try{const v=await rpc<{expected:number|null}>('my_withdrawal_context');setExpected(v.expected);setContextReady(true);setError('');}catch(reason){setError(userMessage(reason));}finally{setLoading(false);}}
 const navigation=useUnsavedChanges(started,busy);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();if(initial===null)void loadContext();return()=>{dialog.current?.close();previous?.focus();};},[]);
 async function submit(){if(submitting.current||loading||!contextReady||conflict||confirm!=='탈퇴')return;submitting.current=true;setBusy(true);setStarted(true);setError('');
  try{await serverCommand('/api/account/delete',{expected,request_id:request.current,confirm:'탈퇴'},command.current);await refresh();}
  catch(reason){
   // Auth removal can finish before its HTTP response reaches this tab. The
   // authenticated DB status can still confirm it while this JWT is unexpired.
   try{const d=await refresh();if(d.account_status==='deleting'||d.account_status==='deleted')return;}catch{/* Keep the same command until authoritative confirmation succeeds. */}
   if(/COMMAND_TOO_OLD/.test(String(reason)))setConflict(true);else if(/VERSION_CONFLICT|REQUEST_CONFLICT/.test(String(reason))){setConflict(true);setStarted(false);}
   setError(userMessage(reason));
  }finally{submitting.current=false;setBusy(false);}
 }
 async function latest(){if(submitting.current)return;submitting.current=true;setBusy(true);try{const d=await refresh();if(d.account_status==='deleting'||d.account_status==='deleted')return;const context=await rpc<{expected:number|null}>('my_withdrawal_context');setExpected(context.expected);setContextReady(true);request.current=crypto.randomUUID();command.current={};setConfirm('');setStarted(false);setConflict(false);setError('최신 상태를 확인했습니다. 탈퇴 안내를 확인하고 다시 입력해주세요.');}catch(reason){setError(userMessage(reason));}finally{submitting.current=false;setBusy(false);}}
 function cancel(){if(!busy&&!started)close();}
 return <dialog ref={dialog} className="animal-edit account-withdrawal-dialog" aria-labelledby="withdrawal-title" onCancel={e=>{e.preventDefault();cancel();}}><header className="animal-edit-heading"><h2 id="withdrawal-title">회원탈퇴 확인</h2><button type="button" className="icon-button" aria-label="탈퇴 확인 닫기" disabled={busy||started} onClick={cancel}><X size={20}/></button></header><div className="animal-edit-body"><div className="animal-delete-notice"><p>회원정보와 개체·기록·사진 등 관련 데이터는 복구할 수 없습니다.</p><p>탈퇴 요청 즉시 내 페이지 접근을 차단합니다. 세션 해지와 파일 정리가 끝난 뒤 렙타일링크 계정을 삭제합니다.</p></div>{loading&&<p role="status">계정 상태를 확인하고 있습니다.</p>}<label className="withdrawal-confirm">확인하려면 ‘탈퇴’를 입력해주세요.<input aria-label="탈퇴 확인" value={confirm} disabled={busy||started||loading||!contextReady} onChange={e=>setConfirm(e.target.value)}/></label>{error&&<p className="notice" role="alert">{error}</p>}{started&&<p className="edit-photo-hint">탈퇴 요청 결과를 확인 중입니다. 같은 요청으로 다시 확인해주세요.</p>}{!contextReady&&!started&&!loading&&error&&<button type="button" className="text-button" onClick={()=>void loadContext()}>계정 확인 재시도</button>}{conflict&&<button type="button" className="text-button" disabled={busy} onClick={()=>void latest()}>최신 계정 상태 확인</button>}{navigation.blocked&&<div data-navigation-prompt><p className="notice" role="alert">탈퇴 요청 결과를 확인한 뒤 이동해주세요.</p><button ref={navigation.stayButton} type="button" className="text-button" onClick={navigation.stay}>계속 확인</button></div>}<footer className="edit-actions"><button type="button" className="button ghost" disabled={busy||loading||!contextReady||conflict||confirm!=='탈퇴'} onClick={()=>void submit()}>{started?'탈퇴 요청 다시 확인':'탈퇴 요청하기'}</button><button type="button" className="text-button" disabled={busy||started} onClick={cancel}>취소</button></footer></div></dialog>;
}
export function AccountDeletionProgress({data,refresh}:{data:Dashboard;refresh:Refresh}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const complete=data.account_status==='deleted';
 async function retry(){if(busy)return;setBusy(true);setError('');try{await serverRequest('/api/account/cleanup',{});await refresh();}catch(reason){try{const d=await refresh();if(d.account_status==='deleted')return;}catch{/* Preserve the last confirmed phase. */}setError(userMessage(reason));}finally{setBusy(false);}}
 return <div className="not-found account-deletion-progress"><h1>{complete?'탈퇴가 완료됐습니다.':'탈퇴 요청을 접수했습니다.'}</h1><div className="account-withdrawal"><p>{complete?'회원정보와 관련 데이터, 렙타일링크 계정을 삭제했습니다.':'계정 접근을 차단했습니다. 세션 해지와 파일 정리 후 렙타일링크 계정을 삭제합니다.'}</p>{!complete&&<p>{data.account_deletion?.phase==='auth'?'파일과 관련 데이터 정리를 마쳤습니다. 렙타일링크 계정 삭제를 다시 확인해주세요.':data.account_deletion?.sessions_revoked?'이미지 업로드 유효기간이 끝나고 실제 파일을 제거할 때까지 정리 대기로 유지됩니다.':'세션 해지를 확인해야 합니다. 정리를 재시도하거나 다시 로그인해주세요.'}</p>}{error&&<p className="notice" role="alert">{error}</p>}{!complete&&<button type="button" className="text-button" disabled={busy} onClick={()=>void retry()}>정리 다시 확인</button>}<button type="button" className="text-button" disabled={busy} onClick={()=>void supabase.auth.signOut({scope:'local'})}>{complete?'로그인 화면으로':'로그아웃'}</button></div></div>;
}
