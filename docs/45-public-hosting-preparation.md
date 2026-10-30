# 실제 공개 호스팅 기반과 최종 주소 준비 (#77)

2026-10-30 KST 관측이다. **기반 호스팅은 게시됐으나 최종 운영주소·Google인증·회원개방은 미완료**다. 상위 [#62](https://github.com/KimEunYeol/reptilelink/issues/62), 원격백업/복구는[#69](https://github.com/KimEunYeol/reptilelink/issues/69)에서 추적한다.

## 현재 계약

770.kr은 약관 등 문서의 참고자료일 뿐 서비스도메인이 아니다. 최신사용자지시로 이전서브도메인연결을철회해 Cloudflare연결삭제/빈목록재조회와허용origin제거/403을확인했다. NHN DNS/770본사이트는변경하지않았다. 도메인을구매하지않고 reptilelink를포함하며dev가없는무료제공주소를사용한다. NetlifyFree의reptilelink.netlify.app은현재**후보이며미예약**이다. 계정로그인뒤이름충돌/실제Free사용량을확인한뒤확보한다.

서비스문의표시만사용자가지정한770_official@naver.com을사용한다. 이후사용자가Google프로젝트/OAuth는본인의현재Google계정으로진행한다고명확히했으므로Naver주소의Google계정등록은요구하지않는다. 전용reptilelink-production프로젝트만생성했고OAuth앱/클라이언트/비밀키는아직생성하지않았다. Netlify브라우저로그인은완료됐으며단독호스팅과Cloudflare분리구성의용도를설명하고사용자선택을기다린다. 카드/업그레이드/시험판·유료API를추가하지않았다.

## 실제 게시·검증

기능sourcef16a76d의build+1421검사를통과한main78e9029와src/worker/public/DB/schema/scripts/tests/lockfile동일을확인하고동일ModuleWorker/정적자산을PagesAdvancedMode로게시했다. 앱동작이나공개DTO를재구현하지않았다. 별도출력디렉토리/환경주입을사용해기존.env.local/.dev.vars해시를보존하고서버/로컬키의브라우저번들부재를검사했다.

최신Production배포는13a7de4d-b6a5-47a5-b113-201c6c9d2d9b/branchmain/source78e9029이며31정적파일과Worker/_routes/_headers를업로드했다. 소스확인시문서작업중이어서commit-dirty=true로정직하게표시했다. 내부Cloudflare호스팅은reptilelink.pages.dev이며**최종사용자주소로선정하지않는다**. 운영server키와새HMAC는productionsecret에만전달했고값을로그/키파일/Git에남기지않았다. preview에는secret을추가하지않았다.

실제브라우저320/360/390/450/768/1440/1920px의7폭넘침0·fixture버튼0·문의초안버튼활성을확인했다. health200, 없는프로필/사진/알수없는API404, 익명업로드401, 인증/관리/공개서버응답no-store가통과했다. 미구성Google버튼은disabled이고입력을받지않는다. DB사용자/프로필/사진0, 정책unconfigured, 가입·쓰기·통계중지상태를유지했다. 실제Google로그인·초대/승인/회원쓰기·탈퇴Storage실물제거검증을대체하지않는다.

소규모익명5요청의실제tailCPU는0/2/0/6/0ms, 모두outcomeok였다. 같은경로의WallTime은0/42/1/82/0ms로CPU와구분했다. Free10ms보다작은이5표본으로회원/사진/부하안전성을일반화하지않는다. 첫self-IP필터표본0과뒤의표식별5표본을구분하고원시요청로그/IP/헤더는보관하지않았다. 기본Python클라이언트는CDN1010/403으로거절됐지만기본Chrome/Playwright브라우저는정상이었으며보안장벽우회나검사비활성은하지않았다.

## 자료·실패 기록

[770자료대조](operating-materials/770-source-review.md),[이용약관후보](operating-materials/reptilelink-terms-v1.md),[개인정보후보](operating-materials/reptilelink-privacy-v1.md)는참고원문과실제서비스차이를분리한다. 원문의결제/배송·PG/택배/NHN위탁과ooo예시를그대로게시하지않는다. 후보본문은실제운영자신원/제공업체세부국외처리확인전published로등록하지않았다. 문서검토/작성은법률전문가검토완료를의미하지않는다.

검증사진은Jaroslav A. Polák의Leopard gecko130724.jpg(CC0-1.0)원본3,980,640B/2272×1704다. 원본SHA·출처/라이선스를보존하고앱의실제decode/7폭사진선택·취소·업로드0회를확인했다. 실제운영Storage에전송/회원개체로게시한것은아니다. 기존28사진/로컬DB/키는보존했다.

첫secret명령은Pages미지원observability선언의구성검증에서중단됐다. 격리Pages설정에서만그필드를제거해내장secret명령으로성공했고기존Worker설정은보존했다. 첫문의검사의잘못된주소linklocator는실제문의초안버튼검사로수정해최종통과했다. 초기로그를보존한다.

자동승인검토는별도Cloudflare로그인토큰추출을불필요한자격증명접근으로거절했다. 이를우회하지않고Wrangler내장명령과콘솔만사용했다. 미연결770주소로SupabaseAuth복귀URL을바꾸려던명령도거절돼실행되지않았고, 이후사용자가그도메인을철회해준비파일도withdrawn으로표시했다. 현재복귀URL이새운영주소로바뀌었다고주장하지않는다.

## 이어서 수행

NetlifyFree계정의이름/실제0원조건을확인해무료주소를확보하고검증된Worker뒤에동일경로를연결한다. 공개HTML/공유메타/동일origin·캐시·권한을새주소에서검증하고필요한코드변경은새이슈/최신main/전체verify/리뷰·PR로처리한다. 사용자본인Google계정의정확callback/client/provider·확정정책게시후초대/승인·실계정검증을수행한다. #69의운영전용백업/실제원격복구도미완료이며최종출시증거로바꾸지않는다. 자동데몬/Actions/클라우드빌드/유료플랜은설치·사용하지않는다.

비공개기록은.local/production-launch-77,읽기전용화면증거는ignoredartifacts/launch-77이다. 공개이슈/Git에키·실제계정세션·사진바이트를첨부하지않는다.
