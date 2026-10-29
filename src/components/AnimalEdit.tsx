import {PolicyRenewalLink} from './PolicyRenewalLink';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { animalEditSchema, seoulDate, sexLabels, statusLabels, userMessage, type Animal, type AnimalEditInput, type Dashboard } from '../lib/domain';
import { rpc } from '../lib/supabase';
import { AnimalPhotoDraft } from './AnimalPhotoDraft';
import { queuePhotoCleanup, uploadDraftPhotos, type PhotoDraft } from '../lib/photoDraft';
import { useUnsavedChanges } from '../lib/useUnsavedChanges';

function fields(animal: Animal): AnimalEditInput {
  return { name: animal.name, species: animal.species, morph: animal.morph, sex: animal.sex,
    birth_date: animal.birth_date ?? null, description: animal.description, listing_status: animal.listing_status };
}

export function AnimalEdit({ animal, revision, renderPhoto, reconcile, onClose, onSaved, onDelete, onGrowth,onComments }: {
  animal: Animal; revision: number; renderPhoto: (id: string) => ReactNode; reconcile: () => Promise<Dashboard>; onClose: () => void; onSaved: () => Promise<void>; onDelete?: (animal: Animal) => void; onGrowth?: (animal: Animal) => void;onComments?:(animal:Animal)=>void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initial = useRef(fields(animal));
  const initialPhotos = useRef(animal.photos.map(p => p.asset_id));
  const [photos, setPhotos] = useState<PhotoDraft[]>(animal.photos.map(p => ({ key: p.asset_id, asset_id: p.asset_id })));
  const uploaded = useRef(new Map<string, string>()), allocated = useRef(new Set<string>()), urls = useRef<string[]>([]);
  const [unresolved, setUnresolved] = useState(false), [progress, setProgress] = useState('');
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  const photosChanged = JSON.stringify(photos.map(p => p.key)) !== JSON.stringify(initialPhotos.current);
  const [values, setValues] = useState(initial.current);
  const [expected, setExpected] = useState(revision);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<{ data: AnimalEditInput; revision: number; photos: Animal['photos'] } | null>(null);
  const request = useRef<{ body: string; id: string } | null>(null);
  const pendingCommand = useRef<{ method: string; args: Record<string, unknown> } | null>(null);
  const submitting = useRef(false);
  const dirty = unresolved || photosChanged || JSON.stringify(values) !== JSON.stringify(initial.current);
  const navigation = useUnsavedChanges(dirty, busy);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);

  function field<K extends keyof AnimalEditInput>(key: K, value: AnimalEditInput[K]) {
    setValues(current => ({ ...current, [key]: value }));
    setInvalid(current => ({ ...current, [key]: '' }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || conflict) return;
    const parsed = animalEditSchema.safeParse(values);
    if (!parsed.success) {
      setInvalid(Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0],
        issue.code === 'custom' ? issue.message : '입력값을 확인해주세요.'])));
      setError('입력 내용을 확인해주세요.');
      return;
    }
    submitting.current = true; setBusy(true); setError(''); setInvalid({});
    let commandSent = false;
    try {
      const assets = photosChanged ? await uploadDraftPhotos(animal.id, photos, uploaded.current, allocated.current, setProgress) : undefined;
      const body = JSON.stringify({ data: parsed.data, assets });
      if (request.current?.body !== body) request.current = { body, id: crypto.randomUUID() };
      commandSent = true; setProgress('개체 정보를 저장하고 있어요.');
      pendingCommand.current = { method: photosChanged ? 'save_animal_edit' : 'update_animal', args: { p_animal_id: animal.id, p_data: parsed.data, p_expected: expected, p_request_id: request.current.id, ...(assets ? { p_assets: assets } : {}) } };
      await rpc(pendingCommand.current.method, pendingCommand.current.args);
      const retained = new Set(assets ?? initialPhotos.current);
      await queuePhotoCleanup([...allocated.current].filter(id => !retained.has(id))).catch(() => {});
      await onSaved();
    } catch (reason) {
      if (commandSent) setUnresolved(true);
      if (!commandSent) {
        const ready = new Set(uploaded.current.values());
        await queuePhotoCleanup([...allocated.current].filter(id => !ready.has(id))).catch(() => {});
      }
      const message = String((reason as { message?: string })?.message ?? reason);
      if (/VERSION_CONFLICT|REQUEST_EXPIRED|REQUEST_CONFLICT|NOT_FOUND|VALIDATION_FAILED/.test(message)) { setConflict(true); setLatest(null); }
      setError(userMessage(reason));
    } finally { submitting.current = false; setBusy(false); }
  }
  async function settlePending() {
    if (!unresolved || !pendingCommand.current) return;
    try { await rpc(pendingCommand.current.method, pendingCommand.current.args); }
    catch (reason) {
      // These are definitive rollbacks. A network failure remains unresolved.
      if (!/VERSION_CONFLICT|REQUEST_EXPIRED|REQUEST_CONFLICT|NOT_FOUND|VALIDATION_FAILED|SERVICE_UNAVAILABLE|QUOTA_EXCEEDED|CONSENT_REQUIRED/.test(String((reason as { message?: string })?.message ?? reason))) throw reason;
    }
  }
  async function inspectLatest() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      await settlePending();
      const current = await rpc<Dashboard>('my_dashboard');
      const found = current.animals.find(item => item.id === animal.id);
      if (current.account_status !== 'active' || !current.profile || !found) throw new Error('NOT_FOUND');
      setLatest({ data: fields(found), revision: current.profile.revision, photos: found.photos });
      setError('최신 저장값을 확인한 뒤 입력을 유지할지 선택해주세요.');
    } catch (reason) { setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  const unavailableDraftPhotos = latest && photos.some(photo => photo.asset_id && !latest.photos.some(saved => saved.asset_id === photo.asset_id));
  async function acceptLatest(keepInput: boolean, useLatestPhotos = false) {
    if (!latest || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      if (keepInput && photosChanged && unavailableDraftPhotos && !useLatestPhotos) {
        setError('다른 화면에서 교체·삭제된 사진이 초안에 있습니다. 일반 입력을 유지하려면 최신 사진 사용을 선택해주세요.');
        return;
      }
      const retained = new Set(latest.photos.map(p => p.asset_id));
      // Free staging slots before allowing another upload; physical bytes stay charged.
      await queuePhotoCleanup([...allocated.current].filter(id => !retained.has(id)));
      if (!keepInput) setValues(latest.data);
      if (!keepInput || !photosChanged || useLatestPhotos) setPhotos(latest.photos.map(p => ({ key: p.asset_id, asset_id: p.asset_id })));
      initialPhotos.current = latest.photos.map(p => p.asset_id);
      uploaded.current = new Map([...uploaded.current].filter(([, id]) => retained.has(id)));
      setUnresolved(false); initial.current = latest.data;
      setExpected(latest.revision); setConflict(false); setLatest(null); request.current = null; pendingCommand.current = null;
      setInvalid({}); setError('최신 저장값을 확인했습니다. 입력을 검토한 뒤 저장해주세요.');
    } catch (reason) { setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function discard(forNavigation = false) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      let retained = new Set(initialPhotos.current);
      if (unresolved) {
        await settlePending();
        const current = await reconcile(), found = current.animals.find(item => item.id === animal.id);
        if (current.account_status !== 'active' || !found) throw new Error('NOT_FOUND');
        retained = new Set(found.photos.map(p => p.asset_id));
      }
      await queuePhotoCleanup([...allocated.current].filter(id => !retained.has(id)));
      if (forNavigation) navigation.leave(); else onClose();
    } catch (reason) { setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function beginDelete() {
    if (dirty || conflict || submitting.current || !onDelete) return;
    submitting.current = true; setBusy(true);
    try {
      const d = await reconcile(), current = d.animals.find(item => item.id === animal.id);
      if (!current) throw new Error('NOT_FOUND');
      onDelete(current);
    } catch (reason) { setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function beginGrowth() {
    if (dirty || conflict || submitting.current || !onGrowth) return;
    submitting.current = true; setBusy(true);
    try { const d = await reconcile(), current = d.animals.find(item => item.id === animal.id); if (!current) throw new Error('NOT_FOUND'); onGrowth(current); }
    catch (reason) { setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  const inputProps = (key: keyof AnimalEditInput) => ({ 'aria-invalid': Boolean(invalid[key]),
    'aria-describedby': invalid[key] ? `edit-error-${key}` : undefined });
  const problem = (key: keyof AnimalEditInput) => invalid[key] && <small id={`edit-error-${key}`} className="edit-field-error">{invalid[key]}</small>;

  return <dialog ref={dialog} className="animal-edit" aria-labelledby="animal-edit-title"
    onCancel={event => { event.preventDefault(); if (!submitting.current) void discard(); }}>
    <header className="animal-edit-heading"><h2 id="animal-edit-title">개체 수정</h2>
      <button type="button" className="icon-button" aria-label="편집 닫기" disabled={busy} onClick={() => void discard()}><X size={20}/></button></header>
    <form noValidate onSubmit={submit} className="animal-edit-body">
      <AnimalPhotoDraft photos={photos} disabled={busy || unresolved || conflict} onChange={setPhotos} renderPhoto={renderPhoto} rememberUrl={url => urls.current.push(url)}/>
      <fieldset disabled={busy || unresolved} className="edit-sex"><legend>성별</legend>
        {(['male', 'female', 'unknown'] as const).map(sex => <label key={sex}><input type="radio" name="edit-sex" value={sex}
          checked={values.sex === sex} onChange={() => field('sex', sex)}/>{sexLabels[sex]}</label>)}
      </fieldset>
      <fieldset disabled={busy || unresolved} className="edit-fields"><legend className="sr-only">개체 일반 정보</legend>
        <label><span>이름</span><input aria-label="개체 이름" value={values.name} onChange={e => field('name', e.target.value)} {...inputProps('name')}/>{problem('name')}</label>
        <label><span>종류</span><input aria-label="종류" list="edit-species" value={values.species} onChange={e => field('species', e.target.value)} {...inputProps('species')}/>{problem('species')}</label>
        <label><span>모프</span><input aria-label="모프" value={values.morph} onChange={e => field('morph', e.target.value)} {...inputProps('morph')}/>{problem('morph')}</label>
        <label><span>해칭일</span><input aria-label="생일" type="date" max={seoulDate()} value={values.birth_date ?? ''}
          onChange={e => field('birth_date', e.target.value || null)} {...inputProps('birth_date')}/>{problem('birth_date')}</label>
        {onGrowth && <div className="growth-entry"><span>체중</span><button type="button" className="text-button" disabled={dirty || conflict || busy} onClick={() => void beginGrowth()}>성장 기록·메모 관리</button>{dirty && <small>편집 내용을 저장하거나 취소한 뒤 이동할 수 있습니다.</small>}</div>}
        <label><span>분양 상태</span><select aria-label="분양 상태" value={values.listing_status}
          onChange={e => field('listing_status', e.target.value as AnimalEditInput['listing_status'])}>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="edit-description"><span>설명</span><textarea aria-label="개체 설명" rows={4} value={values.description}
          onChange={e => field('description', e.target.value)} {...inputProps('description')}/>{problem('description')}</label>
      </fieldset>
      <datalist id="edit-species"><option value="크레스티드 게코"/><option value="볼파이톤"/><option value="레오파드 게코"/></datalist>
      {navigation.blocked && <div className="edit-conflict" data-navigation-prompt>
        <p className="notice" role="alert">{busy ? '저장 중입니다. 완료될 때까지 기다려주세요.' : '저장하지 않은 변경이 있습니다. 이동하면 입력 내용이 사라집니다.'}</p>
        <button ref={navigation.stayButton} type="button" className="text-button" onClick={navigation.stay}>계속 편집</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => void discard(true)}>변경 버리고 이동</button>
      </div>}
      {busy && <p className="edit-photo-hint" aria-live="polite">{progress}</p>}
      {unresolved && <p className="edit-photo-hint">저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 저장하거나 최신 값을 확인해주세요. 취소할 때도 실제 저장 상태를 확인합니다.</p>}
      {unresolved && !conflict && <button type="button" className="text-button" disabled={busy} onClick={() => { setConflict(true); setLatest(null); }}>최신 값 검토</button>}
      {error && <p className="notice" role="alert">{error}<PolicyRenewalLink message={error}/></p>}
      {conflict && <div className="edit-conflict">
        {!latest ? <button type="button" className="button ghost" disabled={busy} onClick={inspectLatest}>최신 값 확인</button> : <>
          <dl className="detail-info" aria-label="최신 저장값">{Object.entries(latest.data).map(([key, value]) =>
            <div key={key}><dt>{{ name: '이름', species: '종류', morph: '모프', sex: '성별', birth_date: '생일', description: '설명', listing_status: '분양 상태' }[key]}</dt>
              <dd>{key === 'sex' ? sexLabels[value as keyof typeof sexLabels] : key === 'listing_status' ? statusLabels[value as keyof typeof statusLabels] : value || '미입력'}</dd></div>)}</dl>
          <div role="group" aria-label="최신 사진"><p className="edit-photo-hint">저장된 사진 {latest.photos.length}장 · 첫 사진이 대표 사진입니다.</p>
            {latest.photos.map(photo => <div className="edit-photo" key={photo.asset_id}>{renderPhoto(photo.asset_id)}</div>)}
          </div>
          <button type="button" className="text-button" disabled={busy} onClick={() => void acceptLatest(true)}>내 입력 유지</button>
          {photosChanged && unavailableDraftPhotos && <button type="button" className="text-button" disabled={busy} onClick={() => void acceptLatest(true, true)}>입력 유지·최신 사진 사용</button>}
          <button type="button" className="text-button" disabled={busy} onClick={() => void acceptLatest(false)}>최신값으로 바꾸기</button>
        </>}
      </div>}
      <footer className="edit-actions"><button className="button" disabled={busy || conflict}>{busy ? '저장 중' : '저장'}</button>
        <button type="button" className="button ghost" disabled={busy} onClick={() => void discard()}>취소</button></footer>
      {onComments&&<div className="growth-entry"><span>댓글</span><button type="button" className="text-button" disabled={dirty||conflict||busy} onClick={()=>onComments(animal)}>댓글 관리</button>{dirty&&<small>편집 내용을 저장하거나 취소한 뒤 이동할 수 있습니다.</small>}</div>}
      {onDelete && <aside className="animal-delete-notice"><strong>개체 삭제</strong><p>삭제한 개체와 관련 기록은 복구할 수 없습니다.</p>{dirty && <p>편집 내용을 저장하거나 취소한 뒤 삭제할 수 있습니다.</p>}<button type="button" className="text-button" disabled={dirty || conflict || busy} onClick={() => void beginDelete()}>개체 삭제</button></aside>}
    </form>
  </dialog>;
}
