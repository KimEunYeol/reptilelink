import {PolicyRenewalLink} from './PolicyRenewalLink';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { collectionItems, collectionSchema, moveCollection, sexLabels, userMessage, type Animal, type CollectionItem, type Dashboard } from '../lib/domain';
import { rpc } from '../lib/supabase';
import { useUnsavedChanges } from '../lib/useUnsavedChanges';

function NavigationGuard({ dirty, busy, onDiscard }: { dirty: boolean; busy: boolean; onDiscard: () => Promise<boolean> }) {
  const nav = useUnsavedChanges(dirty, busy);
  return nav.blocked && <div className="collection-feedback" data-navigation-prompt>
    <p className="notice" role="alert">{busy ? '처리 중입니다. 완료될 때까지 기다려주세요.' : '적용하지 않은 목록 변경이 있습니다. 이동하면 변경 내용이 사라집니다.'}</p>
    <button ref={nav.stayButton} type="button" className="text-button" onClick={nav.stay}>계속 수정</button>
    <button type="button" className="text-button" disabled={busy} onClick={async () => { if (!busy && await onDiscard()) nav.leave(); }}>변경 버리고 이동</button>
  </div>;
}

export function AnimalCollection({ animals, revision, active, onCreate, onEdit, refresh, onLocked, photo }: {
  animals: Animal[]; revision: number; active: boolean; onCreate: () => void; onEdit: (animal: Animal) => void;
  refresh: () => Promise<Dashboard>; onLocked: (locked: boolean) => void; photo: (animal: Animal) => ReactNode;
}) {
  const initial = useRef(collectionItems(animals));
  const [draft, setDraft] = useState(initial.current), [catalog, setCatalog] = useState(animals);
  const [expected, setExpected] = useState(revision), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false), [latest, setLatest] = useState<Dashboard | null>(null);
  const [unresolved, setUnresolved] = useState(false), [reconciling, setReconciling] = useState(false);
  const submitting = useRef(false), request = useRef<{ body: string; id: string } | null>(null);
  const drag = useRef<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current);
  const locked = dirty || busy || conflict || unresolved;

  useEffect(() => { onLocked(locked); return () => onLocked(false); }, [locked, onLocked]);
  useEffect(() => {
    // Keep an unsaved draft across refreshes; only explicit conflict review changes its baseline.
    if (!dirty && !busy && !unresolved && revision >= expected) {
      if (animals.length > catalog.length) setPage(Math.floor((animals.length - 1) / 10));
      initial.current = collectionItems(animals); setDraft(initial.current); setCatalog(animals); setExpected(revision);
    }
  }, [animals, revision, busy, unresolved]); // Only replace a clean, resolved draft with current props.

  function change(next: CollectionItem[]) { setDraft(next); setSaved(false); setError(''); }
  function move(from: number, to: number) {
    if (busy || from < 0 || from >= draft.length || to < 0 || to >= draft.length || from === to) return;
    const id = draft[from].id;
    change(moveCollection(draft, from, to)); setPage(Math.floor(to / 10));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-collection-id="${id}"]`)?.focus());
  }
  async function cancel(): Promise<boolean> {
    if (submitting.current) return false;
    let currentAnimals = animals, currentRevision = revision;
    if (unresolved) {
      submitting.current = true; setBusy(true); setReconciling(true);
      try {
        const authoritative = await refresh();
        if (authoritative.account_status !== 'active' || !authoritative.profile) throw new Error('NOT_FOUND');
        currentAnimals = authoritative.animals; currentRevision = authoritative.profile.revision;
      } catch (reason) {
        setError(`실제 저장 상태를 확인하지 못했습니다. ${userMessage(reason)}`);
        return false; // Keep the draft, receipt, warning and interlocks until reconciliation succeeds.
      } finally { submitting.current = false; setBusy(false); setReconciling(false); }
    }
    initial.current = collectionItems(currentAnimals); setCatalog(currentAnimals); setExpected(currentRevision);
    setDraft(initial.current); setConflict(false); setLatest(null); setSaved(false); setError(''); setUnresolved(false); request.current = null;
    return true;
  }
  async function apply() {
    if (submitting.current || !dirty || conflict) return;
    const parsed = collectionSchema.safeParse(draft);
    if (!parsed.success) { setError('목록의 입력값을 확인해주세요.'); return; }
    submitting.current = true; setBusy(true); setError(''); setSaved(false);
    const body = JSON.stringify(parsed.data);
    if (request.current?.body !== body) request.current = { body, id: crypto.randomUUID() };
    try {
      const result = await rpc<{ revision: number }>('apply_animal_collection', { p_items: parsed.data, p_expected: expected, p_request_id: request.current.id });
      const authoritative = await refresh();
      if (!authoritative.profile || authoritative.account_status !== 'active' || authoritative.profile.revision < result.revision) throw new Error('NOT_FOUND');
      initial.current = collectionItems(authoritative.animals); setDraft(initial.current); setCatalog(authoritative.animals);
      setExpected(authoritative.profile.revision); setSaved(true); setUnresolved(false); request.current = null;
    } catch (reason) {
      setUnresolved(true);
      const message = String((reason as { message?: string })?.message ?? reason);
      if (/VERSION_CONFLICT|REQUEST_CONFLICT|REQUEST_EXPIRED|VALIDATION_FAILED/.test(message)) { setConflict(true); setLatest(null); }
      setError(/VALIDATION_FAILED/.test(message) ? '목록이 변경됐거나 입력값이 올바르지 않습니다. 최신 목록을 확인해주세요.' : userMessage(reason));
    } finally { submitting.current = false; setBusy(false); }
  }
  async function inspectLatest() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const next = await rpc<Dashboard>('my_dashboard');
      if (next.account_status !== 'active' || !next.profile) throw new Error('NOT_FOUND');
      setLatest(next);
    } catch (reason) { setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function acceptLatest(keep: boolean) {
    if (!latest?.profile || busy) return;
    const baseline = collectionItems(latest.animals);
    initial.current = baseline; setExpected(latest.profile.revision); setCatalog(latest.animals);
    if (!keep) setDraft(baseline);
    setPage(0); setConflict(false); setLatest(null); setUnresolved(false); request.current = null;
    setError('최신 목록을 확인했습니다. 변경 내용을 검토한 뒤 적용해주세요.');
    // A failed parent refresh does not discard the already reviewed local draft.
    try { await refresh(); } catch (reason) { setError(userMessage(reason)); }
  }
  const sameIds = latest && draft.length === latest.animals.length && draft.every(item => latest.animals.some(a => a.id === item.id));
  const pages = Math.max(1, Math.ceil(draft.length / 10)), currentPage = Math.min(page, pages - 1);
  return <section className="animal-collection" aria-label="개체 목록 관리">
    {!active ? null : <NavigationGuard dirty={dirty || unresolved} busy={busy} onDiscard={cancel}/>}
    {locked && <p className="collection-hint">목록 변경을 적용하거나 취소한 뒤 개체를 등록·편집할 수 있어요.</p>}
    <button type="button" className="collection-add" aria-label="개체 등록" disabled={locked || draft.length >= 20} onClick={onCreate}><Plus size={40}/></button>
    {!draft.length && <p className="collection-empty">등록된 개체가 없습니다.</p>}
    <div className="collection-list">
      {draft.slice(currentPage * 10, currentPage * 10 + 10).map((item, offset) => {
        const index = currentPage * 10 + offset, animal = catalog.find(a => a.id === item.id);
        if (!animal) return null;
        return <article key={item.id} className="collection-card" data-collection-id={item.id} tabIndex={-1} aria-label={`${animal.name} 목록 항목`}
          draggable={!busy} onDragStart={event => {
            if ((event.target as HTMLElement).closest('.collection-tools')) { event.preventDefault(); return; }
            drag.current = item.id; event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move';
          }} onDragEnd={() => { drag.current = null; }} onDragOver={event => { if (!busy) event.preventDefault(); }} onDrop={event => {
            event.preventDefault(); const id = drag.current; drag.current = null;
            if (id) move(draft.findIndex(a => a.id === id), index);
          }}>
          <button type="button" className="collection-open" aria-label={`${animal.name} 상세 보기`} disabled={locked} onClick={() => onEdit(animal)}>
            {photo(animal)}<span className="collection-caption"><span className={`sex-pill ${animal.sex}`}>{sexLabels[animal.sex]}</span><strong>{animal.name}</strong>
              <span>{[animal.species,animal.morph,animal.description].filter(Boolean).join(' / ')}</span></span>
          </button>
          <div className="collection-tools">
            <button type="button" role="switch" className="collection-switch" aria-label={`${animal.name} 공개`} aria-checked={item.is_public} disabled={busy}
              onClick={() => change(draft.map(a => a.id === item.id ? { ...a, is_public: !a.is_public } : a))}><span/><span className="sr-only">{item.is_public ? '공개':'비공개'}</span></button>
            <div><button type="button" aria-label={`${animal.name} 위로`} disabled={busy || index === 0} onClick={() => move(index,index-1)}><ArrowUp size={21}/></button>
              <button type="button" aria-label={`${animal.name} 아래로`} disabled={busy || index === draft.length-1} onClick={() => move(index,index+1)}><ArrowDown size={21}/></button></div>
          </div>
        </article>;
      })}
    </div>
    <nav className="collection-pagination" aria-label="개체 목록 페이지">
      <button type="button" aria-label="이전 페이지" disabled={currentPage === 0} onClick={() => setPage(currentPage-1)}><ChevronLeft size={16}/></button>
      {Array.from({length:pages},(_,i) => <button type="button" key={i} aria-label={`${i+1}페이지`} aria-current={currentPage === i ? 'page':undefined} onClick={() => setPage(i)}>{i+1}</button>)}
      <button type="button" aria-label="다음 페이지" disabled={currentPage === pages-1} onClick={() => setPage(currentPage+1)}><ChevronRight size={16}/></button>
    </nav>
    {error && <p className="notice" role="alert">{error}<PolicyRenewalLink message={error}/></p>}
    {unresolved && <p className="notice" role="status">실제 저장 상태를 아직 확인하지 못했습니다. 재시도하거나 변경 취소로 저장 상태를 확인해주세요.</p>}
    {saved && <p className="success" role="status">목록을 적용했어요.</p>}
    {conflict && <div className="collection-feedback">
      {!latest ? <button type="button" className="text-button" disabled={busy} onClick={inspectLatest}>최신 목록 확인</button> : <>
        <ol aria-label="최신 저장 목록">{latest.animals.map(a => <li key={a.id}>{a.name} · {a.is_public ? '공개':'비공개'}</li>)}</ol>
        {!sameIds && <p className="notice">개체가 추가되거나 삭제됐습니다. 최신 목록으로 바꾼 뒤 다시 수정해주세요.</p>}
        <button type="button" className="text-button" disabled={busy || !sameIds} onClick={() => acceptLatest(true)}>내 목록 유지</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => acceptLatest(false)}>최신 목록으로 바꾸기</button>
      </>}
    </div>}
    <div className="collection-apply"><button type="button" className="button" disabled={busy || !dirty || conflict} onClick={apply}>{busy ? (reconciling ? '저장 상태 확인 중':'적용 중'):'적용하기'}</button>
      {locked && <button type="button" className="text-button" disabled={busy} onClick={cancel}>변경 취소</button>}</div>
  </section>;
}
