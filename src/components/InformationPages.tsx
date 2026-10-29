import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {SourcePage} from './SourcePage';
import {supportAddress,supportDraft} from '../lib/support';
import {policyAvailable,usePolicy,type PolicyBundle} from '../lib/policy';

export function PolicyContent({privacy,bundle}:{privacy:boolean;bundle:PolicyBundle|null}){
 if(!policyAvailable(bundle))return <article className="source-policy"><p className="source-preparation">운영 문서를 준비 중입니다. 현재 필수 안내를 확인할 수 없습니다.</p></article>;
 return <article className="source-policy"><p className="source-preparation">{bundle.mode==='preview'?'개발 확인용 안내 · 운영 문서 준비 중':'문서 버전'} · {bundle.version}</p>{(privacy?bundle.privacy:bundle.terms).split('\n\n').map((text,i)=><p key={i} style={{whiteSpace:'pre-wrap'}}>{text}</p>)}</article>;
}
export function PolicyDialog({privacy,onClose,bundle}:{privacy:boolean;onClose:()=>void;bundle:PolicyBundle|null}){
 const ref=useRef<HTMLDialogElement>(null),id=useId();useEffect(()=>{const previous=document.activeElement as HTMLElement|null,d=ref.current;d?.showModal();return()=>{d?.close();previous?.focus();};},[]);
 return <dialog className="source-policy-dialog" ref={ref} aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}}><div className="source-dialog-heading"><h2 id={id}>{privacy?'개인정보 안내':'이용 안내'}</h2><button type="button" aria-label="안내 닫기" onClick={onClose}>×</button></div><div className="source-policy-scroll" tabIndex={0}><PolicyContent privacy={privacy} bundle={bundle}/></div><button type="button" className="button" onClick={onClose}>확인</button></dialog>;
}
export function LegalPage({privacy,signedIn=false,onSignOut}:{privacy:boolean;signedIn?:boolean;onSignOut?:()=>void}){
 const policy=usePolicy();
 return <SourcePage signedIn={signedIn} onSignOut={onSignOut}><main className="source-info-main"><h1>{privacy?'개인정보처리방침':'이용약관'}</h1>{policy.loading?<p role="status">안내를 불러오고 있어요.</p>:policy.error?<p className="notice" role="alert">{policy.error}</p>:<PolicyContent privacy={privacy} bundle={policy.data}/>}<button type="button" className="text-button" disabled={policy.loading} onClick={()=>void policy.load()}>안내 다시 불러오기</button><Link className="button ghost" to="/">홈으로</Link></main></SourcePage>;
}
export function HelpPage({signedIn=false,onSignOut}:{signedIn?:boolean;onSignOut?:()=>void}){
 const address=supportAddress(import.meta.env.VITE_SUPPORT_EMAIL),[name,setName]=useState(''),[email,setEmail]=useState(''),[body,setBody]=useState(''),[error,setError]=useState(''),[attempted,setAttempted]=useState(false);
 function submit(e:FormEvent){e.preventDefault();setError('');setAttempted(false);const href=supportDraft(address,name,email,body);if(!href){setError('아이디·이메일과 문의내용을 확인해주세요. 긴 내용은 조금 줄여주세요.');return;}try{window.location.href=href;setAttempted(true);}catch{setError('메일 앱을 열지 못했습니다. 연결된 메일 앱을 확인해주세요.');}}
 return <SourcePage signedIn={signedIn} onSignOut={onSignOut}><main className="source-info-main source-help"><h1>고객센터</h1><p className="source-preparation" role="status">{address?'메일 앱에서 초안을 확인하고 직접 발송해주세요. 이 화면에서는 문의를 접수하지 않습니다.':'문의 연결을 준비 중입니다. 현재 문의를 접수하거나 메일을 발송하지 않습니다.'}</p><form onSubmit={submit}><fieldset disabled={!address}><label>렙타일링크 아이디<input value={name} onChange={e=>setName(e.target.value)} maxLength={40} required placeholder="아이디를 입력해주세요" autoComplete="username"/></label><label>이메일 주소<input type="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} required placeholder="회신받을 이메일을 입력해주세요" autoComplete="email"/></label><label>문의내용<textarea value={body} onChange={e=>setBody(e.target.value)} maxLength={4000} rows={10} required placeholder="내용을 작성해주세요 (최대 2,000자)"/></label><button className="button" disabled={!address}>{address?'메일 초안 열기':'문의 연결 준비 중'}</button></fieldset>{error&&<p className="notice" role="alert">{error}</p>}{attempted&&<p className="source-preparation" role="status">메일 앱 연결을 시도했습니다. 앱에서 내용을 확인하고 직접 발송해야 합니다.</p>}</form></main></SourcePage>;
}
