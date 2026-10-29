# 공개 최소 DTO와 초기 HTML 수명 (#36)

감사 PR41/main352b596 뒤의 독립 작업이다. F07의 최소 공개 응답을 보완하며 화면의 시각 마감은 #39에서 계속한다.

profiles/animals/animal_photos/growth_records/social_links/external_links/schedules의 anon/authenticated 테이블 권한과 개별 열 권한을 회수했다. RLS는 유지한다. 이전 invoker 공개3함수는 필요한 최소 DTO를 반환하는 definer로 바꾸고 빈 search_path·완전한 스키마 지정·기존 제한된 EXECUTE(anon/authenticated, PUBLIC 없음)를 보존했다. [Supabase 공식 함수 지침](https://supabase.com/docs/guides/database/functions)의 권한/검색 경로 조건을 따르며 definer 자체를 RLS 보장이라고 주장하지 않는다.

public_page/public_schedules는 현재 active+published를 명시 검사한다. 개체는 같은 프로필/is_public/미삭제, 링크/SNS/일정은 같은 프로필/is_public이다. 소유자 JWT도 비공개 항목을 받지 않는다. 성장 RPC는 active/published/개체공개/미삭제/show_growth와 성장 행의 소유 관계를 검사한다. 프로필/개체 사진 ID는 동일 소유자·용도·ready 및 연결 관계를 검사한다. 실제 바이트 접근은 기존 media_access의 현재 공개·stored/ready 검사를 계속 거친다. Auth UUID·revision·생성/수정 시각·경로·사용량·비공개 메모는 공개 DTO에서 제외한다. 관리/서비스 RPC는 기존 계약을 유지한다.

PublicView는 public-bootstrap 요소를 읽은 즉시 DOM에서 제거한다. 처음 일치하는 경로에만 초기 DTO를 쓰고 이후 SPA/Back은 현재 public_page를 조회한다. 실패·숨김은 이전 HTML을 다시 표시하는 경로로 대체하지 않는다. 이미 사용자가 받은 화면/파일을 회수한다는 뜻은 아니다. Worker 초기 HTML은 기존 no-store/최소 DTO/일반404를 보존한다.

## 실제 검증

- 새 폐기용 QA2개로 원본7테이블×3역할 거절·열권한0·최소 필드·소유자 공개경계·성장 opt-in·숨김/미삭제·suspended/deleting·수정가능 메타데이터 위장을 실제 DB32개로 확인했다. 삭제 표시 조건은 트랜잭션에서 실제 함수를 anon으로 호출한 뒤 롤백하며 기존 삭제 흐름 HTTP 회귀도 전체 검증한다.
- 실제 Worker 브라우저3흐름: 초기 요소 소비→로그인 SPA 이동→비공개 뒤 Back, 값 변경 뒤 Back/현재조회503, 실제 HTML/metadata/no-store와7폭·키보드 이동. 320/360/390/450/768/1440/1920 캡처는 artifacts/public-boundary-36에 있다.
- 초기 QA 테스트의 필수 성장 ID/허용 계정 상태 추정을 고치고 해당 실행의 QA만 정리했다. 브라우저 실패 주입은 로그인 URL 도착을 확인하고 명시적503으로 재현한 뒤3개 모두 통과했다. 테스트 실패를 성공 수에 포함하지 않는다.
- 전체 실행에서 탈퇴 회귀의 profiles/animals 빈 결과 기대도 발견해 권한 거절로 보완했다. 기존 원본 테이블의 빈 결과/공개열 조회를 기대하던 회귀는 이제 권한 거절을 검사한다. 공개 API 데이터 기능 검사는 그대로 유지한다. 신규 검증을 test:db와 E2E에 연결했다.
- CLI migration20261029160527_public_data_boundary.sql은 실제 변경 뒤 빈 CLI 파일→제거→db pull/shadow로 생성/적용이력등록했다. 최종 shadow는 No schema changes found, 함수 lint와 보안/성능 advisors 경고 이상 없음. schema.sql은 검토용 append이며 재실행하지 않았다.
- 최종 전체 검증 구성은 build+1074개(하네스12/단위54/DB·Worker832/미디어31/E2E145)다. 최종 파일 상태의 실제 결과/시각/지문은 verify 보고서와 PR을 따른다. 기존5fixture/자료/볼륨 보존·신규 QA/대기 작업 정리·비용0원·콘솔/배포/Actions 없음.

## 원본과 남은 경계

원본 공개 PC/모바일/m-1 및 전체 보드 공개/댓글·PC 공통 설명을 확인했다. 현재 배치/자산을 새로 창작하지 않고 조회 조건/수명만 변경했다. 7폭의 실행 화면을 직접 열어 단일열/기존조작/넘침 없음을 확인했다. 기존 헤더·수제 자산/영문 하단·카드/상세와 원본의 차이를 #39에서 정비한다. 이번 검증으로 전체 디자인 일치나 WCAG 준수를 선언하지 않는다.

QA 과정에서 기존 삭제 대기 개체의 보호 트리거와 계정 탈퇴 일괄 UPDATE가 충돌하는 별도 문제를 발견했다. 새 QA에 한정해 재현했으며 별도 이슈/PR로 이어서 수정한다. 외부 Google OAuth/운영 배포는 이번 검증 범위가 아니다.
