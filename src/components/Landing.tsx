import {Link} from 'react-router-dom';
import {ManagementFooter,SourceBrand} from './ManagementShell';

const exampleSizes:Record<string,{pc:[number,number];mobile:[number,number]}>={phones:{pc:[445,535],mobile:[315,380]},comments:{pc:[545,290],mobile:[390,320]},growth:{pc:[790,430],mobile:[450,320]},calendar:{pc:[850,380],mobile:[400,325]},socials:{pc:[1920,340],mobile:[450,420]}};
function Example({name,alt,caption,className=''}:{name:string;alt:string;caption:string;className?:string}){
 const size=exampleSizes[name];
 return <figure className={`main-example ${className}`}><picture><source width={size.pc[0]} height={size.pc[1]} media="(min-width: 1000px)" srcSet={`/brand/main/${name}-pc.png`}/><img width={size.mobile[0]} height={size.mobile[1]} src={`/brand/main/${name}-mobile.png`} alt={alt} loading={name==='phones'?'eager':'lazy'} decoding="async"/></picture><figcaption>{caption}</figcaption></figure>;
}

export function Landing({signedIn}:{signedIn:boolean}){
 const destination=signedIn?'/dashboard/animals':'/auth/login';
 return <div className="source-main">
  <header className="management-header"><SourceBrand/><nav className="management-header-actions" aria-label="시작 메뉴">{!signedIn&&<Link className="button ghost" to="/auth/login">로그인</Link>}<Link className="button" to={destination}>{signedIn?'마이페이지':'무료 회원가입'}</Link></nav></header>
  <main>
   <section className="main-hero" aria-labelledby="main-title"><div className="main-hero-copy"><h1 id="main-title">파충류 성장기록부터<br/>멀티링크까지 한 번에,<br/><strong>파충류인 필수 플랫폼!</strong></h1><p>입문자부터 브리더까지,<br/>초대·승인 후 기록하고 공유하세요</p><span className="main-address-example" aria-label="공개 주소 형식 예시">나만의 주소 <span>/u/your-id</span></span></div><Example name="phones" alt="프로필·개체·외부 링크를 한 페이지에서 보여주는 휴대폰 화면 예시" caption="공개 페이지 화면 예시" className="main-phones"/></section>
   <section className="main-community" aria-labelledby="main-community-title"><div className="main-community-copy"><h2 id="main-community-title">한두 마리가 아닌 우리 아이들<br/><strong>한 화면에서 모아보세요</strong> <span aria-hidden="true">💗</span></h2><p>개체를 등록하고,<br/>링크를 공유한 사람에게 댓글도 받아보세요 <span aria-hidden="true">☺️</span></p><img className="main-reptiles" src="/brand/main/reptiles-pc.png" width="552" height="120" alt="" loading="lazy"/></div><Example name="comments" alt="개체의 특징과 해칭일 등을 묻는 네 개 댓글의 표시 방식 예시" caption="댓글 화면 예시 · 실제 이용 후기 아님"/></section>
   <section className="main-growth" aria-labelledby="main-growth-title"><div className="main-growth-inner"><div className="main-growth-copy"><h2 id="main-growth-title">우리아이 성장을<br/><strong>간편하게 기록하세요</strong> <span aria-hidden="true">✏️</span></h2><p>날짜와 몸무게를 기록하면, 개체별 날짜별로<br/>몸무게 증감을 손쉽게 확인 가능해요 <span aria-hidden="true">⚖️</span></p></div><Example name="growth" alt="기록한 날짜와 체중을 연결해 변화 추이를 보여주는 그래프 예시" caption="성장 기록 화면 예시 · 실제 집계 아님"/></div></section>
   <section className="main-calendar" aria-labelledby="main-calendar-title"><h2 id="main-calendar-title">일정등록 기능으로<br/><strong>다양한 일정을 관리하세요</strong> <span aria-hidden="true">📅</span></h2><p>피딩 일정과 다양한 이벤트 일정을<br/>등록하고 한 번에 모아보세요</p><Example name="calendar" alt="등록한 일정의 날짜와 OPEN·SOON 상태를 보여주는 예시" caption="일정 표시 예시 · 실제 행사 일정 아님"/></section>
   <section className="main-socials" aria-labelledby="main-socials-title"><h2 id="main-socials-title">다양한 링크<br/><strong>버튼을 추가하세요</strong> <span aria-hidden="true">👍</span></h2><p>인스타그램, 유튜브, 블로그 등<br/>보여주고 싶은 콘텐츠를 모두 연결하세요 <span aria-hidden="true">🤝</span></p><Example name="socials" alt="밴드·인스타그램·페이스북·유튜브·카카오톡·블로그 링크 연결 예시" caption="지원하는 SNS 연결 예시"/></section>
  </main><ManagementFooter/>
 </div>;
}
