import type {PolicyStatus} from './policy';
import {profileNameSchema,profileBioSchema} from './design';
import type {PublicSchedule} from './schedules';
import type {PublicSocial} from './socials';
import type { PublicLink } from './links';
import { z } from 'zod';

export const profileSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, '주소는 소문자 영문·숫자·하이픈 3~30자로 입력해주세요.'),
  name: profileNameSchema,
  bio: profileBioSchema,
});
export const animalSchema = z.object({
  name: z.string().trim().min(1, '개체 이름을 입력해주세요.').max(40),
  species: z.string().trim().min(1, '종류를 입력해주세요.').max(80),
  morph: z.string().trim().max(120),
  sex: z.enum(['unknown', 'male', 'female']),
  description: z.string().trim().max(500),
  listing_status: z.enum(['not_listed', 'available', 'reserved', 'rehomed']),
  is_public: z.boolean(),
});
export type AnimalInput = z.infer<typeof animalSchema>;
export function seoulDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
const editText = (max: number, required = false) => z.string().trim().refine(value =>
  (!required || value.length > 0) && [...value].length <= max, `1~${max}자 이내로 입력해주세요.`);
export const animalEditSchema = z.object({
  name: editText(40, true), species: editText(80, true), morph: editText(120),
  sex: z.enum(['unknown', 'male', 'female']),
  birth_date: z.string().refine(value => {
    if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && value <= seoulDate();
  }, '생일은 오늘까지의 올바른 날짜로 입력해주세요.').nullable(),
  description: editText(500), listing_status: z.enum(['not_listed', 'available', 'reserved', 'rehomed']),
}).strict();
export type AnimalEditInput = z.infer<typeof animalEditSchema>;
const adoptionDateSchema = z.string().refine(value => {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && value <= seoulDate();
}, '입양일은 오늘까지의 올바른 날짜로 입력해주세요.').nullable();
const adoptionOrder = (value: {birth_date: string|null; adoption_date: string|null}, context: z.RefinementCtx) => {
  if (value.birth_date && value.adoption_date && value.adoption_date < value.birth_date)
    context.addIssue({code:'custom',path:['adoption_date'],message:'입양일은 해칭일보다 이르지 않아야 합니다.'});
};
/** The old seven-field command stays compatible; the source extension uses this explicit contract. */
export const animalDetailsSchema = animalEditSchema.extend({adoption_date:adoptionDateSchema}).superRefine(adoptionOrder);
export type AnimalDetailsInput = z.infer<typeof animalDetailsSchema>;
export const animalRegistrationSchema = animalEditSchema.extend({adoption_date:adoptionDateSchema,is_public:z.boolean()}).superRefine(adoptionOrder);
export const collectionSchema = z.array(z.object({ id: z.uuid(), is_public: z.boolean() }).strict()).max(20)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, '중복된 개체가 있습니다.');
export type CollectionItem = z.infer<typeof collectionSchema>[number];
export const collectionItems = (animals: Pick<Animal, 'id' | 'is_public'>[]): CollectionItem[] => animals.map(({ id, is_public }) => ({ id, is_public }));
export function moveCollection(items: CollectionItem[], from: number, to: number): CollectionItem[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
export type Photo = { asset_id: string; sort_order: number };
export type Animal = AnimalInput & { id: string; birth_date: string | null; adoption_date?:string|null;father_asset_id?:string|null;mother_asset_id?:string|null; comment_count?:number; sort_order: number; photos: Photo[] };
export type Profile = { id: string; slug: string; display_name: string; bio: string; is_published: boolean; revision: number; first_published_at: string | null; tagline?: string; theme_token?: string; avatar_asset_id?:string|null;cover_asset_id?:string|null };
export type PendingAnimalDeletion = { id: string; name: string; requested_at: string };
export type AccountDeletion={request_id:string;requested_at:string;sessions_revoked:boolean;phase:'sessions'|'files'|'auth'};
export type Dashboard = { policy?:PolicyStatus; account_deletion?:AccountDeletion|null; account_status: string; profile: Profile | null; animals: Animal[]; pending_deletions?: PendingAnimalDeletion[]; usage: { stored_bytes: number; reserved_bytes: number; limit_bytes: number } | null };
export type PublicPage = { like_count?:number; server_now?: string; schedules?: PublicSchedule[]; socials?: PublicSocial[]; links?: PublicLink[]; profile: Pick<Profile, 'slug' | 'display_name' | 'bio' | 'tagline' | 'theme_token' | 'avatar_asset_id' | 'cover_asset_id'>; animals: Animal[] };
export const sexLabels = { unknown: '미구분', male: '수컷', female: '암컷' };
export const statusLabels = { not_listed: '함께하는 아이', available: '분양 중', reserved: '예약 중', rehomed: '분양 완료' };
export function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
export function userMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  const translations: Record<string, string> = {
    VERSION_CONFLICT: '다른 화면에서 정보가 변경됐습니다. 최신 내용을 불러온 뒤 다시 적용해주세요.',
    QUOTA_EXCEEDED: '무료 사용 한도에 도달했습니다. 기존 항목이나 사진을 정리해주세요.',
    ACCOUNT_NOT_ACTIVE: '승인된 계정만 사용할 수 있습니다.',
    NOT_FOUND: '항목을 찾을 수 없거나 접근할 수 없습니다.',
    SLUG_LOCKED: '공개한 페이지의 주소는 변경할 수 없습니다.',
    SLUG_RESERVED: '사용할 수 없는 주소입니다. 다른 주소를 입력해주세요.',
    CONSENT_REQUIRED: '이용 안내에 동의해주세요.',
    POLICY_CHANGED: '안내 버전이 변경됐습니다. 최신 안내를 다시 불러와 확인해주세요.',
    POLICY_NOT_READY: '운영 문서를 준비 중입니다. 아직 필수 안내를 확인할 수 없습니다.',
    SERVICE_UNAVAILABLE: '지금은 저장을 잠시 사용할 수 없습니다.',
    UPLOAD_EXPIRED: '사진 업로드 시간이 만료됐습니다. 다시 시도해주세요.',
    VALIDATION_FAILED: '입력값을 확인해주세요.',
    REQUEST_CONFLICT: '저장 요청 내용이 달라졌습니다. 입력값을 확인하고 다시 저장해주세요.',
    REQUEST_EXPIRED: '저장 요청이 만료됐습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.',
  };
  for (const [code, translation] of Object.entries(translations)) if (message.includes(code)) return translation;
  if (message.includes('duplicate key') || message.includes('23505')) return '이미 사용 중인 주소입니다. 다른 주소를 입력해주세요.';
  if (message.includes('Invalid login credentials')) return '로그인 정보를 확인해주세요. 로컬 테스트 계정은 먼저 준비해야 합니다.';
  if (/fetch|network|Failed to fetch/i.test(message)) return '연결을 확인해주세요. 로컬 백엔드가 실행 중인지 확인해주세요.';
  return '요청을 처리하지 못했습니다. 입력 내용을 확인하고 다시 시도해주세요.';
}
