import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCircle2, Copy, ExternalLink, Eye, EyeOff, Leaf, Link2, LoaderCircle, LogOut, Plus, ShieldCheck, Sprout, X } from 'lucide-react';
import { Gecko } from './components/Gecko';
import { AnimalEdit } from './components/AnimalEdit';
import { AnimalCollection } from './components/AnimalCollection';
import { animalSchema, formatBytes, profileSchema, sexLabels, statusLabels, userMessage, type Animal, type Dashboard, type Profile, type PublicPage } from './lib/domain';
import { configured, googleAuth, localAuth, rpc, serverRequest, supabase } from './lib/supabase';
import { preparePhoto } from './lib/images';

function Brand() { return <Link className="brand" to="/" aria-label="렙타일링크 홈"><span className="brand-mark"><Sprout size={23}/></span><span>Reptile<span className="brand-light">Link</span><i /></span></Link>; }
function Spinner() { return <div className="loading" role="status"><LoaderCircle className="spin" size={23}/> 불러오고 있어요</div>; }
function Notice({ children }: { children: ReactNode }) { return <p className="notice" role="alert">{children}</p>; }
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); onClose(); }}><div className="modal-heading"><div><span className="eyebrow">REPTILELINK</span><h2 id="modal-title">{title}</h2></div><button className="icon-button" aria-label="닫기" onClick={onClose}><X/></button></div>{children}</dialog>;
}
function Photo({ animal, full = false, plain = false }: { animal: Animal; full?: boolean; plain?: boolean }) {
  const [image, setImage] = useState('');
  const asset = animal.photos[0]?.asset_id;
  useEffect(() => { let active = true; setImage(''); if (asset) serverRequest<{ url: string }>(`/api/media/${asset}/${full ? 'original_display' : 'thumbnail'}`).then(data => { if (active) setImage(data.url); }).catch(() => {}); return () => { active = false; }; }, [asset, full]);
  return image ? <img className="animal-photo" src={image} alt={animal.name} loading="lazy" onError={() => setImage('')}/> : plain ? <div className="collection-photo-placeholder">사진 없음</div> : <div className="animal-placeholder"><Gecko variant={animal.sort_order || 0}/></div>;
}
function AnimalCard({ animal, managed = false, onOpen, onToggle }: { animal: Animal; managed?: boolean; onOpen: () => void; onToggle?: () => void }) {
  return <article className="animal-card"><button className="card-image" onClick={onOpen} aria-label={`${animal.name} 상세 보기`}><Photo animal={animal}/><span className={`sex-pill ${animal.sex}`}>{sexLabels[animal.sex]}</span>{managed && <span className={`visibility-pill ${animal.is_public ? 'visible' : ''}`}>{animal.is_public ? <Eye size={13}/> : <EyeOff size={13}/>} {animal.is_public ? '공개' : '비공개'}</span>}</button><div className="card-content"><div className="card-title"><button onClick={onOpen}><h3>{animal.name}</h3></button><span className={`status-dot ${animal.listing_status}`}/></div><p>{animal.species}</p><div className="card-bottom"><span>{animal.morph || '모프 미입력'}</span>{managed ? <button className="text-button" onClick={onToggle}>{animal.is_public ? '비공개로 전환' : '공개로 전환'}</button> : <ArrowUpRight size={17}/>}</div></div></article>;
}
function AnimalDetail({ animal, onClose }: { animal: Animal; onClose: () => void }) {
  return <Modal title={animal.name} onClose={onClose}><div className="detail-photo"><Photo animal={animal} full/></div><dl className="detail-info"><div><dt>종류</dt><dd>{animal.species}</dd></div><div><dt>모프</dt><dd>{animal.morph || '미입력'}</dd></div><div><dt>성별</dt><dd>{sexLabels[animal.sex]}</dd></div><div><dt>상태</dt><dd>{statusLabels[animal.listing_status]}</dd></div></dl>{animal.description && <p className="detail-description">{animal.description}</p>}</Modal>;
}

