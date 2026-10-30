import{serverCommand}from'../lib/supabase';
import {PolicyRenewalLink} from './PolicyRenewalLink';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { userMessage, type Animal, type Dashboard, type PendingAnimalDeletion } from '../lib/domain';
import { serverRequest } from '../lib/supabase';
import { useUnsavedChanges } from '../lib/useUnsavedChanges';

export function AnimalDelete({ animal, revision, refresh, onClose }: { animal: Animal; revision: number; refresh: () => Promise<Dashboard>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), submitting = useRef(false), requestId = useRef(crypto.randomUUID()), command = useRef<object>({});
  const [expected, setExpected] = useState(revision), [name, setName] = useState(animal.name);
  const [busy, setBusy] = useState(false), [started, setStarted] = useState(false), [conflict, setConflict] = useState(false), [error, setError] = useState('');
  const navigation = useUnsavedChanges(started, busy);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const el = dialog.current; el?.showModal(); return () => { el?.close(); previous?.focus(); }; }, []);
  async function submit(forNavigation = false) {
    if (submitting.current || conflict) return;
    submitting.current = true; setBusy(true); setStarted(true); setError('');
    try {
      await serverCommand(`/api/animals/${animal.id}/delete`, { expected, request_id: requestId.current }, command.current);
      await refresh();
      if (forNavigation) navigation.leave(); else onClose();
    } catch (reason) {
      if (/VERSION_CONFLICT|NOT_FOUND|REQUEST_CONFLICT|REQUEST_EXPIRED|COMMAND_TOO_OLD|CONSENT_REQUIRED|ACCOUNT_NOT_ACTIVE/.test(String(reason))) { if (!started) setStarted(false); setConflict(true); }
      setError(userMessage(reason));
    } finally { submitting.current = false; setBusy(false); }
  }
  async function inspect() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const d = await refresh(), found = d.animals.find(item => item.id === animal.id);
      if (!found) { onClose(); return; }
      if (!d.profile || d.account_status !== 'active') throw new Error('ACCOUNT_NOT_ACTIVE');
      setExpected(d.profile.revision); setName(found.name); setConflict(false); setStarted(false); requestId.current = crypto.randomUUID(); command.current={};
      setError('최신 상태를 확인했습니다. 삭제할 개체를 확인한 뒤 다시 선택해주세요.');
    } catch (reason) { setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  function close() { if (busy) return; if (started) void submit(); else onClose(); }
  return <dialog ref={dialog} className="animal-edit" aria-labelledby="animal-delete-title" onCancel={e => { e.preventDefault(); close(); }}>
    <header className="animal-edit-heading"><h2 id="animal-delete-title">개체 삭제</h2><button type="button" className="icon-button" aria-label="삭제 확인 닫기" disabled={busy} onClick={close}><X size={20}/></button></header>
    <div className="animal-edit-body">
      <div className="animal-delete-notice"><strong>{name}</strong><p>이 개체를 삭제하시겠습니까? 삭제한 개체와 관련 기록은 복구할 수 없습니다.</p><p>목록과 공개 페이지에서 먼저 제외합니다. 사진 정리가 끝난 뒤 저장 공간과 등록 한도가 반영됩니다.</p></div>
      {error && <p className="notice" role="alert">{error}<PolicyRenewalLink message={error}/></p>}
      {started && <p className="edit-photo-hint">삭제 상태를 확인하고 있습니다. 응답을 받지 못했다면 다시 확인해주세요.</p>}
      {conflict && <button type="button" className="text-button" disabled={busy} onClick={() => void inspect()}>최신 상태 확인</button>}
      {navigation.blocked && <div data-navigation-prompt><p className="notice" role="alert">삭제 상태를 확인한 뒤 이동해주세요.</p><button ref={navigation.stayButton} className="text-button" onClick={navigation.stay}>계속 확인</button><button className="text-button" disabled={busy || conflict} onClick={() => void submit(true)}>삭제 상태 확인 후 이동</button></div>}
      <footer className="edit-actions"><button type="button" className="button ghost" disabled={busy || conflict} onClick={() => void submit()}>{started ? '삭제 상태 다시 확인' : '삭제하기'}</button><button type="button" className="text-button" disabled={busy} onClick={close}>{started ? '확인 후 닫기' : '취소'}</button></footer>
    </div>
  </dialog>;
}

export function PendingAnimalDeletions({ items, refresh }: { items: PendingAnimalDeletion[]; refresh: () => Promise<Dashboard> }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const submitting = useRef(false);
  async function retry(id: string) {
    if (submitting.current) return;
    submitting.current = true; setBusy(id); setError('');
    try { await serverRequest(`/api/animals/${id}/cleanup`, {}); await refresh(); }
    catch (reason) { setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(''); }
  }
  if (!items.length) return null;
  return <section className="animal-deletion-pending" aria-label="개체 삭제 정리 대기"><p>삭제한 개체의 사진을 정리하고 있습니다. 저장 공간과 등록 한도는 정리 후 반영됩니다.</p><ul>{items.map(item => <li key={item.id}><span>{item.name}</span><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void retry(item.id)} aria-label={`${item.name} 정리 다시 확인`}>{busy === item.id ? '확인 중' : '정리 다시 확인'}</button></li>)}</ul>{error && <p className="notice" role="alert">{error}<PolicyRenewalLink message={error}/></p>}</section>;
}
