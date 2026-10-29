import {AnimalCreate} from './components/AnimalCreate';
import {PublicView} from './components/PublicPage';
import {PolicyChecks,PolicyRenewal} from './components/PolicyConsent';
import {PolicyRenewalLink} from './components/PolicyRenewalLink';
import {policyAvailable,usePolicy} from './lib/policy';
import {SourcePage} from './components/SourcePage';
import {LegalPage,HelpPage,PolicyDialog} from './components/InformationPages';
import {authIssue,authIssueText,publicReturnPath,pendingPublicReturn,rememberPublicReturn} from './lib/authReturn';
import {Landing} from './components/Landing';
import {Activity} from './components/Activity';
import {ManagedComments} from './components/Comments';
import {AccountWithdrawal,AccountDeletionProgress} from './components/AccountWithdrawal';
import {useUnsavedChanges} from './lib/useUnsavedChanges';
import {Schedules} from './components/Schedules';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react';
import { AnimalDelete, PendingAnimalDeletions } from './components/AnimalDelete';
import { AnimalGrowth } from './components/AnimalGrowth';
import { DesignSettings } from './components/DesignSettings';
import { ExternalLinks } from './components/ExternalLinks';
import { AnimalEdit } from './components/AnimalEdit';
import { AnimalCollection } from './components/AnimalCollection';
import { ManagementShell, ManagementShare } from './components/ManagementShell';
import { formatBytes, profileSchema, userMessage, type Animal, type Dashboard, type Profile } from './lib/domain';
import { configured, googleAuth, initialAuthIssue, localAuth, rpc, serverRequest, supabase } from './lib/supabase';