function Landing({ signedIn }: { signedIn: boolean }) {
  return <div className="landing"><header className="site-header"><Brand/><div className="header-actions"><Link className="button ghost" to={signedIn ? '/dashboard/animals' : '/auth/login'}>{signedIn ? '마이페이지' : '로그인'}</Link><Link className="button" to={signedIn ? '/dashboard/animals' : '/auth/login'}>내 페이지 만들기 <ArrowUpRight size={16}/></Link></div></header><main><section className="hero"><div className="hero-copy"><span className="hero-tag"><Leaf size={14}/> 파충류와 함께하는 모든 순간</span><h1>작은 기록이 모여,<br/>우리 아이의<br/><span>이야기가 됩니다.</span></h1><p>개체 관리부터 성장 기록, 나만의 브리더 페이지까지.<br/>소중한 아이들의 일상을 하나의 링크에 담아보세요.</p><Link to={signedIn ? '/dashboard/animals' : '/auth/login'} className="button dark">나의 렙타일링크 시작하기 <ArrowRight size={18}/></Link><div className="hero-caption"><Check size={14}/> 무료로 시작하는 브리더의 기록</div></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="art-label">GROW TOGETHER</span><div className="sample-profile"><div className="sample-cover">every little<br/><b>moment matters.</b><Sprout size={42}/></div><div className="sample-profile-body"><span className="sample-avatar"><Gecko/></span><small>OUR REPTILE FAMILY</small><strong>초록빛 브리딩룸</strong><p>아이들과 함께, 천천히 자라는 중 🌱</p><div className="sample-mini"><Gecko variant={1}/><div><b>도리</b><span>크레스티드 게코</span></div><span className="mini-sex">수컷</span></div><div className="sample-green-button">우리 아이들 만나보기 <ArrowUpRight size={14}/></div></div></div><div className="floating-note"><span><Sprout size={20}/></span><div>오늘도 한 뼘 성장했어요<b>기록하는 즐거움</b></div></div><span className="hero-star">✳</span></div></section><section className="intro"><div><span className="eyebrow">MADE FOR REPTILE PEOPLE</span><h2>한 마리, 한 마리.<br/>모두 다른 이야기를 한곳에.</h2></div><div className="intro-items"><div><span>01</span><h3>나만의 개체 관리</h3><p>사진과 특징을 기록하고<br/>아이들을 한눈에 모아보세요.</p></div><div><span>02</span><h3>브리더의 작은 공간</h3><p>소개와 개체를 담은 페이지를<br/>하나의 주소로 공유하세요.</p></div><div><span>03</span><h3>모바일에서 간편하게</h3><p>사진을 찍고 기록하는 순간까지<br/>어디서든 가볍게 시작하세요.</p></div></div></section><div className="landing-bottom"><span>YOUR REPTILE STORY STARTS HERE</span><ArrowDown size={21}/></div></main><Footer/></div>;
}
function Footer() { return <footer className="footer"><Brand/><span>작은 기록, 함께하는 성장.</span><nav><Link to="/terms">이용 안내</Link><Link to="/privacy">개인정보 안내</Link></nav><small>© {new Date().getFullYear()} ReptileLink</small></footer>; }
function Login({ session }: { session: Session | null }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (session) return <Navigate to="/dashboard/animals" replace/>;
  async function login(email: string) {
    setBusy(true); setError('');
    const result = await supabase.auth.signInWithPassword({ email, password: 'Local-Reptilelink-Only-2026!' });
    if (result.error) { setError(userMessage(result.error)); setBusy(false); }
  }
  return <div className="auth-page"><header className="site-header"><Brand/><Link to="/" className="text-button">홈으로</Link></header><main className="auth-card"><div className="auth-illustration"><Gecko/></div><span className="eyebrow">WELCOME TO YOUR LITTLE WORLD</span><h1>반가워요,<br/>함께 기록해볼까요?</h1><p>아이들의 소중한 순간을<br/>나만의 렙타일링크에 모아보세요.</p>{!configured && <Notice>개발 환경 설정이 필요합니다. 로컬 백엔드를 먼저 준비해주세요.</Notice>}{error && <Notice>{error}</Notice>}<button className="button google" disabled={!googleAuth || busy} onClick={async () => { setBusy(true); const { error: authError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } }); if (authError) { setError(userMessage(authError)); setBusy(false); } }}><span className="google-g">G</span>Google 계정으로 시작하기</button>{!googleAuth && <small className="muted">Google 로그인 연결 전입니다.</small>}{localAuth && <section className="local-login"><span className="local-badge">LOCAL DEVELOPMENT</span><p>로컬 인증·DB를 사용하는 개발용 계정입니다.</p><button className="button" disabled={busy || !configured} onClick={() => login('breeder-a@reptilelink.test')}>{busy ? <LoaderCircle className="spin" size={18}/> : <Sprout size={18}/>} 테스트 브리더로 로그인</button><button className="text-button" disabled={busy} onClick={() => login('breeder-b@reptilelink.test')}>다른 테스트 계정으로 로그인</button></section>}<div className="auth-trust"><ShieldCheck size={15}/> 내 기록은 내가 선택한 범위에서만 공개됩니다.</div></main></div>;
}
function ProfileForm({ profile, refresh, onboarding = false }: { profile: Profile | null; refresh: () => Promise<void>; onboarding?: boolean }) {
  const navigate = useNavigate();
  const [slug, setSlug] = useState(profile?.slug || ''), [name, setName] = useState(profile?.display_name || ''), [bio, setBio] = useState(profile?.bio || ''), [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSaved(false);
    const parsed = profileSchema.safeParse({ slug, name, bio });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (!profile && !accepted) return setError('테스트용 이용 안내를 확인해주세요.');
    setBusy(true);
    try { await rpc('save_profile', { p_slug: parsed.data.slug, p_name: parsed.data.name, p_bio: parsed.data.bio, p_expected: profile?.revision ?? 0, p_publish: profile?.is_published ?? false, p_accept_terms: accepted }); await refresh(); if (onboarding) navigate('/dashboard/animals'); else setSaved(true); }
    catch (reason) { setError(userMessage(reason)); }
    finally { setBusy(false); }
  }
  return <form className="profile-form" onSubmit={submit}><div className="form-section-title"><span className="form-step">01</span><div><h2>브리더 프로필</h2><p>방문자에게 보여줄 나만의 공간을 만들어주세요.</p></div></div><label>브리더 이름 <span>*</span><input aria-label="브리더 이름" value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="예: 초록빛 브리딩룸" required/></label><label>내 페이지 주소 <span>*</span><div className="slug-input"><span>/u/</span><input aria-label="내 페이지 주소" value={slug} disabled={Boolean(profile?.first_published_at)} onChange={e => setSlug(e.target.value.toLowerCase())} placeholder="green-room" maxLength={30} required/></div><small>영문 소문자·숫자·하이픈 3~30자. 처음 공개한 뒤에는 변경할 수 없어요.</small></label><label>소개<textarea aria-label="소개" value={bio} onChange={e => setBio(e.target.value)} placeholder="어떤 아이들과 함께하고 있나요?" maxLength={300} rows={4}/><small className="character-count">{bio.length}/300</small></label>{!profile && <label className="check-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/><span><Link to="/terms" target="_blank">테스트용 이용 안내</Link>와 <Link to="/privacy" target="_blank">개인정보 안내</Link>를 확인했습니다.</span></label>}{error && <Notice>{error}</Notice>}{saved && <p className="success" role="status"><CheckCircle2 size={16}/> 프로필을 저장했어요.</p>}<button className="button form-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : null}{onboarding ? '내 공간 만들기' : '적용하기'}<ArrowRight size={17}/></button></form>;
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

function DashboardPage({ data, refresh, refreshCollection, onSignOut }: { data: Dashboard; refresh: () => Promise<void>; refreshCollection: () => Promise<Dashboard>; onSignOut: () => void }) {
  const location = useLocation(); const design = location.pathname.includes('/design');
  const [creating, setCreating] = useState(false), [editing, setEditing] = useState<Animal | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { setEditing(null); }, [location.pathname]);
  const [collectionLocked, setCollectionLocked] = useState(false);
  const profile = data.profile!;
  async function togglePage() { setBusy(true); setError(''); try { await rpc('set_profile_public', { p_public: !profile.is_published, p_expected: profile.revision }); await refresh(); } catch (reason) { setError(userMessage(reason)); await refresh(); } finally { setBusy(false); } }
  return <div className="dashboard"><header className="site-header"><Brand/><div className="header-actions"><span className="account-label"><span className="account-dot"/>{profile.display_name}</span><button className="icon-button" aria-label="로그아웃" disabled={collectionLocked} onClick={onSignOut}><LogOut size={18}/></button></div></header><div className="dashboard-layout"><aside className="sidebar"><span className="nav-caption">MY REPTILELINK</span><Link to="/dashboard/animals" className={`nav-link ${!design ? 'active' : ''}`}><Sprout size={19}/> 개체 관리 <span>{data.animals.length}</span></Link><Link to="/dashboard/design" className={`nav-link ${design ? 'active' : ''}`}><Leaf size={19}/> 프로필 설정</Link><div className="nav-future"><Link2 size={18}/><span>링크 · 일정 · 성장 기록<small>다음 개발 단계에서 만나요</small></span></div><div className="sidebar-note"><Gecko/><b>오늘도 잘 자라고 있나요?</b><p>작은 순간도 기록하면<br/>특별한 이야기가 돼요.</p></div><div className="storage-caption"><span>사진 저장 공간</span><b>{formatBytes(data.usage?.stored_bytes || 0)} / 20 MB</b><div className="storage-track"><i style={{ width: `${((data.usage?.stored_bytes || 0) + (data.usage?.reserved_bytes || 0)) / (20 * 1024 * 1024) * 100}%` }}/></div><small>정리 대기 {formatBytes(data.usage?.reserved_bytes || 0)}</small></div></aside><main className="workspace"><div className="page-topline"><span className="eyebrow">MY LITTLE WORLD</span><span className="plan-badge"><Leaf size={12}/> FREE</span></div><div className="page-heading"><div><h1>{design ? '나를 소개하는 작은 공간' : '함께 자라는 우리 아이들'}<span className="heading-dot">.</span></h1><p>{design ? '브리더의 이야기를 나만의 링크에 담아보세요.' : '한 마리, 한 마리. 소중한 기록을 차곡차곡 모아보세요.'}</p></div></div><section className="page-link-banner"><div className="page-link-icon"><Link2 size={22}/></div><div className="page-link-text"><span>나의 렙타일링크</span><b>{window.location.host}/u/{profile.slug}</b></div><span className={`publication-status ${profile.is_published ? 'published' : ''}`}><i/>{profile.is_published ? '공개 중' : '비공개'}</span><button className="icon-button" aria-label="공개 주소 복사" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/u/${profile.slug}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('주소를 직접 복사해주세요.'); } }}>{copied ? <Check size={17}/> : <Copy size={17}/>}</button>{profile.is_published && <Link className="icon-button" to={`/u/${profile.slug}`} target="_blank" aria-label="공개 페이지 열기"><ExternalLink size={17}/></Link>}<button className={`button small ${profile.is_published ? 'ghost' : ''}`} disabled={busy || collectionLocked} onClick={togglePage}>{profile.is_published ? '비공개로 전환' : '페이지 공개하기'}</button></section>{error && <Notice>{error}</Notice>}{saved && <p role="status" className="success">개체 정보를 저장했어요.</p>}{design ? <section className="editor-panel"><ProfileForm key={profile.id} profile={profile} refresh={refresh}/></section> : <AnimalCollection animals={data.animals} revision={profile.revision} active={!editing && !creating} onCreate={() => setCreating(true)} onEdit={animal => { setSaved(false); setEditing(animal); }} refresh={refreshCollection} onLocked={setCollectionLocked} photo={animal => <Photo animal={animal} plain/>}/>}<footer className="workspace-footer"><span>© {new Date().getFullYear()} ReptileLink</span><span>Made for your little companions <Leaf size={12}/></span></footer></main></div>{creating && <AnimalForm profile={profile} refresh={refresh} onClose={() => setCreating(false)}/ >}{editing && <AnimalEdit animal={editing} revision={profile.revision} preview={editing.photos.length ? <Photo animal={editing} full/> : null} onClose={() => setEditing(null)} onSaved={async () => { await refresh(); setEditing(null); setSaved(true); }}/>}</div>;
}

