import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { animalEditSchema, seoulDate, sexLabels, statusLabels, userMessage, type Animal, type AnimalEditInput, type Dashboard } from '../lib/domain';
import { rpc } from '../lib/supabase';

function fields(animal: Animal): AnimalEditInput {
  return { name: animal.name, species: animal.species, morph: animal.morph, sex: animal.sex,
    birth_date: animal.birth_date ?? null, description: animal.description, listing_status: animal.listing_status };
}

export function AnimalEdit({ animal, revision, preview, onClose, onSaved }: {
  animal: Animal; revision: number; preview?: ReactNode; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initial = useRef(fields(animal));
  const [values, setValues] = useState(initial.current);
  const [expected, setExpected] = useState(revision);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<{ data: AnimalEditInput; revision: number } | null>(null);
  const request = useRef<{ body: string; id: string } | null>(null);
  const submitting = useRef(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial.current);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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
    const body = JSON.stringify(parsed.data);
    if (request.current?.body !== body) request.current = { body, id: crypto.randomUUID() };
    try {
      await rpc('update_animal', { p_animal_id: animal.id, p_data: parsed.data, p_expected: expected, p_request_id: request.current.id });
      await onSaved();
    } catch (reason) {
      const message = String((reason as { message?: string })?.message ?? reason);
      if (/VERSION_CONFLICT|REQUEST_EXPIRED|REQUEST_CONFLICT/.test(message)) { setConflict(true); setLatest(null); }
      setError(userMessage(reason));
    } finally { submitting.current = false; setBusy(false); }
  }
  async function inspectLatest() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const current = await rpc<Dashboard>('my_dashboard');
      const found = current.animals.find(item => item.id === animal.id);
      if (current.account_status !== 'active' || !current.profile || !found) throw new Error('NOT_FOUND');
      setLatest({ data: fields(found), revision: current.profile.revision });
      setError('최신 저장값을 확인한 뒤 입력을 유지할지 선택해주세요.');
    } catch (reason) { setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  function acceptLatest(keepInput: boolean) {
    if (!latest) return;
    if (!keepInput) setValues(latest.data);
    initial.current = latest.data;
    setExpected(latest.revision); setConflict(false); setLatest(null); request.current = null;
    setInvalid({}); setError('최신 저장값을 확인했습니다. 입력을 검토한 뒤 저장해주세요.');
  }
  const inputProps = (key: keyof AnimalEditInput) => ({ 'aria-invalid': Boolean(invalid[key]),
    'aria-describedby': invalid[key] ? `edit-error-${key}` : undefined });
  const problem = (key: keyof AnimalEditInput) => invalid[key] && <small id={`edit-error-${key}`} className="edit-field-error">{invalid[key]}</small>;

  return <dialog ref={dialog} className="animal-edit" aria-labelledby="animal-edit-title"
    onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <header className="animal-edit-heading"><h2 id="animal-edit-title">개체 수정</h2>
      <button type="button" className="icon-button" aria-label="편집 닫기" disabled={busy} onClick={onClose}><X size={20}/></button></header>
    <form noValidate onSubmit={submit} className="animal-edit-body">
      {preview && <div className="edit-photo">{preview}</div>}
      <fieldset disabled={busy} className="edit-sex"><legend>성별</legend>
        {(['male', 'female', 'unknown'] as const).map(sex => <label key={sex}><input type="radio" name="edit-sex" value={sex}
          checked={values.sex === sex} onChange={() => field('sex', sex)}/>{sexLabels[sex]}</label>)}
      </fieldset>
      <fieldset disabled={busy} className="edit-fields"><legend className="sr-only">개체 일반 정보</legend>
        <label><span>이름</span><input aria-label="개체 이름" value={values.name} onChange={e => field('name', e.target.value)} {...inputProps('name')}/>{problem('name')}</label>
        <label><span>종류</span><input aria-label="종류" list="edit-species" value={values.species} onChange={e => field('species', e.target.value)} {...inputProps('species')}/>{problem('species')}</label>
        <label><span>모프</span><input aria-label="모프" value={values.morph} onChange={e => field('morph', e.target.value)} {...inputProps('morph')}/>{problem('morph')}</label>
        <label><span>해칭일</span><input aria-label="생일" type="date" max={seoulDate()} value={values.birth_date ?? ''}
          onChange={e => field('birth_date', e.target.value || null)} {...inputProps('birth_date')}/>{problem('birth_date')}</label>
        <label><span>분양 상태</span><select aria-label="분양 상태" value={values.listing_status}
          onChange={e => field('listing_status', e.target.value as AnimalEditInput['listing_status'])}>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="edit-description"><span>설명</span><textarea aria-label="개체 설명" rows={4} value={values.description}
          onChange={e => field('description', e.target.value)} {...inputProps('description')}/>{problem('description')}</label>
      </fieldset>
      <datalist id="edit-species"><option value="크레스티드 게코"/><option value="볼파이톤"/><option value="레오파드 게코"/></datalist>
      {error && <p className="notice" role="alert">{error}</p>}
      {conflict && <div className="edit-conflict">
        {!latest ? <button type="button" className="button ghost" disabled={busy} onClick={inspectLatest}>최신 값 확인</button> : <>
          <dl className="detail-info" aria-label="최신 저장값">{Object.entries(latest.data).map(([key, value]) =>
            <div key={key}><dt>{{ name: '이름', species: '종류', morph: '모프', sex: '성별', birth_date: '생일', description: '설명', listing_status: '분양 상태' }[key]}</dt>
              <dd>{key === 'sex' ? sexLabels[value as keyof typeof sexLabels] : key === 'listing_status' ? statusLabels[value as keyof typeof statusLabels] : value || '미입력'}</dd></div>)}</dl>
          <button type="button" className="text-button" onClick={() => acceptLatest(true)}>내 입력 유지</button>
          <button type="button" className="text-button" onClick={() => acceptLatest(false)}>최신값으로 바꾸기</button>
        </>}
      </div>}
      <footer className="edit-actions"><button className="button" disabled={busy || conflict}>{busy ? '저장 중' : '저장'}</button>
        <button type="button" className="button ghost" disabled={busy} onClick={onClose}>취소</button></footer>
    </form>
  </dialog>;
}
