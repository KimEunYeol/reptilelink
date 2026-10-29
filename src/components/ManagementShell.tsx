import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, ChevronDown, Link2 } from 'lucide-react';

function SourceBrand() {
  return <Link className="management-brand" to="/" aria-label="렙타일링크 홈"><img src="/brand/reptilelink-source.png" width="120" height="35" alt="ReptileLink"/></Link>;
}

/** The source's six tabs; only implemented destinations are interactive. */
function ManagementNavigation({ basic }: { basic: boolean }) {
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const container = nav.current, active = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (container && active) container.scrollLeft = active.offsetLeft - (container.clientWidth - active.clientWidth) / 2;
  }, [pathname]);
  const links=pathname.startsWith('/dashboard/links');
  return <nav ref={nav} className="management-tabs" aria-label="마이페이지 메뉴">
    <Link to="/dashboard/animals" aria-current={!basic && !links ? 'page' : undefined}>개체 관리</Link>
    <Link to="/dashboard/links" aria-current={links ? 'page' : undefined}>링크 관리</Link>
    <button disabled title="준비 중">일정 관리<span className="sr-only"> (준비 중)</span></button>
    <button disabled title="준비 중">디자인 수정<span className="sr-only"> (준비 중)</span></button>
    <Link to="/dashboard/design" aria-current={basic ? 'page' : undefined}>기본 정보</Link>
    <button disabled title="준비 중">통계/알림<span className="sr-only"> (준비 중)</span></button>
  </nav>;
}

function ManagementFooter() {
  return <footer className="management-footer"><div className="management-footer-inner">
    <SourceBrand/>
    <nav aria-label="이용 안내"><Link to="/terms">이용약관</Link><Link to="/privacy">개인정보처리방침</Link></nav>
    <div className="management-footer-bottom"><span className="management-language">한국어 <ChevronDown size={16}/></span><small>© {new Date().getFullYear()} ReptileLink</small></div>
  </div></footer>;
}

export function ManagementShell({ basic, locked, onSignOut, children }: { basic: boolean; locked: boolean; onSignOut: () => void; children: ReactNode }) {
  return <div className="management-shell">
    <header className="management-header"><SourceBrand/><div className="management-header-actions">
      <button className="button ghost" disabled={locked} onClick={onSignOut}>로그아웃</button>
      <Link className="button" to="/dashboard/animals">마이페이지</Link>
    </div></header>
    <ManagementNavigation basic={basic}/>
    {children}
    <ManagementFooter/>
  </div>;
}

export function ManagementShare({ url, copied, onCopy }: { url: string; copied: boolean; onCopy: () => void }) {
  return <div className="management-share"><button aria-label="공개 주소 복사" onClick={onCopy}>{copied ? <Check size={14}/> : <Link2 size={14}/>} {copied ? '복사 완료' : '링크복사'}</button><span title={url}>{url}</span><span className="sr-only" aria-live="polite">{copied ? '공개 주소를 복사했어요.' : ''}</span></div>;
}