function Spinner() { return <div className="loading" role="status"><LoaderCircle className="spin" size={23}/> 불러오고 있어요</div>; }
function Notice({ children }: { children: ReactNode }) { return <p className="notice" role="alert">{children}{typeof children==='string'&&<PolicyRenewalLink message={children}/>}</p>; }
function Photo({ animal, full = false, plain = false }: { animal: Animal; full?: boolean; plain?: boolean }) {
  const [image, setImage] = useState('');
  const asset = animal.photos[0]?.asset_id;
  useEffect(() => { let active = true; setImage(''); if (asset) serverRequest<{ url: string }>(`/api/media/${asset}/${full ? 'original_display' : 'thumbnail'}`).then(data => { if (active) setImage(data.url); }).catch(() => {}); return () => { active = false; }; }, [asset, full]);
  return image ? <img className="animal-photo" src={image} alt={animal.name} loading="lazy" onError={() => setImage('')}/> : plain ? <div className="collection-photo-placeholder">사진 없음</div> : <div className="animal-placeholder">사진 없음</div>;
}
function AuthDestination({session,data,error,refresh,desiredPath,issue,handled}:{session:Session|null;data:Dashboard|null;error:string;refresh:()=>Promise<void>;desiredPath?:string|null;issue?:'cancelled'|'failed'|null;handled?:()=>void}) {
  const navigate=useNavigate(),location=useLocation(),decided=useRef(false);
  const failure=authIssue(location.search,location.hash)||issue;
  useEffect(()=>{if(decided.current)return;if(desiredPath!==undefined)rememberPublicReturn(desiredPath);if(failure){decided.current=true;handled?.();navigate('/auth/login',{replace:true,state:{authIssue:failure}});return;}if(!session){decided.current=true;navigate('/auth/login',{replace:true,state:{authIssue:'failed'}});return;}if(!data)return;decided.current=true;const active=data.account_status==='active',ready=active&&Boolean(data.profile)&&data.policy?.accepted===true;navigate(ready?(pendingPublicReturn(true)||'/dashboard/animals'):(active&&data.profile?'/onboarding':'/dashboard/animals'),{replace:true});},[session,data,desiredPath,failure,navigate,handled]);
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
  const policies=usePolicy(onboarding);
  useEffect(()=>{if(onboarding){setAccepted(false);setPrivacyAccepted(false);}},[onboarding,policies.data?.version,policies.data?.digest]);
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
    try { if(onboarding){if(!policyAvailable(policies.data)||policies.loading)throw new Error('POLICY_NOT_READY');await rpc('accept_required_policy',{p_version:policies.data.version,p_digest:policies.data.digest,p_terms:accepted,p_privacy:privacyAccepted});}await rpc('save_profile', { p_slug: parsed.data.slug, p_name: parsed.data.name, p_bio: parsed.data.bio, p_expected: profile?.revision ?? 0, p_publish: profile?.is_published ?? false, p_accept_terms: false }); const d=await refresh();if(!d?.profile)throw new Error('NOT_FOUND');accept(d.profile);setUncertain(false);if(!onboarding)setSaved(true); }
    catch (reason) { setError(userMessage(reason));if(/POLICY_CHANGED|POLICY_NOT_READY|CONSENT_REQUIRED/.test(String((reason as {message?:string})?.message??reason)))setUncertain(false); }
    finally { setBusy(false); }
  }
  return <form className={`profile-form source-profile-form ${onboarding?'source-onboarding-form':'source-basic-form'}`} onSubmit={submit}><fieldset disabled={busy||uncertain}>
    <label className="source-profile-row"><span>페이지 주소 <span aria-hidden="true">*</span></span><div className="source-slug"><div className="slug-input"><span>/u/</span><input aria-label="내 페이지 주소" value={slug} disabled={Boolean(profile?.first_published_at)} onChange={e=>setSlug(e.target.value.toLowerCase())} placeholder="your-id" maxLength={30} required/></div><small>영문 소문자·숫자·하이픈 3~30자. 처음 공개한 뒤에는 변경할 수 없어요.</small></div></label>
    <label className="source-profile-row"><span>이름 <span aria-hidden="true">*</span></span><input aria-label="브리더 이름" value={name} onChange={e=>setName(e.target.value)} placeholder="브리더 이름" required/></label>
    {!onboarding&&email&&<label className="source-profile-row"><span>이메일</span><input aria-label="로그인 계정 이메일" value={email} readOnly/></label>}
    <label className="source-profile-row"><span>소개</span><div className="source-bio"><textarea aria-label="소개" value={bio} onChange={e=>setBio(e.target.value)} placeholder="소개를 입력해주세요" rows={4}/><small className="character-count">{[...bio].length}/300</small></div></label>
    {!profile&&<><PolicyChecks bundle={policies.data} terms={accepted} privacy={privacyAccepted} onTerms={setAccepted} onPrivacy={setPrivacyAccepted} onOpen={openPolicy} disabled={policies.loading}/>{policies.error&&<Notice>{policies.error}</Notice>}<button type="button" className="text-button" disabled={policies.loading} onClick={()=>void policies.load()}>최신 안내 다시 불러오기</button></>}

  </fieldset>{error && <Notice>{error}</Notice>}{(dirty||uncertain)&&<button type="button" className="text-button" disabled={busy} onClick={()=>void inspect()}>{uncertain?'저장 상태 확인':'변경 취소'}</button>}{navigation.blocked&&<div data-navigation-prompt><p className="notice" role="alert">적용하지 않은 기본정보가 있습니다.</p><button ref={navigation.stayButton} type="button" className="text-button" onClick={stayProfile}>계속 수정</button><button type="button" className="text-button" disabled={busy} onClick={async()=>{if(await inspect())navigation.leave();}}>최신 정보 확인 후 이동</button></div>}{saved && <p className="success" role="status"><CheckCircle2 size={16}/> 프로필을 저장했어요.</p>}<button className="button form-submit" disabled={busy||uncertain}>{busy ? <LoaderCircle className="spin" size={18}/> : null}{onboarding ? '내 공간 만들기' : '적용하기'}</button>{policy&&!navigation.blocked&&<PolicyDialog bundle={policies.data} privacy={policy==='privacy'} onClose={()=>setPolicy(null)}/>}</form>;
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
    <main className="management-content">{data.policy?.accepted!==true&&<Notice>이용 안내에 동의해주세요.</Notice>}
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
    {creating && <AnimalCreate profile={profile} reconcile={refreshCollection} onClose={() => setCreating(false)}/>}
    {editing && <AnimalEdit animal={editing} revision={profile.revision} renderPhoto={id => <Photo animal={{ ...editing, photos: [{ asset_id: id, sort_order: 0 }] }} full plain/>} reconcile={refreshCollection} onClose={() => setEditing(null)} onSaved={async () => { await refreshCollection(); setEditing(null); setSaved(true); }} onComments={animal=>{setEditing(null);setComments(animal);}} onDelete={animal => { setEditing(null); setDeleting(animal); }} onGrowth={animal => { setEditing(null); setGrowing(animal); }}/>}
  </ManagementShell>;
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
    if(onboarding&&data.policy?.accepted!==true)return <SourcePage signedIn locked={onboardingLocked} onSignOut={()=>void supabase.auth.signOut()}><main className="source-onboarding-main"><h1>필수 안내 확인</h1><PolicyRenewal refresh={refreshCollection} onLocked={setOnboardingLocked}/><AccountWithdrawal expected={data.profile.revision} disabled={onboardingLocked} refresh={refreshCollection}/></main></SourcePage>;
    if (onboarding) return <AuthDestination session={session} data={data} error={error} refresh={refresh}/>;
    return <DashboardPage data={data} email={session.user.email} refresh={refresh} refreshCollection={refreshCollection} onSignOut={() => supabase.auth.signOut()}/>;
  };
  return <Routes><Route path="/" element={<Landing signedIn={Boolean(session)}/>}/><Route path="/auth/login" element={authLoading ? <Spinner/> : <Login session={session} data={data} error={error} refresh={refresh}/>}/><Route path="/auth/callback" element={authLoading ? <Spinner/> : <AuthDestination session={session} data={data} error={error} refresh={refresh} issue={callbackIssue} handled={clearCallbackIssue}/>}/><Route path="/onboarding" element={protectedView(true)}/><Route path="/dashboard/*" element={protectedView(false)}/><Route path="/u/:slug" element={<PublicView signedIn={Boolean(session)}/>}/><Route path="/u/:slug/animals/:id" element={<PublicView signedIn={Boolean(session)}/>}/><Route path="/help" element={<HelpPage signedIn={Boolean(session)} onSignOut={()=>void supabase.auth.signOut()}/>}/><Route path="/terms" element={<LegalPage privacy={false} signedIn={Boolean(session)} onSignOut={()=>void supabase.auth.signOut()}/>}/><Route path="/privacy" element={<LegalPage privacy signedIn={Boolean(session)} onSignOut={()=>void supabase.auth.signOut()}/>}/><Route path="*" element={<div className="not-found"><h1>페이지를 찾을 수 없어요.</h1><Link to="/">홈으로</Link></div>}/></Routes>;
}
