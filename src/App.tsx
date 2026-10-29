import {SourcePage} from './components/SourcePage';
import {LegalPage,HelpPage,PolicyDialog} from './components/InformationPages';
import {authIssue,authIssueText,publicReturnPath,pendingPublicReturn,rememberPublicReturn} from './lib/authReturn';
import {Landing} from './components/Landing';
import {SourceBrand} from './components/ManagementShell';
import {recordPageView} from './lib/analytics';
import {Activity} from './components/Activity';
import {Comments,ManagedComments} from './components/Comments';
import {AccountWithdrawal,AccountDeletionProgress} from './components/AccountWithdrawal';
import {useUnsavedChanges} from './lib/useUnsavedChanges';
import {ProfileLikes,ExistingLikeRemoval} from './components/ProfileLikes';
import {Schedules,PublicSchedules} from './components/Schedules';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { ArrowUpRight, Check, CheckCircle2, ExternalLink, Eye, EyeOff, LoaderCircle, MessageSquare, Plus, ShieldCheck, Sprout, X } from 'lucide-react';
import { Gecko } from './components/Gecko';
import { AnimalDelete, PendingAnimalDeletions } from './components/AnimalDelete';
import { AnimalGrowth, PublicGrowth } from './components/AnimalGrowth';
import { DesignSettings, PublicSocials } from './components/DesignSettings';
import { ExternalLinks, PublicLinks } from './components/ExternalLinks';
import { AnimalEdit } from './components/AnimalEdit';
import { AnimalCollection } from './components/AnimalCollection';
import { ManagementShell, ManagementShare } from './components/ManagementShell';
import { animalSchema, formatBytes, profileSchema, sexLabels, statusLabels, userMessage, type Animal, type Dashboard, type Profile, type PublicPage } from './lib/domain';
import { configured, googleAuth, initialAuthIssue, localAuth, rpc, serverRequest, supabase } from './lib/supabase';
import { preparePhoto } from './lib/images';

function Brand() { return <SourceBrand/>; }
function Spinner() { return <div className="loading" role="status"><LoaderCircle className="spin" size={23}/> 불러오고 있어요</div>; }
function Notice({ children }: { children: ReactNode }) { return <p className="notice" role="alert">{children}</p>; }
function Modal({ title, children, onClose, narrow = false }: { title: string; children: ReactNode; onClose: () => void; narrow?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const element = ref.current; element?.showModal(); return () => { element?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className={narrow ? 'animal-edit' : 'modal'} aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); onClose(); }}><div className={narrow ? 'animal-edit-heading' : 'modal-heading'}><div>{!narrow && <span className="eyebrow">REPTILELINK</span>}<h2 id="modal-title">{title}</h2></div><button className="icon-button" aria-label="닫기" onClick={onClose}><X/></button></div>{narrow ? <div className="animal-edit-body">{children}</div> : children}</dialog>;
}
function Photo({ animal, full = false, plain = false }: { animal: Animal; full?: boolean; plain?: boolean }) {
  const [image, setImage] = useState('');
  const asset = animal.photos[0]?.asset_id;
  useEffect(() => { let active = true; setImage(''); if (asset) serverRequest<{ url: string }>(`/api/media/${asset}/${full ? 'original_display' : 'thumbnail'}`).then(data => { if (active) setImage(data.url); }).catch(() => {}); return () => { active = false; }; }, [asset, full]);
  return image ? <img className="animal-photo" src={image} alt={animal.name} loading="lazy" onError={() => setImage('')}/> : plain ? <div className="collection-photo-placeholder">사진 없음</div> : <div className="animal-placeholder"><Gecko variant={animal.sort_order || 0}/></div>;
}
function AnimalCard({ animal, managed = false, onOpen, onToggle,disabled=false }: { animal: Animal; managed?: boolean; onOpen: () => void; onToggle?: () => void;disabled?:boolean }) {
  return <article className="animal-card"><button className="card-image" disabled={disabled} onClick={onOpen} aria-label={`${animal.name} 상세 보기`}><Photo animal={animal}/>{!managed&&<span className="comment-count"><MessageSquare size={15}/><span>{animal.comment_count??0}</span></span>}<span className={`sex-pill ${animal.sex}`}>{sexLabels[animal.sex]}</span>{managed && <span className={`visibility-pill ${animal.is_public ? 'visible' : ''}`}>{animal.is_public ? <Eye size={13}/> : <EyeOff size={13}/>} {animal.is_public ? '공개' : '비공개'}</span>}</button><div className="card-content"><div className="card-title"><button disabled={disabled} onClick={onOpen}><h3>{animal.name}</h3></button><span className={`status-dot ${animal.listing_status}`}/></div><p>{animal.species}</p><div className="card-bottom"><span>{animal.morph || '모프 미입력'}</span>{managed ? <button className="text-button" onClick={onToggle}>{animal.is_public ? '비공개로 전환' : '공개로 전환'}</button> : <ArrowUpRight size={17}/>}</div></div></article>;
}
function AnimalDetail({ animal, onClose,onCount }: { animal: Animal; onClose: () => void;onCount:(n:number)=>void }) {
  const guard=useRef<(()=>boolean)|null>(null);
  return <Modal title={animal.name} onClose={()=>{if(guard.current?.()!==false)onClose();}} narrow><div className="detail-photo"><Photo animal={animal} full plain/></div><dl className="detail-info"><div><dt>종류</dt><dd>{animal.species}</dd></div><div><dt>모프</dt><dd>{animal.morph || '미입력'}</dd></div><div><dt>성별</dt><dd>{sexLabels[animal.sex]}</dd></div><div><dt>상태</dt><dd>{statusLabels[animal.listing_status]}</dd></div></dl><PublicGrowth key={animal.id} animalId={animal.id}/>{animal.description && <p className="detail-description">{animal.description}</p>}<Comments animalId={animal.id} closeGuard={guard} onClose={onClose} onCount={onCount}/></Modal>;
}

