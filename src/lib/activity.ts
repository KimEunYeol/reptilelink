export type ActivityContext={signed_in:boolean;ready:boolean;public_name:string};
export type CommentRow={id:string;body:string|null;created_at:string;status?:'visible'|'hidden'|'deleted';author:{name:string;slug:string|null;avatar_asset_id:string|null};can_delete:boolean;can_hide:boolean;can_report:boolean};
export type CommentCursor={before:string;id:string};
export type CommentPage={rows:CommentRow[];total?:number;next:CommentCursor|null};
export const reportReasons={spam:'스팸·광고',abuse:'욕설·괴롭힘',privacy:'개인정보 노출',other:'기타'} as const;
export function commentText(value:string){const body=value.trim();if(!body||Array.from(body).length>500)throw new Error('댓글은 1~500자로 입력해주세요.');return body;}
export function reportText(value:string){const body=value.trim();if(Array.from(body).length>500)throw new Error('신고 설명은 500자 이내로 입력해주세요.');return body;}
export function activityTime(value:string){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}
export function activityError(reason:unknown){const text=String((reason as {message?:string})?.message??reason);if(text.includes('RATE_LIMITED'))return '요청 횟수 제한에 도달했습니다. 잠시 후 다시 시도해주세요.';if(text.includes('QUOTA_EXCEEDED'))return '이 개체의 댓글 보관 한도에 도달했습니다.';return text;}
export function definiteActivityFailure(reason:unknown){return /^(ACCOUNT_NOT_ACTIVE|CONSENT_REQUIRED|NOT_FOUND|VALIDATION_FAILED|SERVICE_UNAVAILABLE|QUOTA_EXCEEDED|RATE_LIMITED|REQUEST_CONFLICT|REQUEST_EXPIRED)$/.test(String((reason as {message?:string})?.message??reason));}
