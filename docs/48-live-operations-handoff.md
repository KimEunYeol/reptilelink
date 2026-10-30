# 실제 운영·백업 인계 (2026-10-31 KST, #91)

## 접속과 현재 상태

**[운영 홈페이지](https://reptilelink.netlify.app) → Google 로그인 → [개체 관리](https://reptilelink.netlify.app/dashboard/animals)** 순서로 사용한다. 본인 계정의 실제 초대 연결, 대기→승인, 사용자 승인에 따른 v1 필수 문서 두 항목 동의, 비공개 공간 생성, 개체·사진 저장, 새로고침과 재로그인을 확인했다. 링크·일정·디자인·기본 정보·통계/알림을 포함한 관리 화면 6개도 정상 로딩했다. 화면 접근 확인을 각 기능의 모든 쓰기·타회원 검증으로 표시하지 않는다.

공간 주소는 reptilelink, 표시명은 렙타일링크 운영이며 현재 비공개다. 검증용 레오파드 게코 1개와 사진 1asset/2WebP(198,396B)를 보존했다. 사진은 실제 분양 개체의 기록이 아닌 CC0 검증 자료다. 출처는 [Jaroslav A. Polák / CC0-1.0](https://commons.wikimedia.org/wiki/File:Leopard_gecko130724.jpg)이며 실제 480×360 디코드와 재접속 조회를 확인했다. 원본 계정·개체·사진은 탈퇴 시험에 사용하지 않았다.

Google OAuth 앱은 별도 사용자 승인 후 Production으로 게시했다. Google만 사용하고 초대 Hook·계정 승인·10명 한도를 유지한다. 신규가입은 사용자가 승인한 초대 제한 방식으로 계속 허용한다. 다른 Google 계정은 초대와 승인이 필요하다. 홈페이지 공개와 개인 공간 공개는 별개다.

공개 문의는 **770_official@naver.com**, 개인정보 담당자는 **고경윤**, 서비스 표시명은 **렙타일링크**다. 내부 Google 관리는 사용자 본인 계정을 사용한다. 770.kr은 문서 참고일 뿐 운영 도메인·DNS와 무관하다. 정책 reptilelink-20261030-v1은 immutable/is_preview=false/published이며 원격 본문·저장소 파일·실제 /terms,/privacy가 일치한다. 탈퇴 UUID/시각의 최소 journal은 완료 후 7일 보관 뒤 예약 정리한다. 법적 완전성이나 모든 브랜드 권리의 확정을 주장하지 않는다.

## 배포·검증·비용

| 항목 | 확인 결과 |
|---|---|
| 구성 | Netlify Free 단독 앱 호스팅 + Supabase Free 서울 DB/Auth/private Storage |
| 배포 source | 71f9bc3d4046c6a0bbcba1edbb99d6bfae9c4c81 |
| 운영 version | 6ae4a79b1485f6e33851bd3f |
| 게시 시각 | 2026-10-30T14:20:14.444Z (23:20 KST) |
| 공개 설정 | Production Public / Deploy Previews Private |
| 브라우저 | 운영 URL·publishable key·공개 문의 / Google=true / fixture=false |
| 실행 | WSL 수동 CLI27.16.0 --no-build --prod; Git 연결·Actions·클라우드 빌드 없음 |
| 실제 billing | Free 월$0·카드 없음·270/300credits 잔여; 생산 배포 2회에 30credits |

추가 지출은 0원이다. 카드·유료 플랜·체험·자동충전·도메인 구매·DNS 변경은 하지 않았다. Free 한도 소진 시 과금 대신 중지를 허용하고 무료 배지는 유지한다. 수치는 관측 시점 결과이며 미래 공급업체 정책을 보증하지 않는다. 서버 비밀값은 승인된 production secret으로만 저장했다. API가 마스킹하므로 정확한 값 readback을 주장하지 않으며, 공개값 전용 빌드 입력·완전한 서버키 패턴 검사·로컬 환경파일 해시 보존으로 검증했다.

백업 도구 main은 1514373143bb4f69c581ca5e4c786454515555be, 고정 검증 source는 cf88364d4f811432db7bb8a824b8813012d4743c다. build 및 전체 1,484개 검사(하네스27·단위77·DB/호스팅/복구1,125·미디어34·E2E221)가 통과했다. 완료 2026-10-30T15:35:05.148Z, fingerprint 85f59991b74cdfc91e8c26045dcb4123a0c550b944f5f3200abffb0bd2510c63.

도구·문서 병합과 위 운영배포의 source/version은 구분한다. 리뷰는 최신 HEAD 직접 검토이며 독립 승인으로 표시하지 않는다. 최초 journal stale, 벽시계 역행, Worker 정적 404 실패와 실제 조치·재검증은 docs05/47에 보존했다. 실제 운영 URL의 익명 경계와 대표 7폭 검증도 docs46에 기록했다. HTTP 왕복시간은 CPU 측정이 아니다.

## 실제 원격 복구

Source suuemuqwjwbddbjevvmg의 인증 암호화 archive dfad2bec-629f-4d19-9932-abdd12fdb205와 최신 journal로 별도 Free berprfddzalsotnrxpdb에 앱 32테이블·실제 Google user/identity 1개·실파일 2개(198,396B)를 복구했다. 재다운로드 SHA/크기, RLS·원시 접근 거절, 앱 트리거 원복, 공개0/세션0/가입·쓰기·통계·Cron 중지를 확인했다. Data API public/api 노출 schema·100행 설정은 migration과 별도로 적용했다.

복구 전용 OAuth와 WSL loopback4178 임시 화면에서 실제 Google 새 로그인, 기존 개체·사진·API 조회를 확인했다. 사용자가 승인한 복구 복사본만 탈퇴해 Auth·프로필·개체·Storage·세션0, 최소 탈퇴기록1, 이전 요청 토큰 1회 재사용401, 기존 Storage 경로 2개의 HTTP400/semantic404를 확인했다. 토큰은 서버 메모리에서만 사용했다.

복사된 미래 업로드 cleanup 기한 때문에 대기하던 asset 1개는 복구본에서만 통제 만료했다. 자연 경과 시험이나 만료 전 동일 signed URL 재검사로 주장하지 않는다. 복구 Google는 다시 비활성화했고 가입·email·phone은 닫혀 있다. 임시4178 서버는 종료했다. 원본 계정·개체·사진과 새 로그인 세션은 보존했다.

실제 source 회원의 백업 후 탈퇴→최신 journal→원격 재복구 통합은 수행하지 않았다. 탈퇴·숨김·중지 reconciliation은 네트워크 없는 합성 회귀 4개와 복구본 강제 비공개로 구분해 검사했다. 운영 프로젝트에 복구 시험을 덮어쓰지 않는다. 자세한 보호·실패 절차는 [docs47](47-production-backup-recovery.md)을 따른다.

## 매일 백업하기

기본 책임자는 사용자이며 자동 데몬은 없다. WSL 기준 저장소에서 수동 실행한다.

    cd /home/eykim/projects/reptilelink
    npm run production:backup -- create suuemuqwjwbddbjevvmg
    npm run production:backup -- journal suuemuqwjwbddbjevvmg

create는 읽기 전용 DB snapshot·실제 파일과 최신 journal을 인증 암호화한다. archive/journal은 /home/eykim/projects/.reptilelink-production-backups, 키는 별도 /home/eykim/projects/.reptilelink-production-backup-keys/backup-v1.key에 보관한다. 일일 1회·7일 보관이며 계정·탈퇴·공개·중지 변경 후와 복구 직전에는 새 journal을 만든다. 복구에는 15분 이내·백업 이후·같은 epoch의 journal이 필요하다. 키가 없거나 인증에 실패하면 중단한다. 키와 archive를 함께 공개하거나 채팅·Git에 넣지 않는다.

create/prune 때 인증된 동일 소유 store/source/id의 7일 경과 archive/journal만 정리한다. 명령을 실행하지 않는 기간의 자동 삭제를 약속하지 않는다. 최신 archive cf6335a4-a690-4ab6-ad6e-e5a02afa6585는 실파일 2개·198,396B와 인증 journal을 포함한다. 이 최신 archive 자체의 재복구는 수행하지 않았고 실제 원격 복구는 앞선 dfad2bec 증거다. 복구 직전에는 반드시 새 journal을 만든다. 서버키·Google secret·세션·Vault는 별도 재연결 대상이다.

복구 전 전용 빈 대상·Free/0원·ref/조직/서울·37 migration을 확인하고 docs47의 명령을 사용한다. 비어 있지 않은 대상, 오래된 journal, 기존 파일 덮어쓰기와 운영 ref 복구는 거절된다. 실패 시 격리·중지를 유지하고 일반 reset·전역 cleanup으로 강행하지 않는다. 기존 local:backup/doctor의 원격 차단도 유지한다.

## 남은 검증·다음 작업

- 다른 실회원·타인 권한을 포함한 운영 URL 전체 흐름과 모든 오류·취소·미저장·재동의 조합, 최종 디자인·브랜드 권리 확인.
- 실제 source 회원의 post-backup 탈퇴/journal 원격 통합과 만료 전 동일 signed URL의 삭제 후 재요청.
- 실제 Netlify CPU·전송량 경고선 측정.
- 운영 요청 경로에서 제외된 Cloudflare 전용 임시 자원의 철거 확인. 770 DNS와 다른 서비스는 보존한다.
- 증거와 남은 범위를 검토한 사용자의 최종 출시 결정. [이슈62](https://github.com/KimEunYeol/reptilelink/issues/62)는 남은 항목을 열어 둔다.

Windows 진입 폴더는 README.md·Open-Reptilelink-WSL.cmd·기존 .git만 유지한다. 실행기는 WSL 프로젝트와 START_HERE·docs40/41/46/47/48을 연다. 소스·현행 문서·빌드·테스트·배포 CLI는 WSL에서 수행한다. 수정 전후 목록·해시와 고유 증거 보존 판단은 WSL 비공개 기록에 남기며 별도 레거시 사본을 만들지 않는다.
