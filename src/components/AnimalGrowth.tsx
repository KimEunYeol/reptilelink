import { useEffect, useRef, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { userMessage, type Animal, type Dashboard } from '../lib/domain';
import { growthCoordinates, growthDelta, growthDraft, growthPeriods, growthProblem, type GrowthDraft, type GrowthPeriod, type GrowthView, type OwnerGrowth } from '../lib/growth';
import { useUnsavedChanges } from '../lib/useUnsavedChanges';

export function GrowthChart({ data }: { data: GrowthView }) {
  if (!data.chart.length) return <p className="growth-empty">선택한 기간의 기록이 없습니다.</p>;
  const chart = growthCoordinates(data.chart, data.from, data.to);
  return <figure className="growth-chart"><svg viewBox="0 0 300 180" role="img" aria-label={`${data.from}부터 ${data.to}까지 실제 체중 기록 ${data.chart.length}개`}>
    {[0, 1, 2, 3].map(i => { const y = 25 + i * 125 / 3; return <g key={i}><line x1="45" x2="280" y1={y} y2={y} stroke="#f1f1f1"/><text x="39" y={y + 4} textAnchor="end">{Number((chart.high - i * (chart.high - chart.low) / 3).toFixed(2))}</text></g>; })}
    <line x1="45" x2="45" y1="25" y2="150" stroke="#ddd"/><line x1="45" x2="280" y1="150" y2="150" stroke="#ddd"/>
    <polyline points={chart.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#bdecc9" strokeWidth="3"/>
    {chart.points.map(p => <circle key={p.measured_on} cx={p.x} cy={p.y} r="4" fill="#2cbb50" stroke="white" strokeWidth="2"><title>{p.measured_on}: {p.weight_g}g</title></circle>)}
    <text x="45" y="173">{data.from.slice(5)}</text><text x="280" y="173" textAnchor="end">{data.to.slice(5)}</text>
  </svg><figcaption>{data.from} ~ {data.to} · g · 기록된 날짜만 표시</figcaption></figure>;
}

export function PublicGrowth({ animalId }: { animalId: string }) {
  const [data, setData] = useState<GrowthView | null>(null), [period, setPeriod] = useState<GrowthPeriod>('month'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const serial = useRef(0);
  async function load(p: GrowthPeriod, more = false) {
    const seq = ++serial.current, before = more ? data?.next_before : null;
    setBusy(true); setError('');
    if (!more) setData(null);
    try { const next = await rpc<GrowthView | null>('public_animal_growth', { p_animal_id: animalId, p_period: p, p_before: before ?? null }); if (serial.current === seq) setData(previous => next && more && previous ? { ...next, records: [...previous.records, ...next.records] } : next); }
    catch (reason) { if (serial.current === seq) { setData(null); setError(userMessage(reason)); } }
    finally { if (serial.current === seq) setBusy(false); }
  }
  useEffect(() => { void load('month'); return () => { serial.current++; }; }, [animalId]);
  if (!data && !error) return null;
  return <section className="growth-section" aria-label="공개 성장 기록"><div className="growth-weight"><span>체중</span><strong>{data?.latest ? `${data.latest.weight_g}g` : '기록 없음'}</strong></div><div className="growth-periods">{growthPeriods.map(([p, label]) => <button key={p} type="button" aria-pressed={period === p} disabled={busy} onClick={() => { setPeriod(p); void load(p); }}>{label}</button>)}</div>
    {error && <p className="notice" role="alert">{error}<button type="button" className="text-button" disabled={busy} onClick={() => void load(period)}>다시 불러오기</button></p>}
    {data && <><GrowthChart data={data}/><ul className="growth-records">{data.records.map(r => <li key={r.measured_on}><strong>{r.weight_g}g</strong><time>{r.measured_on}</time></li>)}</ul>{data.next_before && <button type="button" className="growth-more" disabled={busy} onClick={() => void load(period, true)}>더보기</button>}</>}
  </section>;
}

const errorCode = (reason: unknown) => String(reason && typeof reason === 'object' && 'message' in reason ? reason.message : reason);
const definitive = (reason: unknown) => /VERSION_CONFLICT|NOT_FOUND|VALIDATION_FAILED|QUOTA_EXCEEDED|SERVICE_UNAVAILABLE|CONSENT_REQUIRED|ACCOUNT_NOT_ACTIVE|REQUEST_CONFLICT|REQUEST_EXPIRED/.test(errorCode(reason));
type Command = { p_animal_id: string; p_data: { upsert: GrowthDraft[]; remove: string[]; note: string; show_growth: boolean }; p_expected: number; p_request_id: string };
export function AnimalGrowth({ animal, refresh, onClose }: { animal: Animal; refresh: () => Promise<Dashboard>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), submitting = useRef(false), pending = useRef<Command | null>(null), seq = useRef(0);
  const [data, setData] = useState<OwnerGrowth | null>(null), [baseline, setBaseline] = useState<GrowthDraft[]>([]), [rows, setRows] = useState<GrowthDraft[]>([]), [removed, setRemoved] = useState<string[]>([]);
  const [note, setNote] = useState(''), [show, setShow] = useState(false), [period, setPeriod] = useState<GrowthPeriod>('month'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [unresolved, setUnresolved] = useState(false), [conflict, setConflict] = useState(false), [latest, setLatest] = useState<OwnerGrowth | null>(null);
  const dirty = Boolean(data && (growthDelta(rows, baseline).length || removed.length || note !== data.note || show !== data.show_growth)) || unresolved;
  const navigation = useUnsavedChanges(dirty, busy);
  const fetchData = (p: GrowthPeriod, before: string | null = null) => rpc<OwnerGrowth>('my_animal_growth', { p_animal_id: animal.id, p_period: p, p_before: before });
  function accept(value: OwnerGrowth) { setData(value); setRows(value.records.map(growthDraft)); setBaseline(value.records.map(growthDraft)); setRemoved([]); setNote(value.note); setShow(value.show_growth); setUnresolved(false); setConflict(false); setLatest(null); pending.current = null; }
  useEffect(() => { const previous = document.querySelector<HTMLButtonElement>(`[data-collection-id="${animal.id}"] .collection-open`) ?? document.activeElement as HTMLElement | null; dialog.current?.showModal(); const request = ++seq.current; fetchData('month').then(value => { if (request === seq.current) accept(value); }).catch(reason => { if (request === seq.current) setError(userMessage(reason)); }); return () => { seq.current++; dialog.current?.close(); previous?.focus(); }; }, [animal.id]);
  async function retryInitial() { if (submitting.current) return; submitting.current = true; setError(''); const request = ++seq.current; try { const value = await fetchData(period); if (request === seq.current) accept(value); } catch (reason) { if (request === seq.current) setError(userMessage(reason)); } finally { submitting.current = false; } }
  async function readLatest() { const d = await refresh(); if (!d.animals.some(a => a.id === animal.id)) { onClose(); return null; } return fetchData(period); }
  async function settle() { if (!pending.current) return; try { await rpc('save_animal_growth', pending.current); } catch (reason) { if (!definitive(reason)) throw reason; pending.current = null; } }
  async function save() {
    if (submitting.current || conflict || !data) return;
    const upsert = growthDelta(rows, baseline), problem = growthProblem(rows, data.today, note);
    if (!pending.current && problem) { setError(problem); return; }
    if (!pending.current && (upsert.length > 100 || removed.length > 100)) { setError('한 번에 변경할 수 있는 기록은 100개입니다. 먼저 저장해주세요.'); return; }
    if (!pending.current) pending.current = { p_animal_id: animal.id, p_data: { upsert, remove: removed, note, show_growth: show }, p_expected: data.revision, p_request_id: crypto.randomUUID() };
    submitting.current = true; setBusy(true); setUnresolved(true); setError('');
    try { await rpc('save_animal_growth', pending.current); await refresh(); pending.current = null; setUnresolved(false); onClose(); }
    catch (reason) { if (definitive(reason)) { pending.current = null; setUnresolved(false); if (/VERSION_CONFLICT|NOT_FOUND/.test(errorCode(reason))) setConflict(true); } setError(userMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function discard(forNavigation = false) { if (submitting.current) return; submitting.current = true; setBusy(true); try { if (unresolved) { await settle(); await refresh(); pending.current = null; setUnresolved(false); } if (forNavigation) navigation.leave(); else onClose(); } catch (reason) { setError(userMessage(reason)); } finally { submitting.current = false; setBusy(false); } }
  async function inspect() { if (submitting.current) return; submitting.current = true; setBusy(true); setError(''); try { await settle(); const value = await readLatest(); if (value) { pending.current = null; setUnresolved(false); setLatest(value); setConflict(true); } } catch (reason) { setError(userMessage(reason)); } finally { submitting.current = false; setBusy(false); } }
  async function load(p: GrowthPeriod, more = false) {
    if (submitting.current || !data) return; submitting.current = true; setBusy(true); setError('');
    try { const value = await fetchData(p, more ? data.next_before : null); if (value.revision !== data.revision) { setConflict(true); setError('다른 화면에서 변경됐습니다. 최신 기록을 확인해주세요.'); return; }
      setData(old => old && ({ ...value, records: old.records, next_before: more ? value.next_before : old.next_before })); setPeriod(p);
      if (more) { const existing = new Set(baseline.map(r => r.id)), extra = value.records.filter(r => !existing.has(r.id)).map(growthDraft); setBaseline(old => [...old, ...extra]); setRows(old => [...old, ...extra]); }
    } catch (reason) { setError(userMessage(reason)); } finally { submitting.current = false; setBusy(false); }
  }
  function edit(id: string, field: 'measured_on' | 'weight_g' | 'note', value: string) { setRows(old => old.map(r => r.id === id ? { ...r, [field]: value } : r)); setError(''); }
  function remove(id: string) { setRows(old => old.filter(r => r.id !== id)); if (baseline.some(r => r.id === id)) setRemoved(old => [...old, id]); }
  return <dialog ref={dialog} className="animal-edit" aria-labelledby="growth-title" onCancel={e => { e.preventDefault(); void discard(); }}><header className="animal-edit-heading"><h2 id="growth-title">성장 기록</h2><button type="button" className="icon-button" aria-label="성장 기록 닫기" disabled={busy} onClick={() => void discard()}><X size={20}/></button></header><form className="animal-edit-body" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p className="growth-animal-name">{animal.name}</p>{error && <p className="notice" role="alert">{error}</p>}{!data && !error && <p role="status" className="edit-photo-hint">기록을 불러오고 있습니다.</p>}{!data && error && <button type="button" className="text-button" onClick={() => void retryInitial()}>다시 불러오기</button>}
    <fieldset className="growth-fields" disabled={busy || unresolved || conflict || !data}><legend className="sr-only">성장 기록 편집</legend>
      <div className="growth-weight"><span>체중</span><strong>{data?.latest ? `${data.latest.weight_g}g` : '기록 없음'}</strong></div><div className="growth-periods">{growthPeriods.map(([p, label]) => <button key={p} type="button" aria-pressed={period === p} onClick={() => void load(p)}>{label}</button>)}</div>
      {data && <GrowthChart data={data}/>}<p className="edit-photo-hint">그래프는 저장된 기록 기준입니다.</p>
      <button type="button" className="growth-add" aria-label="체중 기록 추가" onClick={() => setRows(old => [{ id: crypto.randomUUID(), measured_on: data!.today, weight_g: '', note: '' }, ...old])}><Plus size={20}/></button>
      <ul className="growth-records growth-editor">{rows.map((r, i) => <li key={r.id}><div className="growth-record-line"><label><span className="sr-only">{i + 1}번째 체중(g)</span><input inputMode="decimal" value={r.weight_g} onChange={e => edit(r.id, 'weight_g', e.target.value)} placeholder="g"/></label><label><span className="sr-only">{i + 1}번째 기록일</span><input type="date" max={data?.today} value={r.measured_on} onChange={e => edit(r.id, 'measured_on', e.target.value)}/></label><button type="button" className="icon-button" aria-label={`${i + 1}번째 기록 삭제`} onClick={() => remove(r.id)}><X size={14}/></button></div><label className="growth-note"><span>비공개 기록 메모</span><textarea aria-label="비공개 기록 메모" value={r.note} onChange={e => edit(r.id, 'note', e.target.value)} rows={1}/></label></li>)}</ul>
      {data?.next_before && <button type="button" className="growth-more" onClick={() => void load(period, true)}>더보기</button>}
      <label className="growth-note"><span>비공개 개체 메모</span><textarea aria-label="비공개 개체 메모" value={note} onChange={e => setNote(e.target.value)} rows={3}/></label>
      <label className="growth-consent"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)}/><span>공개 페이지에 체중과 성장 기록 표시</span></label><p className="edit-photo-hint">개체 공개와 별도 설정입니다. 메모는 공개하지 않습니다.</p>
    </fieldset>
    {(conflict || unresolved) && <button type="button" className="text-button" disabled={busy} onClick={() => void inspect()}>최신 기록 확인</button>}
    {latest && <section className="edit-conflict" aria-label="최신 성장 기록"><p>최신 기록 {latest.total}건 · 공개 {latest.show_growth ? '표시' : '숨김'}</p><p className="growth-private-preview">{latest.note}</p><button type="button" className="text-button" onClick={() => void navigator.clipboard.writeText([note, ...rows.map(r => `${r.measured_on} ${r.weight_g}g ${r.note}`)].join('\n')).catch(() => setError('입력 내용을 직접 복사해주세요.'))}>입력 복사</button><button type="button" className="text-button" disabled={busy} onClick={() => { accept(latest); setError('최신 기록을 불러왔습니다. 변경할 내용을 다시 확인해주세요.'); }}>최신 기록 사용</button></section>}
    {navigation.blocked && <div data-navigation-prompt><p className="notice" role="alert">저장하지 않은 성장 기록이 있습니다.</p><button ref={navigation.stayButton} type="button" className="text-button" onClick={navigation.stay}>계속 편집</button><button type="button" className="text-button" disabled={busy} onClick={() => void discard(true)}>변경 버리고 이동</button></div>}
    {unresolved && <p className="edit-photo-hint">저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하거나 취소해주세요.</p>}
    <footer className="edit-actions"><button className="button" disabled={busy || conflict || !data || !dirty}>{busy ? '저장 중' : unresolved ? '저장 다시 확인' : '저장'}</button><button type="button" className="button ghost" disabled={busy} onClick={() => void discard()}>취소</button></footer>
  </form></dialog>;
}