function AuthDestination({session,data,error,refresh,desiredPath,issue,handled}:{session:Session|null;data:Dashboard|null;error:string;refresh:()=>Promise<void>;desiredPath?:string|null;issue?:'cancelled'|'failed'|null;handled?:()=>void}) {
  const navigate=useNavigate(),location=useLocation(),decided=useRef(false);
  const failure=authIssue(location.search,location.hash)||issue;
  useEffect(()=>{if(decided.current)return;if(desiredPath!==undefined)rememberPublicReturn(desiredPath);if(failure){decided.current=true;handled?.();navigate('/auth/login',{replace:true,state:{authIssue:failure}});return;}if(!session){decided.current=true;navigate('/auth/login',{replace:true,state:{authIssue:'failed'}});return;}if(!data)return;decided.current=true;const ready=data.account_status==='active'&&Boolean(data.profile);navigate(ready?(pendingPublicReturn(true)||'/dashboard/animals'):'/dashboard/animals',{replace:true});},[session,data,desiredPath,failure,navigate,handled]);
  return error&&!data?<div className="not-found"><Notice>{error}</Notice><button className="button" onClick={()=>void refresh()}>다시 불러오기</button></div>:<Spinner/>;
}
function Login({session,data,error:dashboardError,refresh}:{session:Session|null;data:Dashboard|null;error:string;refresh:()=>Promise<void>}) {
  const location=useLocation(),query=new URLSearchParams(location.search),desiredPath=query.has('returnTo')?publicReturnPath(query.get('returnTo')):undefined;
  const incoming=(location.state as {authIssue?:'cancelled'|'failed'}|null)?.authIssue;
  const [busy,setBusy]=useState(false),[error,setError]=useState(incoming?authIssueText(incoming):''),[showIncoming,setShowIncoming]=useState(Boolean(incoming));
  useEffect(()=>{const query=new URLSearchParams(location.search);if(!session&&query.has('returnTo'))rememberPublicReturn(query.get('returnTo'));},[location.search,session]);
  if(session&&!showIncoming)return <AuthDestination session={session} data={data} error={dashboardError} refresh={refresh} desiredPath={desiredPath}/>;
  async function login(email:string){setBusy(true);setError('');try{const result=await supabase.auth.signInWithPassword({email,password:'Local-Reptilelink-Only-2026!'});if(result.error)throw result.error;setShowIncoming(false);}catch(reason){setError(userMessage(reason));}finally{setBusy(false);}}
  async function google(){setBusy(true);setError('');try{const result=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:`${window.location.origin}/auth/callback`}});if(result.error)throw result.error;}catch(reason){setError(userMessage(reason));setBusy(false);}}
  return <SourcePage><main className="source-auth-main"><h1>로그인</h1><div className="source-login-form"><p>Google 계정으로 로그인합니다.<br/>처음 이용하는 계정은 초대·승인이 필요합니다.</p>{!configured&&<Notice>개발 환경 설정이 필요합니다. 로컬 백엔드를 먼저 준비해주세요.</Notice>}{error&&<Notice>{error}</Notice>}<button className="button source-provider" disabled={!googleAuth||!configured||busy} onClick={()=>void google()}>Google 계정으로 시작하기</button>{!googleAuth&&<p className="source-preparation">Google 로그인 연결 전입니다.</p>}{session&&<Link className="button ghost" to="/dashboard/animals">마이페이지로 돌아가기</Link>}{localAuth&&<section className="local-login"><span className="local-badge">LOCAL DEVELOPMENT</span><p>로컬 인증·DB를 사용하는 개발용 계정입니다.</p><button className="button" disabled={busy||!configured} onClick={()=>void login('breeder-a@reptilelink.test')}>테스트 브리더로 로그인</button><button className="text-button" disabled={busy} onClick={()=>void login('breeder-b@reptilelink.test')}>다른 테스트 계정으로 로그인</button></section>}<p className="source-signup-help">렙타일링크 첫 이용도 Google 로그인으로 시작합니다.</p></div></main></SourcePage>;
}
function ProfileForm({ profile, refresh, onboarding = false,onLocked,email }: { profile: Profile | null; refresh: () => Promise<Dashboard|void>; onboarding?: boolean;onLocked?:(value:boolean)=>void;email?:string }) {
  const [slug, setSlug] = useState(profile?.slug || ''), [name, setName] = useState(profile?.display_name || ''), [bio, setBio] = useState(profile?.bio || ''), [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [uncertain,setUncertain]=useState(false),[privacyAccepted,setPrivacyAccepted]=useState(false),[policy,setPolicy]=useState<'terms'|'privacy'|null>(null);
  const dirty=profile?slug!==profile.slug||name!==profile.display_name||bio!==profile.bio:Boolean(slug||name||bio||accepted||privacyAccepted),locked=dirty||busy||uncertain;
  const navigation=useUnsavedChanges(locked,busy),policyTrigger=useRef<HTMLElement|null>(null),policyResumeFocus=useRef<HTMLElement|null>(null);
  useEffect(()=>{if(navigation.blocked&&policy){policyResumeFocus.current=policyTrigger.current;setPolicy(null);}},[navigation.blocked,policy]);
  function openPolicy(kind:'terms'|'privacy'){policyTrigger.current=document.activeElement as HTMLElement|null;setPolicy(kind);}
  function stayProfile(){navigation.stay();policyResumeFocus.current?.focus();policyResumeFocus.current=null;}
  useEffect(()=>{onLocked?.(locked);return()=>onLocked?.(false);},[locked,onLocked]);
  function accept(p:Profile){setSlug(p.slug);setName(p.display_name);setBio(p.bio);setUncertain(false);setSaved(false);}
  async function inspect(){if(busy)return false;setBusy(true);setError('');try{const d=await refresh();if(d?.profile)accept(d.profile);else if(onboarding&&d?.account_status==='active'){setSlug('');setName('');setBio('');setAccepted(false);setPrivacyAccepted(false);setUncertain(false);setSaved(false);}else throw new Error('NOT_FOUND');return true;}catch(reason){setUncertain(true);setError(userMessage(reason));return false;}finally{setBusy(false);}}
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSaved(false);
    const parsed = profileSchema.safeParse({ slug, name, bio });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (!profile && !(accepted&&privacyAccepted)) return setError('이용 안내와 개인정보 안내를 모두 확인해주세요.');
    setBusy(true);setUncertain(true);
    try { await rpc('save_profile', { p_slug: parsed.data.slug, p_name: parsed.data.name, p_bio: parsed.data.bio, p_expected: profile?.revision ?? 0, p_publish: profile?.is_published ?? false, p_accept_terms: accepted&&privacyAccepted }); const d=await refresh();if(!d?.profile)throw new Error('NOT_FOUND');accept(d.profile);setUncertain(false);if(!onboarding)setSaved(true); }
    catch (reason) { setError(userMessage(reason)); }
    finally { setBusy(false); }
  }
  return <form className={`profile-form source-profile-form ${onboarding?'source-onboarding-form':'source-basic-form'}`} onSubmit={submit}><fieldset disabled={busy||uncertain}>
    <label className="source-profile-row"><span>페이지 주소 <span aria-hidden="true">*</span></span><div className="source-slug"><div className="slug-input"><span>/u/</span><input aria-label="내 페이지 주소" value={slug} disabled={Boolean(profile?.first_published_at)} onChange={e=>setSlug(e.target.value.toLowerCase())} placeholder="your-id" maxLength={30} required/></div><small>영문 소문자·숫자·하이픈 3~30자. 처음 공개한 뒤에는 변경할 수 없어요.</small></div></label>
    <label className="source-profile-row"><span>이름 <span aria-hidden="true">*</span></span><input aria-label="브리더 이름" value={name} onChange={e=>setName(e.target.value)} placeholder="브리더 이름" required/></label>
    {!onboarding&&email&&<label className="source-profile-row"><span>이메일</span><input aria-label="로그인 계정 이메일" value={email} readOnly/></label>}
    <label className="source-profile-row"><span>소개</span><div className="source-bio"><textarea aria-label="소개" value={bio} onChange={e=>setBio(e.target.value)} placeholder="소개를 입력해주세요" rows={4}/><small className="character-count">{[...bio].length}/300</small></div></label>
    {!profile&&<div className="source-consents"><label className="source-consent-all"><input type="checkbox" checked={accepted&&privacyAccepted} onChange={e=>{setAccepted(e.target.checked);setPrivacyAccepted(e.target.checked);}}/>필수 안내 전체 동의</label><div><label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>(필수) 테스트용 이용 안내 확인</label><button type="button" aria-label="이용 안내 보기" onClick={()=>openPolicy('terms')}>›</button></div><div><label><input type="checkbox" checked={privacyAccepted} onChange={e=>setPrivacyAccepted(e.target.checked)}/>(필수) 개인정보 안내 확인</label><button type="button" aria-label="개인정보 안내 보기" onClick={()=>openPolicy('privacy')}>›</button></div><p>현재 문서는 개발 확인용입니다. 운영용 약관·개인정보 처리방침은 준비 중입니다.</p></div>}
  </fieldset>{error && <Notice>{error}</Notice>}{(dirty||uncertain)&&<button type="button" className="text-button" disabled={busy} onClick={()=>void inspect()}>{uncertain?'저장 상태 확인':'변경 취소'}</button>}{navigation.blocked&&<div data-navigation-prompt><p className="notice" role="alert">적용하지 않은 기본정보가 있습니다.</p><button ref={navigation.stayButton} type="button" className="text-button" onClick={stayProfile}>계속 수정</button><button type="button" className="text-button" disabled={busy} onClick={async()=>{if(await inspect())navigation.leave();}}>최신 정보 확인 후 이동</button></div>}{saved && <p className="success" role="status"><CheckCircle2 size={16}/> 프로필을 저장했어요.</p>}<button className="button form-submit" disabled={busy||uncertain}>{busy ? <LoaderCircle className="spin" size={18}/> : null}{onboarding ? '내 공간 만들기' : '적용하기'}</button>{policy&&!navigation.blocked&&<PolicyDialog privacy={policy==='privacy'} onClose={()=>setPolicy(null)}/>}</form>;
}
function AnimalForm({ profile, refresh, onClose }: { profile: Profile; refresh: () => Promise<void>; onClose: () => void }) {
  const [values, setValues] = useState({ name: '', species: '크레스티드 게코', morph: '', sex: 'unknown', description: '', listing_status: 'not_listed', is_public: true });
  const [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(''), [partial, setPartial] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const field = (key: keyof typeof values, value: string | boolean) => setValues(previous => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); const parsed = animalSchema.safeParse(values);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (files.length > 3) return setError('사진은 최대 3장까지 선택할 수 있어요.');
    setBusy(true); let created = false;
    try {
      setProgress('사진을 준비하고 있어요');
      const photos = await Promise.all(files.map(preparePhoto));
      setProgress('개체 정보를 저장하고 있어요');
      const result = await rpc<{ id: string; revision: number }>('create_animal', { p_data: { ...parsed.data, is_public: photos.length ? false : parsed.data.is_public }, p_expected: profile.revision, p_request_id: requestId.current });
      created = true; let revision = result.revision;
      for (let index = 0; index < photos.length; index++) {
        setProgress(`사진 ${index + 1}/${photos.length} 업로드 중`);
        const upload = await serverRequest<{ asset_id: string; objects: { path: string; variant: keyof typeof photos[number]; token: string }[] }>('/api/uploads', { animal_id: result.id });
        try {
          for (const object of upload.objects) { const { error: uploadError } = await supabase.storage.from('animal-media').uploadToSignedUrl(object.path, object.token, photos[index][object.variant], { contentType: 'image/webp', upsert: false }); if (uploadError) throw uploadError; }
          await serverRequest(`/api/uploads/${upload.asset_id}/complete`, {});
          const attached = await rpc<{ revision: number }>('attach_photo', { p_asset_id: upload.asset_id, p_expected: revision }); revision = attached.revision;
        } catch (reason) { await serverRequest(`/api/uploads/${upload.asset_id}/cancel`, {}).catch(() => {}); throw reason; }
      }
      if (photos.length && parsed.data.is_public) await rpc('set_animal_public', { p_animal_id: result.id, p_public: true, p_expected: revision });
      await refresh(); onClose();
    } catch (reason) { setPartial(created); setError(created ? '개체는 비공개로 저장됐지만 사진 처리를 마치지 못했습니다. 목록에서 확인해주세요.' : userMessage(reason)); await refresh(); }
    finally { setBusy(false); }
  }
  return <Modal title="새로운 아이 등록" onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit} className="animal-form"><label className="photo-upload"><Plus size={25}/><strong>아이의 사진을 올려주세요</strong><small>{files.length ? `${files.length}장 선택됨` : 'JPG, PNG, WebP · 최대 3장'}</small><input aria-label="개체 사진" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => { const selected = Array.from(e.target.files || []); if (selected.length > 3) { setError('사진은 최대 3장까지 선택해주세요.'); e.target.value = ''; setFiles([]); } else { setFiles(selected); setError(''); } }}/></label><label>이름 <span>*</span><input aria-label="개체 이름" value={values.name} maxLength={40} placeholder="아이의 이름을 입력해주세요" onChange={e => field('name', e.target.value)} required/></label><div className="form-grid"><label>종류 <span>*</span><input aria-label="종류" list="species" value={values.species} maxLength={80} onChange={e => field('species', e.target.value)} required/><datalist id="species"><option>크레스티드 게코</option><option>레오파드 게코</option><option>볼파이톤</option><option>리키에너스</option></datalist></label><label>성별<select aria-label="성별" value={values.sex} onChange={e => field('sex', e.target.value)}><option value="unknown">미구분</option><option value="male">수컷</option><option value="female">암컷</option></select></label></div><label>모프<input aria-label="모프" value={values.morph} maxLength={120} placeholder="예: 릴리화이트" onChange={e => field('morph', e.target.value)}/></label><label>소개<textarea aria-label="개체 소개" value={values.description} maxLength={500} rows={3} placeholder="아이만의 특징을 기록해주세요" onChange={e => field('description', e.target.value)}/></label><label className="check-label"><input type="checkbox" checked={values.is_public} onChange={e => field('is_public', e.target.checked)}/><span>공개 페이지에 보여주기<small>브리더 페이지도 공개 상태여야 방문자에게 보여요.</small></span></label>{error && <Notice>{error}</Notice>}{busy && <p className="upload-progress" role="status"><LoaderCircle className="spin" size={16}/>{progress}</p>}<div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>닫기</button><button className="button" disabled={busy || partial}>{busy ? '저장 중' : '개체 등록하기'}<Check size={16}/></button></div></form></Modal>;
}

