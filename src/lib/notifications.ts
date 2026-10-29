import type {CommentCursor} from './activity';
import type {LikeMember} from './likes';
export type NotificationRow={id:string;kind:'comment'|'profile_like';created_at:string;read_at:string|null;available:boolean;body:string|null;author:LikeMember['author'];target:{slug:string;animal_id:string}|null};
export type NotificationPage={rows:NotificationRow[];next:CommentCursor|null;unread:number};
export type ReadCommand={ids:string[];id:string;started:number;wallStarted:number;cursor:CommentCursor|null};
export function notificationText(row:NotificationRow){return !row.available?'현재 확인할 수 없는 알림입니다.':row.kind==='profile_like'?`${row.author.name}님이 프로필을 좋아합니다.`:`${row.author.name}님이 댓글을 남겼습니다: ${row.body??''}`;}
export function filterLikeMembers(rows:LikeMember[],query:string){const term=query.trim().toLocaleLowerCase('ko-KR');return term?rows.filter(r=>r.author.name.toLocaleLowerCase('ko-KR').includes(term)):rows;}
