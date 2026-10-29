import { z } from 'zod';
export const linkTokens = ['black','gray','blue','mint','green','light-pink','pink','red','purple','yellow','orange'] as const;
export type LinkColor = typeof linkTokens[number];
// Flat pixels sampled from the supplied link-add PNG's two-row palette; no external palette.
export const linkColors: Record<LinkColor, { label: string; background: string }> = {
  black:{label:'검정',background:'#292b2c'},gray:{label:'회색',background:'#666668'},blue:{label:'파랑',background:'#7290d6'},mint:{label:'연두',background:'#8cd58f'},green:{label:'초록',background:'#31ba51'},'light-pink':{label:'연분홍',background:'#f1a2c4'},pink:{label:'분홍',background:'#e96095'},red:{label:'빨강',background:'#dc574c'},purple:{label:'보라',background:'#a781e1'},yellow:{label:'노랑',background:'#f8df59'},orange:{label:'주황',background:'#ea9d59'},
};
export function httpsUrl(value: string): string | null {
  if (/[\u0000-\u001f\u007f-\u009f\\]/.test(value)) return null;
  const raw=value.trim();
  if(!/^https:\/\//i.test(raw)) return null;
  if (/^https:\/\/[^/?#]*@/i.test(raw)) return null;
  try {
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||!u.hostname) return null;
    const host=u.hostname.replace(/\.$/,'');
    if(!host.startsWith('[') && (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i.test(host)||host.length>253||host.split('.').some(part=>part.length>63))) return null;
    const result=u.href;
    return result.length<=2048 && /^[!-~]+$/.test(result) && !/%(?![0-9a-f]{2})/i.test(result) ? result : null;
  } catch { return null; }
}
export const linkInputSchema=z.object({
  title:z.string().trim().refine(v=>v.length>0&&[...v].length<=40&&!v.includes('\u0000'),'제목은 1~40자로 입력해주세요.'),
  url:z.string().refine(v=>httpsUrl(v)!==null,'사용자 정보가 없는 올바른 HTTPS 주소를 2,048자 이내로 입력해주세요.').transform(v=>httpsUrl(v)!),
  color_token:z.enum(linkTokens),
}).strict();
export type LinkInput=z.infer<typeof linkInputSchema>;
export type ExternalLink=LinkInput & {id:string;is_public:boolean;sort_order:number};
export type PublicLink=Pick<ExternalLink,'id'|'title'|'url'|'color_token'>;
export type LinkSnapshot={revision:number;links:ExternalLink[]};
export type LinkItem={id:string;is_public:boolean};
export const linkItems=(rows: ExternalLink[]):LinkItem[]=>rows.map(({id,is_public})=>({id,is_public}));
export function linkTextColor(token:LinkColor) {
  const hex=linkColors[token].background.slice(1),rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.179?'#202428':'#ffffff';
}
export const commandMessage=(reason:unknown)=>String(reason&&typeof reason==='object'&&'message' in reason?reason.message:reason);
export const definitiveLinkError=(reason:unknown)=>/VERSION_CONFLICT|NOT_FOUND|VALIDATION_FAILED|QUOTA_EXCEEDED|SERVICE_UNAVAILABLE|CONSENT_REQUIRED|ACCOUNT_NOT_ACTIVE|REQUEST_CONFLICT|REQUEST_EXPIRED/.test(commandMessage(reason))
  || Boolean(reason&&typeof reason==='object'&&'code' in reason&&/^(22|23)/.test(String(reason.code)));
