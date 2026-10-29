import {localStatus,localQuery} from './local-utils.mjs';
// Development instructions only. This command must never publish operating policies.
export const previewTerms=[
 '현재 안내는 로컬 개발 흐름을 확인하기 위한 미리보기입니다. 실제 서비스의 이용약관은 운영 주체와 수집·보관 기준을 확정한 후 게시합니다.',
 '초대·승인된 계정으로 개체 기록과 공개 페이지를 확인합니다. 결제·문자 인증·분양 거래 기능은 제공하지 않습니다.',
 '이 안내를 정식 운영 문서로 사용하지 않습니다. 운영용 문서와 연락처가 게시되기 전에는 서비스 출시 검증이 완료된 상태가 아닙니다.'
].join('\n\n');
export const previewPrivacy=[
 '현재 안내는 로컬 개발 흐름을 확인하기 위한 미리보기입니다. 실제 서비스의 개인정보 처리방침은 운영 주체와 수집·보관 기준을 확정한 후 게시합니다.',
 '로컬 테스트 계정의 프로필과 개체 사진은 로컬 Supabase에 저장됩니다. 공개로 설정한 정보만 방문자에게 표시됩니다. 실명·연락처·민감한 자료 대신 테스트 데이터를 사용해주세요.',
 '이 안내를 정식 운영 문서로 사용하지 않습니다. 운영용 문서와 연락처가 게시되기 전에는 서비스 출시 검증이 완료된 상태가 아닙니다.'
].join('\n\n');
export function preparePolicyPreview(){
 localStatus(); // Enforces the selected loopback-only local backend without printing keys.
 const q=v=>"'"+v.replaceAll("'","''")+"'";
 localQuery(`begin;
 insert into private.policy_versions(version,terms_body,privacy_body,is_preview) values('local-preview-v1',${q(previewTerms)},${q(previewPrivacy)},true) on conflict do nothing;
 do $$begin if not exists(select 1 from private.policy_versions where version='local-preview-v1' and terms_body=${q(previewTerms)} and privacy_body=${q(previewPrivacy)} and is_preview) then raise exception 'Preview version content mismatch; create a new version instead of rewriting history';end if;end$$;
 insert into private.policy_settings(id,required_version,mode) values(1,'local-preview-v1','preview') on conflict(id) do nothing;
 commit;`);
 console.log('Local policy preview prepared; existing configuration and consent history preserved. This is not an operating policy.');
}
if(import.meta.url===new URL(process.argv[1],'file:').href)preparePolicyPreview();
