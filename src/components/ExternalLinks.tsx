import {PolicyRenewalLink} from './PolicyRenewalLink';
import { useEffect, useRef, useState } from 'react';
import { Check, Menu, X } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { userMessage } from '../lib/domain';
import { commandMessage, definitiveLinkError, httpsUrl, linkColors, linkInputSchema, linkItems, linkTextColor, linkTokens, type ExternalLink, type LinkInput, type LinkItem, type LinkSnapshot, type PublicLink } from '../lib/links';
import { useUnsavedChanges } from '../lib/useUnsavedChanges';

export function PublicLinks({ links }: { links: PublicLink[] }) {
  const valid=links.filter(l=>httpsUrl(l.url)&&linkTokens.includes(l.color_token));
  return valid.length ? <section className="public-links" aria-label="공개 외부 링크">{valid.map(l=><a key={l.id} href={httpsUrl(l.url)!} target="_blank" rel="noopener noreferrer" style={{backgroundColor:linkColors[l.color_token].background,color:linkTextColor(l.color_token)}}>{l.title}</a>)}</section> : null;
}

function ListNavigation({ dirty,busy,cancel }: { dirty:boolean;busy:boolean;cancel:()=>Promise<boolean> }) {
  const navigation=useUnsavedChanges(dirty,busy);
  return navigation.blocked && <div data-navigation-prompt><p className="notice" role="alert">적용하지 않은 링크 변경이 있습니다.</p><button ref={navigation.stayButton} type="button" className="text-button" onClick={navigation.stay}>계속 수정</button><button type="button" className="text-button" disabled={busy} onClick={async()=>{if(await cancel())navigation.leave();}}>변경 버리고 이동</button></div>;
}