function DashboardPage({ data, refresh, refreshCollection, onSignOut,email }: { data: Dashboard; refresh: () => Promise<void>; refreshCollection: () => Promise<Dashboard>; onSignOut: () => void;email?:string }) {
  const location = useLocation(); const activity = location.pathname.startsWith('/dashboard/activity'), schedules = location.pathname.startsWith('/dashboard/schedules'), basic = location.pathname.startsWith('/dashboard/account'), design = location.pathname.startsWith('/dashboard/design'), links = location.pathname.startsWith('/dashboard/links');
  const [creating, setCreating] = useState(false), [editing, setEditing] = useState<Animal | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false), [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState<Animal | null>(null);
  const [growing, setGrowing] = useState<Animal | null>(null);
  const [comments,setComments]=useState<Animal|null>(null);
  useEffect(() => { setEditing(null); setDeleting(null); setGrowing(null);setComments(null); }, [location.pathname]);
  const [collectionLocked, setCollectionLocked] = useState(false),[withdrawalLocked,setWithdrawalLocked]=useState(false);
  const profile = data.profile!;
  async function togglePage() { setBusy(true); setError(''); try { await rpc('set_profile_public', { p_public: !profile.is_published, p_expected: profile.revision }); await refresh(); } catch (reason) { setError(userMessage(reason)); await refresh(); } finally { setBusy(false); } }
  const publicUrl = `${window.location.origin}/u/${profile.slug}`;
  async function copyAddress() {
    if (!profile.is_published) { setError('페이지를 공개한 뒤 링크를 복사해주세요.'); return; }
    try { await navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('주소를 직접 복사해주세요.'); }
  }
  return <ManagementShell basic={basic} locked={collectionLocked||withdrawalLocked} onSignOut={onSignOut}>
    <main className="management-content">
      <h1 className="sr-only">{activity ? '통계/알림' : schedules ? '일정 관리' : basic ? '기본 정보' : design ? '디자인 설정' : links ? '링크 관리' : '개체 관리'}</h1>
      <ManagementShare url={publicUrl} copied={copied} onCopy={copyAddress}/>
      <section className="management-publication" aria-label="페이지 공개 설정">
        <span>{profile.is_published ? '공개 중' : '비공개'}</span>
        {profile.is_published && <Link to={`/u/${profile.slug}`} target="_blank" rel="noopener noreferrer" aria-label="공개 페이지 열기">내 페이지 보기 <ExternalLink size={12}/></Link>}
        <button className="text-button" disabled={busy || collectionLocked||withdrawalLocked} onClick={togglePage}>{profile.is_published ? '비공개로 전환' : '페이지 공개하기'}</button>
      </section>
      {error && <Notice>{error}</Notice>}
      {saved && <p role="status" className="success">개체 정보를 저장했어요.</p>}
      {activity ? <Activity onLocked={setCollectionLocked}/> : schedules ? <Schedules revision={profile.revision} refreshDashboard={refreshCollection} onLocked={setCollectionLocked}/> : basic ? <section className="management-profile"><ProfileForm key={profile.id} profile={profile} email={email} refresh={refreshCollection} onLocked={setCollectionLocked}/><p className="management-usage">사진 저장 공간 {formatBytes(data.usage?.stored_bytes || 0)} / 20 MB · 정리 대기 {formatBytes(data.usage?.reserved_bytes || 0)}</p><AccountWithdrawal expected={profile.revision} disabled={collectionLocked} refresh={refreshCollection} onLocked={setWithdrawalLocked}/></section>
        : design ? <DesignSettings revision={profile.revision} refreshDashboard={refreshCollection} onLocked={setCollectionLocked}/> : links ? <ExternalLinks revision={profile.revision} refreshDashboard={refreshCollection} onLocked={setCollectionLocked}/> : <AnimalCollection animals={data.animals} revision={profile.revision} active={!editing && !creating && !deleting && !growing&&!comments} onCreate={() => setCreating(true)} onEdit={animal => { setSaved(false); setEditing(animal); }} refresh={refreshCollection} onLocked={setCollectionLocked} photo={animal => <Photo animal={animal} plain/>}/>}
      {!activity && !schedules && !basic && !design && !links && <PendingAnimalDeletions items={data.pending_deletions ?? []} refresh={refreshCollection}/>}
    </main>
    {deleting && <AnimalDelete animal={deleting} revision={profile.revision} refresh={refreshCollection} onClose={() => setDeleting(null)}/>}
    {comments&&<ManagedComments animalId={comments.id} onClose={()=>setComments(null)}/>}
    {growing && <AnimalGrowth animal={growing} refresh={refreshCollection} onClose={() => setGrowing(null)}/>}
    {creating && <AnimalForm profile={profile} refresh={refresh} onClose={() => setCreating(false)}/>}
    {editing && <AnimalEdit animal={editing} revision={profile.revision} renderPhoto={id => <Photo animal={{ ...editing, photos: [{ asset_id: id, sort_order: 0 }] }} full plain/>} reconcile={refreshCollection} onClose={() => setEditing(null)} onSaved={async () => { await refreshCollection(); setEditing(null); setSaved(true); }} onComments={animal=>{setEditing(null);setComments(animal);}} onDelete={animal => { setEditing(null); setDeleting(animal); }} onGrowth={animal => { setEditing(null); setGrowing(animal); }}/>}
  </ManagementShell>;
}