function PublicView() {
  const { slug, id } = useParams(); const [data, setData] = useState<PublicPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(false), [selected, setSelected] = useState<Animal | null>(null);
  useEffect(() => { let active = true; setLoading(true); setError(false); const bootstrap = document.getElementById('public-bootstrap'); let initial: PublicPage | null = null; if (bootstrap?.textContent) { try { const candidate = JSON.parse(bootstrap.textContent); if (candidate.profile.slug === slug) initial = candidate; } catch { /* Ignore invalid bootstrap and use the authoritative API. */ } }
    (initial ? Promise.resolve(initial) : rpc<PublicPage | null>('public_page', { p_slug: slug })).then(result => { if (!active) return; setData(result); if (id) { const found = result?.animals.find(a => a.id === id); if (found) setSelected(found); else setError(true); } }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [slug, id]);
  if (loading) return <Spinner/>;
  if (!data || error) return <div className="not-found"><Sprout size={38}/><h1>페이지를 찾을 수 없어요</h1><p>공개된 주소인지 확인해주세요.</p><Link className="button" to="/">홈으로 돌아가기</Link></div>;
  return <div className="public-shell"><header className="site-header"><Brand/><Link className="text-button" to="/auth/login">나도 시작하기 <ArrowUpRight size={15}/></Link></header><main className="public-page"><div className="public-cover"><span>every little<br/><b>moment matters.</b></span><Sprout size={58}/><div className="cover-orbit"/></div><div className="public-avatar"><Gecko/></div><section className="public-intro"><span className="eyebrow">OUR REPTILE FAMILY</span><h1>{data.profile.display_name}</h1><p>{data.profile.bio || '아이들과 함께하는 소중한 순간을 기록합니다.'}</p><span className="public-count"><Sprout size={15}/> 함께하는 아이들 {data.animals.length}</span></section><div className="public-animals">{data.animals.length ? data.animals.map(animal => <AnimalCard key={animal.id} animal={animal} onOpen={() => setSelected(animal)}/>) : <p className="public-empty">곧 우리 아이들의 이야기가 시작됩니다.</p>}</div><div className="public-bottom"><span>GROWING, ONE MOMENT AT A TIME.</span><Brand/></div></main>{selected && <AnimalDetail animal={selected} onClose={() => setSelected(null)}/>}</div>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null), [authLoading, setAuthLoading] = useState(true), [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState('');
  useEffect(() => { let active = true; supabase.auth.getSession().then(({ data: auth }) => { if (active) { setSession(auth.session); setAuthLoading(false); } }); const listener = supabase.auth.onAuthStateChange((_event, current) => { setSession(current); setData(null); setError(''); }); return () => { active = false; listener.data.subscription.unsubscribe(); }; }, []);
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
    if (error) return <div className="not-found"><Notice>{error}</Notice><button className="button" onClick={refresh}>다시 불러오기</button></div>;
    if (!data) return <Spinner/>;
    if (data.account_status !== 'active') return <div className="not-found"><ShieldCheck size={40}/><h1>승인을 기다리고 있어요</h1><p>초대된 계정의 이용 승인이 끝나면 내 공간을 만들 수 있어요.</p><button className="button ghost" onClick={() => supabase.auth.signOut()}>로그아웃</button></div>;
    if (!data.profile) return onboarding ? <div className="onboarding"><header className="site-header"><Brand/><span className="step-caption">STEP 01 / 02</span></header><main><span className="eyebrow">MAKE IT YOURS</span><h1>우리 아이들의 이야기가<br/>시작될 공간을 만들어봐요.</h1><ProfileForm profile={null} refresh={refresh} onboarding/></main></div> : <Navigate to="/onboarding" replace/>;
    if (onboarding) return <Navigate to="/dashboard/animals" replace/>;
    return <DashboardPage data={data} refresh={refresh} refreshCollection={refreshCollection} onSignOut={() => supabase.auth.signOut()}/>;
  };
  return <Routes><Route path="/" element={<Landing signedIn={Boolean(session)}/>}/><Route path="/auth/login" element={authLoading ? <Spinner/> : <Login session={session}/>}/><Route path="/auth/callback" element={authLoading ? <Spinner/> : <Navigate to={session ? '/dashboard/animals' : '/auth/login'} replace/>}/><Route path="/onboarding" element={protectedView(true)}/><Route path="/dashboard/*" element={protectedView(false)}/><Route path="/u/:slug" element={<PublicView/>}/><Route path="/u/:slug/animals/:id" element={<PublicView/>}/><Route path="/terms" element={<LegalPage privacy={false}/>}/><Route path="/privacy" element={<LegalPage privacy/>}/><Route path="*" element={<div className="not-found"><h1>페이지를 찾을 수 없어요.</h1><Link to="/">홈으로</Link></div>}/></Routes>;
}
function LegalPage({ privacy }: { privacy: boolean }) {
  return <div className="legal-page"><Brand/><h1>{privacy ? '개인정보 안내' : '이용 안내'}</h1><span className="local-badge">로컬 개발 미리보기</span><p>이 화면은 로컬 개발 환경을 확인하기 위한 안내입니다. 실제 서비스의 약관·개인정보 처리방침은 운영 주체와 수집·보관 기준을 확정한 후 작성해야 합니다.</p><p>{privacy ? '테스트 계정의 프로필과 개체 사진은 로컬 Supabase에 저장됩니다. 공개로 설정한 항목만 방문자에게 표시됩니다. 실명·연락처·민감한 자료 대신 테스트 데이터를 사용해주세요.' : '초대된 로컬 테스트 계정으로 개체 등록과 페이지 공개를 확인할 수 있습니다. 결제·문자 인증·분양 거래 기능은 제공하지 않습니다.'}</p><Link className="button ghost" to="/">홈으로</Link></div>;
}