function LinkEditor({ row,revision,refresh,onClose }: { row:ExternalLink|null;revision:number;refresh:()=>Promise<LinkSnapshot>;onClose:()=>void }) {
  const dialog=useRef<HTMLDialogElement>(null),submitting=useRef(false),pending=useRef<Record<string,unknown>|null>(null);
  const original=useRef<LinkInput>({title:row?.title??'',url:row?.url??'',color_token:row?.color_token??'black'});
  const [values,setValues]=useState(original.current),[busy,setBusy]=useState(false),[error,setError]=useState(''),[unresolved,setUnresolved]=useState(false),[conflict,setConflict]=useState(false),[latest,setLatest]=useState<LinkSnapshot|null>(null),[expected,setExpected]=useState(revision);
  const dirty=unresolved||JSON.stringify(values)!==JSON.stringify(original.current),navigation=useUnsavedChanges(dirty,busy);
  useEffect(()=>{const previous=row?document.querySelector<HTMLButtonElement>(`[data-link-id="${row.id}"] [data-link-edit]`):document.querySelector<HTMLButtonElement>('[data-link-add]');dialog.current?.showModal();return()=>{dialog.current?.close();if(previous?.isConnected)previous.focus();else document.querySelector<HTMLButtonElement>('[data-link-add]')?.focus();};},[]);
  async function settle(){if(!pending.current)return false;try{await rpc('save_external_link',pending.current);return true;}catch(reason){if(!definitiveLinkError(reason))throw reason;pending.current=null;return false;}}
  async function save(){
    if(submitting.current||conflict)return;
    if(!pending.current){const parsed=linkInputSchema.safeParse(values);if(!parsed.success){setError(parsed.error.issues[0]?.message??'입력값을 확인해주세요.');return;}pending.current={p_link_id:row?.id??null,p_data:parsed.data,p_expected:expected,p_request_id:crypto.randomUUID()};}
    submitting.current=true;setBusy(true);setUnresolved(true);setError('');
    try{await rpc('save_external_link',pending.current);await refresh();pending.current=null;setUnresolved(false);onClose();}
    catch(reason){if(definitiveLinkError(reason)){pending.current=null;setUnresolved(false);if(/VERSION_CONFLICT|NOT_FOUND/.test(commandMessage(reason)))setConflict(true);}setError(userMessage(reason));}
    finally{submitting.current=false;setBusy(false);}
  }
  async function discard(forNavigation=false){if(submitting.current)return;submitting.current=true;setBusy(true);try{if(unresolved||conflict){await settle();await refresh();pending.current=null;setUnresolved(false);}if(forNavigation)navigation.leave();else onClose();}catch(reason){setError(userMessage(reason));}finally{submitting.current=false;setBusy(false);}}
  async function inspect(){if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try{const committed=await settle();const data=await refresh();pending.current=null;setUnresolved(false);if(committed){onClose();return;}setLatest(data);setConflict(true);}catch(reason){setError(userMessage(reason));}finally{submitting.current=false;setBusy(false);}}
  function accept(){if(!latest)return;const found=row?latest.links.find(l=>l.id===row.id):null;if(row&&!found){onClose();return;}const next={title:found?.title??values.title,url:found?.url??values.url,color_token:found?.color_token??values.color_token};original.current=found?next:{title:'',url:'',color_token:'black'};setValues(next);setExpected(latest.revision);setConflict(false);setLatest(null);setError('최신 상태를 확인했습니다. 입력을 검토한 뒤 저장해주세요.');}
  return <dialog ref={dialog} className="animal-edit link-editor" aria-labelledby="link-editor-title" onCancel={e=>{e.preventDefault();void discard();}}><header className="animal-edit-heading"><h2 id="link-editor-title">{row?'링크 수정':'링크 추가'}</h2><button type="button" className="icon-button" aria-label="링크 편집 닫기" disabled={busy} onClick={()=>void discard()}><X size={20}/></button></header><form className="animal-edit-body" onSubmit={e=>{e.preventDefault();void save();}}>
    <fieldset disabled={busy||unresolved||conflict} className="link-fields"><legend className="sr-only">링크 내용</legend><label><span>제목</span><input aria-label="링크 제목" value={values.title} onChange={e=>setValues(v=>({...v,title:e.target.value}))}/></label><fieldset className="link-palette"><legend>배경색상</legend>{linkTokens.map(token=><button key={token} type="button" aria-label={`배경색 ${linkColors[token].label}`} aria-pressed={values.color_token===token} style={{backgroundColor:linkColors[token].background,color:linkTextColor(token)}} onClick={()=>setValues(v=>({...v,color_token:token}))}>{values.color_token===token&&<Check size={22}/>}</button>)}</fieldset><label><span>링크</span><input aria-label="링크 주소" type="url" placeholder="https://" value={values.url} onChange={e=>setValues(v=>({...v,url:e.target.value}))}/></label></fieldset>
    {error&&<p className="notice" role="alert">{error}<PolicyRenewalLink message={error}/></p>}{unresolved&&<p className="edit-photo-hint">저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하거나 취소해주세요.</p>}
    {(conflict||unresolved)&&<button type="button" className="text-button" disabled={busy} onClick={()=>void inspect()}>최신 링크 확인</button>}
    {latest&&<section className="edit-conflict" aria-label="최신 링크 내용"><p>{row?latest.links.find(l=>l.id===row.id)?.title??'이 링크는 삭제됐습니다.':`현재 링크 ${latest.links.length}개`}</p>{row&&latest.links.find(l=>l.id===row.id)&&<p className="latest-link-url">{latest.links.find(l=>l.id===row.id)!.url} · {linkColors[latest.links.find(l=>l.id===row.id)!.color_token].label}</p>}<button type="button" className="text-button" onClick={()=>void navigator.clipboard.writeText(`${values.title}\n${values.url}`).catch(()=>setError('입력 내용을 직접 복사해주세요.'))}>입력 복사</button><button type="button" className="text-button" onClick={accept}>{row?'최신 링크 사용':'입력 유지·최신 상태 사용'}</button></section>}
    {navigation.blocked&&<div data-navigation-prompt><p className="notice" role="alert">저장하지 않은 링크 내용이 있습니다.</p><button ref={navigation.stayButton} type="button" className="text-button" onClick={navigation.stay}>계속 편집</button><button type="button" className="text-button" disabled={busy} onClick={()=>void discard(true)}>변경 버리고 이동</button></div>}
    <footer className="edit-actions"><button className="button" disabled={busy||conflict||(!dirty&&!unresolved)}>{busy?'저장 중':unresolved?'저장 다시 확인':'저장'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>void discard()}>취소</button></footer>
  </form></dialog>;
}