function PublicView() {
  const [reactionLocked,setReactionLocked]=useState(false);
  const { slug, id } = useParams(); const [data, setData] = useState<PublicPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(false), [selected, setSelected] = useState<Animal | null>(null);
  useEffect(() => { let active = true; setSelected(null);setLoading(true); setError(false); const bootstrap = document.getElementById('public-bootstrap'); bootstrap?.remove(); let initial: PublicPage | null = null; if (bootstrap?.textContent) { try { const candidate = JSON.parse(bootstrap.textContent); if (candidate.profile.slug === slug) initial = candidate; } catch { /* Ignore invalid bootstrap and use the authoritative API. */ } }
    (initial ? Promise.resolve(initial) : rpc<PublicPage | null>('public_page', { p_slug: slug })).then(result => { if (!active) return; setData(result); if (id) { const found = result?.animals.find(a => a.id === id); if (found) setSelected(found); else setError(true); } if(result&&(!id||result.animals.some(a=>a.id===id)))void recordPageView(result.profile.slug); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [slug, id]);
  if (loading) return <Spinner/>;
  if (!data || error) return <div className="not-found"><Sprout size={38}/><h1>페이지를 찾을 수 없어요</h1><p>공개된 주소인지 확인해주세요.</p>{slug&&<ExistingLikeRemoval key={slug} slug={slug}/>}<Link className="button" to="/">홈으로 돌아가기</Link></div>;
  return <div className="public-shell"><header className="site-header"><Brand/><Link className="text-button" to="/auth/login">나도 시작하기 <ArrowUpRight size={15}/></Link></header><main className="public-page"><ProfileLikes key={data.profile.slug} profile={data.profile} initialCount={data.like_count} onLocked={setReactionLocked}/><section className="public-intro">{data.profile.tagline&&<p className="public-tagline">{data.profile.tagline}</p>}<h1>{data.profile.display_name}</h1>{data.profile.bio&&<p className="public-bio">{data.profile.bio}</p>}</section><PublicSchedules rows={data.schedules ?? []} serverNow={data.server_now} slug={data.profile.slug}/><div className="public-animals">{data.animals.length ? data.animals.map(animal => <AnimalCard key={animal.id} animal={animal} disabled={reactionLocked} onOpen={() => setSelected(animal)}/>) : <p className="public-empty">곧 우리 아이들의 이야기가 시작됩니다.</p>}</div><PublicLinks links={data.links ?? []}/><PublicSocials links={data.socials ?? []}/><div className="public-bottom"><span>GROWING, ONE MOMENT AT A TIME.</span><Brand/></div></main>{selected && <AnimalDetail animal={selected} onClose={() => setSelected(null)} onCount={n=>setData(current=>current?{...current,animals:current.animals.map(a=>a.id===selected.id?{...a,comment_count:n}:a)}:current)}/>}</div>;
}

export default function App() {
  const [onboardingLocked,setOnboardingLocked]=useState(false),[callbackIssue,setCallbackIssue]=useState(initialAuthIssue);
  const clearCallbackIssue=useCallback(()=>setCallbackIssue(null),[]);
  const [session, setSession] = useState<Session | null>(null), [authLoading, setAuthLoading] = useState(true), [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState('');
  const identity=useRef<string|null>(null);
  useEffect(()=>{let active=true;supabase.auth.getSession().then(({data:auth})=>{if(active){identity.current=auth.session?.user.id??null;setSession(previous=>previous?.access_token===auth.session?.access_token?previous:auth.session);setAuthLoading(false);}});const listener=supabase.auth.onAuthStateChange((_event,current)=>{const next=current?.user.id??null;if(identity.current!==next){identity.current=next;setData(null);setError('');}setSession(previous=>previous?.access_token===current?.access_token?previous:current);});return()=>{active=false;listener.data.subscription.unsubscribe();};},[]);
  const refresh = useCallback(async () => { if (!session) { setData(null); return; } try { setData(await rpc<Dashboard>('my_dashboard')); setError(''); } catch (reason) { setError(userMessage(reason)); } }, [session]);
  const refreshCollection = useCallback(async () => {
    if (!session) throw new Error('UNAUTHENTICATED');
    const authoritative = await rpc<Dashboard>('my_dashboard');
    setData(authoritative); setError(''); return authoritative;
  }, [session]);
  useEffect(() => { void refresh(); }, [refresh]);
  const protectedView = (onboarding: boolean) => {
    if (authLoading) return <Spinner/>;
    if (!session) return <Navigate to="/auth/login" replace/>;
    if (error&&!data) return <div className="not-found"><Notice>{error}</Notice><button className="button" onClick={refresh}>다시 불러오기</button></div>;
    if (!data) return <Spinner/>;
    if (data.account_status==='deleting'||data.account_status==='deleted')return <AccountDeletionProgress data={data} refresh={refreshCollection}/>;
    if (data.account_status !== 'active') return <div className="not-found"><ShieldCheck size={40}/><h1>승인을 기다리고 있어요</h1><p>초대된 계정의 이용 승인이 끝나면 내 공간을 만들 수 있어요.</p><button className="button ghost" onClick={() => supabase.auth.signOut()}>로그아웃</button><AccountWithdrawal expected={null} refresh={refreshCollection}/></div>;
    if (!data.profile) return onboarding ? <SourcePage signedIn locked={onboardingLocked} onSignOut={()=>void supabase.auth.signOut()}><main className="source-onboarding-main"><h1>회원가입</h1><ProfileForm profile={null} refresh={refreshCollection} onboarding onLocked={setOnboardingLocked}/><AccountWithdrawal expected={null} disabled={onboardingLocked} refresh={refreshCollection}/></main></SourcePage> : <Navigate to="/onboarding" replace/>;
    if (onboarding) return <AuthDestination session={session} data={data} error={error} refresh={refresh}/>;
    return <DashboardPage data={data} email={session.user.email} refresh={refresh} refreshCollection={refreshCollection} onSignOut={() => supabase.auth.signOut()}/>;
  };
  return <Routes><Route path="/" element={<Landing signedIn={Boolean(session)}/>}/><Route path="/auth/login" element={authLoading ? <Spinner/> : <Login session={session} data={data} error={error} refresh={refresh}/>}/><Route path="/auth/callback" element={authLoading ? <Spinner/> : <AuthDestination session={session} data={data} error={error} refresh={refresh} issue={callbackIssue} handled={clearCallbackIssue}/>}/><Route path="/onboarding" element={protectedView(true)}/><Route path="/dashboard/*" element={protectedView(false)}/><Route path="/u/:slug" element={<PublicView/>}/><Route path="/u/:slug/animals/:id" element={<PublicView/>}/><Route path="/help" element={<HelpPage signedIn={Boolean(session)} onSignOut={()=>void supabase.auth.signOut()}/>}/><Route path="/terms" element={<LegalPage privacy={false} signedIn={Boolean(session)} onSignOut={()=>void supabase.auth.signOut()}/>}/><Route path="/privacy" element={<LegalPage privacy signedIn={Boolean(session)} onSignOut={()=>void supabase.auth.signOut()}/>}/><Route path="*" element={<div className="not-found"><h1>페이지를 찾을 수 없어요.</h1><Link to="/">홈으로</Link></div>}/></Routes>;
}
