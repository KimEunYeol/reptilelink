import {z} from 'zod';
export type ScheduleStatus='SOON'|'OPEN'|'ALWAYS'|'CLOSE';
export type ScheduleInput={title:string;description:string;starts_at:string|null;ends_at:string|null;is_always:boolean;is_closed:boolean};
export type Schedule=ScheduleInput & {id:string;is_public:boolean;sort_order:number;status:ScheduleStatus};
export type ScheduleSnapshot={revision:number;server_now:string;schedules:Schedule[]};
export type PublicSchedule=Omit<Schedule,'is_public'|'sort_order'>;
export type PublicSchedules={server_now:string;schedules:PublicSchedule[]};
export type ScheduleItem={id:string;is_public:boolean};
export const scheduleItems=(rows:Schedule[]):ScheduleItem[]=>rows.map(({id,is_public})=>({id,is_public}));
export const scheduleStatus=(r:Pick<ScheduleInput,'is_always'|'is_closed'|'starts_at'|'ends_at'>,now:number):ScheduleStatus=>r.is_closed?'CLOSE':r.is_always?'ALWAYS':now<Date.parse(r.starts_at!)?'SOON':now<Date.parse(r.ends_at!)?'OPEN':'CLOSE';
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function seoulParts(instant:string|number){const parts=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));return `${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;}
export const seoulMinute=(instant:string)=>seoulParts(instant).slice(0,16);
/** Resolve real IANA Seoul offsets; an overlap selects the later instant, matching PostgreSQL. A missing wall time is rejected. */
function resolveSeoul(local:string,allowGap=false):string|null{
 if(!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))return null;const wall=Date.parse(local+':00Z');
 if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,16)!==local)return null;
 const options:number[]=[],after:{instant:number;distance:number}[]=[];
 for(const days of [-2,0,2]){const guess=wall+days*86400000,offset=Date.parse(seoulParts(guess)+'Z')-guess,candidate=wall-offset;const shown=seoulParts(candidate),distance=Date.parse(shown+'Z')-wall;if(shown===local+':00')options.push(candidate);else if(distance>0)after.push({instant:candidate,distance});}
 if(options.length)return new Date(Math.max(...options)).toISOString();
 return allowGap&&after.length?new Date(after.sort((a,b)=>a.distance-b.distance)[0].instant).toISOString():null;
}
export const seoulToUtc=(local:string)=>resolveSeoul(local);
export const seoulBoundary=(day:string)=>resolveSeoul(day+'T00:00',true);
const instant=z.string().refine(v=>/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===(v.includes('.')?v:v.replace('Z','.000Z')),'올바른 일시를 입력해주세요.');
export const scheduleInputSchema=z.object({title:z.string().trim().refine(v=>v!==''&&[...v].length<=80&&!v.includes('\u0000'),'제목은1~80자로 입력해주세요.'),description:z.string().refine(v=>[...v].length<=300&&!v.includes('\u0000'),'상세 내용은300자 이내로 입력해주세요.'),starts_at:instant.nullable(),ends_at:instant.nullable(),is_always:z.boolean(),is_closed:z.boolean()}).strict().refine(v=>v.is_always?v.starts_at===null&&v.ends_at===null:Boolean(v.starts_at&&v.ends_at&&Date.parse(v.ends_at)>Date.parse(v.starts_at)),'일반 일정은 시작·종료를 입력하고 종료를 시작 뒤로 설정해주세요.');
export type ScheduleDraft={title:string;description:string;start:string;end:string;is_always:boolean;is_closed:boolean};
export const scheduleDraft=(r:Schedule|null):ScheduleDraft=>({title:r?.title??'',description:r?.description??'',start:r?.starts_at?seoulMinute(r.starts_at):'',end:r?.ends_at?seoulMinute(r.ends_at):'',is_always:r?.is_always??false,is_closed:r?.is_closed??false});
export function scheduleInput(d:ScheduleDraft,original:Schedule|null):ScheduleInput{
 const resolve=(value:string,old:string|null|undefined)=>old&&value===seoulMinute(old)?new Date(old).toISOString():seoulToUtc(value);
 return {title:d.title,description:d.description,starts_at:d.is_always?null:resolve(d.start,original?.starts_at),ends_at:d.is_always?null:resolve(d.end,original?.ends_at),is_always:d.is_always,is_closed:d.is_closed};
}
export function dateRangeProblem(from:string,to:string){for(const day of [from,to])if(day&&(!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00Z'))||new Date(day+'T00:00Z').toISOString().slice(0,10)!==day))return '올바른 날짜 범위를 입력해주세요.';return from&&to&&from>to?'종료일을 시작일 이후로 설정해주세요.':'';}
export function scheduleMatches(r:Pick<ScheduleInput,'is_always'|'starts_at'|'ends_at'>,from:string,to:string){
 if(r.is_always)return true;
 // PostgreSQL normalizes a midnight gap forward and selects the later instant in an overlap.
 const lower=from?seoulBoundary(from):null;
 let upper:string|null=null;if(to){const next=new Date(to+'T00:00Z');next.setUTCDate(next.getUTCDate()+1);upper=seoulBoundary(next.toISOString().slice(0,10));}
 return (!lower||Date.parse(r.ends_at!)>Date.parse(lower))&&(!upper||Date.parse(r.starts_at!)<Date.parse(upper));
}
export function schedulePeriod(r:Pick<ScheduleInput,'is_always'|'starts_at'|'ends_at'>){return r.is_always?'기간설정 없음':`${seoulMinute(r.starts_at!).slice(2).replaceAll('-','.').replace('T',' ')} ~ ${seoulMinute(r.ends_at!).slice(2).replaceAll('-','.').replace('T',' ')}`;}

export function publicSchedulePeriod(r:Pick<ScheduleInput,'is_always'|'starts_at'|'ends_at'>){return r.is_always?'상시':`${seoulMinute(r.starts_at!).slice(2,10).replaceAll('-','.')} ~ ${seoulMinute(r.ends_at!).slice(2,10).replaceAll('-','.')}`;}
