# 삭제 대기 개체가 있는 계정의 탈퇴 (#42)

공개 경계 PR43/main0b2b6c4 뒤의 독립 수정이다. 실제 신규 QA에서 delete_animal→request_account_deletion을 같은 트랜잭션으로 호출해 private.protect_deleted_animal의 NOT_FOUND를 재현했다. 탈퇴가 이미 삭제 표시된 개체까지 다시 UPDATE하려던 것이 원인이다. 재현 트랜잭션은 모두 롤백하고 해당 QA만 정리했다.

request_account_deletion의 개체 UPDATE에 deleted_at is null 조건 하나를 추가했다. 기존 삭제 행/시각/작업은 수정하지 않는다. protect_deleted_animal은 계속 모든 삭제 행 UPDATE를 거절한다. 본인 확인·계정/예산/프로필 잠금·revision/영수증·즉시 deleting/공개차단·초대폐기·세션 해지·파일/용량·최종 Auth 삭제 순서는 유지한다. 계정 파일 정리는 profile_id의 모든 자산을 포함하므로 기존 개체 삭제 대기의 파일도 정리한다. 실제 파일이 남으면 계정과 용량을 유지하고, 최종 프로필 삭제가 개체 작업/성장/메모 관계를 CASCADE한다.

실제 사진 검증은 avatar/cover/animal 3자산·6개 Storage 객체를 만든 뒤 개체를 삭제 대기로 보내고 탈퇴한다. 삭제 작업 존재·이전 deleted_at 유지·삭제 행 재수정 거절, 임대기간 중 용량/파일 유지·공개 차단, Storage 오류/거짓 성공/Auth 오류·재시도·최종 파일/관계/Auth 제거까지24개를 확인했다. 기존 테스트의 21개 기능에 조합 조건3개를 더했고, 영수증/동시성 등의 기존 DB 회귀도 전체 실행한다.

기존 탈퇴 브라우저13개가 통과했다. 새 흐름은 실제 삭제 RPC의 대기 상태에서 기존 확인창으로 탈퇴를 완료하고 개체 작업0을 확인한다. 기존 미저장/미확인·Escape/Back/탭 인증·버전 충돌·단계 재개·쓰기 중지·pending/suspended 탈퇴와7폭/초점 검증을 유지한다. UI/스타일/문구 변경이 없어 새 시각 패턴을 만들지 않았다.

CLI20261029162658_withdrawal_pending_animal.sql은 새 빈 CLI파일→제거→실제 db pull/shadow로 생성/이력등록했다. 최종 shadow No schema changes found, 함수 lint/보안·성능 advisors 경고 이상 없음. schema.sql은 검토용 append로만 유지한다. 최종 전체 구성은 build+1078개(하네스12/단위54/DB·Worker832/미디어34/E2E146)이며 실제 최종 파일 상태의 시각/지문/통과 여부는 verify 보고서와 PR을 따른다.

기존5fixture/자료/볼륨은 유지하고 새 QA만 정리했다. 추가비용0원·단일 에이전트·Actions/외부 콘솔/OAuth/배포 없음. 최신 리뷰·명시적 squash·이슈 종료·검증트리와 main 일치/보고 뒤 #37→#38→#39→#40 및 로컬 운영/백업/격리복구를 계속한다.