type ApplyCommand={p_items:LinkItem[];p_remove:string[];p_expected:number;p_request_id:string};
export function ExternalLinks({ revision,refreshDashboard,onLocked }: { revision:number;refreshDashboard:()=>Promise<unknown>;onLocked:(locked:boolean)=>void }) {
  const [snapshot,setSnapshot]=useState<LinkSnapshot|null>(null),[draft,setDraft]=useState<LinkItem[]>([]),[removed,setRemoved]=useState<string[]>([]),[editor,setEditor]=useState<ExternalLink|null|undefined>(undefined);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[saved,setSaved]=useState(false),[unresolved,setUnresolved]=useState(false),[conflict,setConflict]=useState(false),[latest,setLatest]=useState<LinkSnapshot|null>(null);
  const submitting=useRef(false),pending=useRef<ApplyCommand|null>(null),serial=useRef(0),drag=useRef<string|null>(null),blockRead=useRef(false),state=useRef<LinkSnapshot|null>(null);
  const dirty=Boolean(snapshot&&(JSON.stringify(draft)!==JSON.stringify(linkItems(snapshot.links))||removed.length)),locked=dirty||busy||unresolved||conflict||editor!==undefined;
  blockRead.current=dirty||busy||unresolved||conflict||editor!==undefined;state.current=snapshot;
  const fetchLinks=()=>rpc<LinkSnapshot>('my_external_links');
  function accept(value:LinkSnapshot){setSnapshot(value);setDraft(linkItems(value.links));setRemoved([]);setUnresolved(false);setConflict(false);setLatest(null);setLoading(false);pending.current=null;}
  useEffect(()=>{onLocked(locked);return()=>onLocked(false);},[locked,onLocked]);
  useEffect(()=>{if(submitting.current||blockRead.current||(state.current&&state.current.revision===revision))return;const request=++serial.current;setLoading(true);fetchLinks().then(value=>{if(request!==serial.current)return;if(blockRead.current){setConflict(true);setError('다른 화면에서 변경됐습니다. 최신 링크 목록을 확인해주세요.');return;}accept(value);}).catch(reason=>{if(request===serial.current)setError(userMessage(reason));}).finally(()=>{if(request===serial.current)setLoading(false);});return()=>{serial.current++;};},[revision]);
  async function refresh(){serial.current++;await refreshDashboard();const value=await fetchLinks();accept(value);return value;}
  async function reload(){if(submitting.current)return;submitting.current=true;setLoading(true);setError('');try{await refresh();}catch(reason){setError(userMessage(reason));}finally{submitting.current=false;setLoading(false);}}
  async function settle(){if(!pending.current)return;try{await rpc('apply_external_links',pending.current);}catch(reason){if(!definitiveLinkError(reason))throw reason;pending.current=null;}}
  async function cancel(){if(submitting.current)return false;submitting.current=true;setBusy(true);try{if(unresolved||conflict){await settle();await refresh();}else if(snapshot)accept(snapshot);setError('');setSaved(false);return true;}catch(reason){setError(`실제 저장 상태를 확인하지 못했습니다. ${userMessage(reason)}`);return false;}finally{submitting.current=false;setBusy(false);}}
  async function apply(){
    if(submitting.current||conflict||!snapshot||(!dirty&&!unresolved))return;
    if(!pending.current)pending.current={p_items:draft.map(r=>({...r})),p_remove:[...removed],p_expected:snapshot.revision,p_request_id:crypto.randomUUID()};
    submitting.current=true;setBusy(true);setUnresolved(true);setError('');setSaved(false);
    try{await rpc('apply_external_links',pending.current);await refresh();setSaved(true);}
    catch(reason){if(definitiveLinkError(reason)){pending.current=null;setUnresolved(false);if(/VERSION_CONFLICT|VALIDATION_FAILED|NOT_FOUND/.test(commandMessage(reason)))setConflict(true);}setError(userMessage(reason));}
    finally{submitting.current=false;setBusy(false);}
  }
  async function inspect(){if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try{await settle();await refreshDashboard();const value=await fetchLinks();pending.current=null;setUnresolved(false);setLatest(value);setConflict(true);}catch(reason){setError(userMessage(reason));}finally{submitting.current=false;setBusy(false);}}
  function change(next:LinkItem[]){setDraft(next);pending.current=null;setSaved(false);setError('');}
  function move(id:string,to:number){if(busy||unresolved||conflict||editor!==undefined)return;const from=draft.findIndex(r=>r.id===id);if(from<0||to<0||to>=draft.length||from===to)return;const next=[...draft],[item]=next.splice(from,1);next.splice(to,0,item);change(next);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-link-id="${id}"] [data-link-drag]`)?.focus());}
  function remove(id:string){if(busy||unresolved||conflict)return;change(draft.filter(r=>r.id!==id));setRemoved(old=>[...old,id]);}
  const unavailable=busy||loading||unresolved||conflict;
  return <section className="external-link-manager" aria-label="링크 목록 관리">
    <div className="link-add-row"><button data-link-add type="button" className="button" disabled={locked||loading||!snapshot||snapshot.links.length>=10} onClick={()=>setEditor(null)}>링크추가</button></div>
    {loading&&<p role="status" className="edit-photo-hint">링크를 불러오고 있습니다.</p>}{error&&<p className="notice" role="alert">{error}<PolicyRenewalLink message={error}/></p>}{!snapshot&&!loading&&<button type="button" className="text-button" onClick={()=>void reload()}>다시 불러오기</button>}
    {snapshot&&!loading&&!draft.length&&<p className="link-empty">등록된 링크가 없습니다.</p>}
    <div className="link-list">{draft.map((item,index)=>{const row=snapshot?.links.find(r=>r.id===item.id);if(!row)return null;return <article key={row.id} data-link-id={row.id} aria-label={`${row.title} 링크 항목`} className="managed-link" style={{backgroundColor:linkColors[row.color_token].background,color:linkTextColor(row.color_token)}} onDragOver={e=>{if(!unavailable)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(drag.current)move(drag.current,index);drag.current=null;}}>
      <button data-link-drag type="button" className="link-drag" aria-label={`${row.title} 순서 변경`} aria-keyshortcuts="ArrowUp ArrowDown" aria-describedby="link-sort-help" disabled={unavailable} draggable={!unavailable} onDragStart={e=>{drag.current=row.id;e.dataTransfer.setData('text/plain',row.id);}} onDragEnd={()=>{drag.current=null;}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();move(row.id,index+(e.key==='ArrowUp'?-1:1));}}}><Menu size={18}/></button>
      <div className="link-title"><strong>{row.title}</strong><span title={row.url}>{row.url}</span></div><button type="button" role="switch" className="link-switch" aria-label={`${row.title} 공개`} aria-checked={item.is_public} disabled={unavailable} onClick={()=>change(draft.map(r=>r.id===row.id?{...r,is_public:!r.is_public}:r))}><span/><span className="sr-only">{item.is_public?'공개':'비공개'}</span></button>
      <div className="link-row-actions"><button data-link-edit type="button" className="button ghost" disabled={locked||loading} onClick={()=>setEditor(row)}>수정</button><button type="button" className="button ghost" disabled={unavailable} onClick={()=>remove(row.id)}>삭제</button></div>
    </article>;})}</div>
    <p id="link-sort-help" className="edit-photo-hint">손잡이를 드래그하거나 방향키 위·아래로 순서를 바꾸세요.</p>
    {removed.length>0&&<p className="edit-photo-hint">삭제 대기 {removed.length}개 · 적용하기를 누르면 삭제됩니다.</p>}
    {unresolved&&<p className="notice" role="alert">실제 적용 상태를 확인하지 못했습니다. 다시 적용하거나 취소해 확인해주세요.</p>}
    {(conflict||unresolved)&&<button type="button" className="text-button" disabled={busy} onClick={()=>void inspect()}>최신 링크 목록 확인</button>}
    {latest&&<section className="edit-conflict" aria-label="최신 링크 목록"><ul>{latest.links.map(r=><li key={r.id}>{r.title} · {r.is_public?'공개':'비공개'}</li>)}</ul><button type="button" className="text-button" disabled={busy} onClick={()=>{accept(latest);setError('최신 목록을 불러왔습니다. 변경할 내용을 다시 확인해주세요.');}}>최신 목록 사용</button></section>}
    {editor===undefined&&<ListNavigation dirty={dirty||unresolved||conflict} busy={busy} cancel={cancel}/>}
    <div className="link-apply"><button type="button" className="button" disabled={busy||loading||conflict||(!dirty&&!unresolved)||editor!==undefined} onClick={()=>void apply()}>적용하기</button>{(dirty||unresolved||conflict)&&<button type="button" className="text-button" disabled={busy} onClick={()=>void cancel()}>변경 취소</button>}{saved&&<p role="status" className="success">링크 목록을 적용했어요.</p>}</div>
    {editor!==undefined&&snapshot&&<LinkEditor row={editor} revision={snapshot.revision} refresh={refresh} onClose={()=>setEditor(undefined)}/>}
  </section>;
}
