import {describe,it,expect} from 'vitest';
import {designInputSchema,designProfileSchema,profileNameSchema,profileBioSchema,designOptionsSchema} from '../src/lib/design';
import {emptySocials} from '../src/lib/socials';
import {profileSchema} from '../src/lib/domain';
const valid={display_name:'페이지 이름',tagline:'한 줄 소개',bio:'첫 줄\n둘째 줄'};
describe('combined design profile and SNS boundaries',()=>{
 it('counts trimmed Unicode names, introduction and multiline biography consistently',()=>{expect(designProfileSchema.parse({display_name:'\uFEFF\u00a0 '+'🦎'.repeat(40)+' \u3000',tagline:'🦎'.repeat(80),bio:'🦎'.repeat(300)}).display_name).toBe('🦎'.repeat(40));expect(profileBioSchema.parse(' \n내용\n ')).toBe('내용');});
 it('rejects excessive lengths and line/control characters in one-line fields',()=>{for(const patch of [{display_name:'\u00a0\uFEFF'},{display_name:'🦎'.repeat(41)},{tagline:'🦎'.repeat(81)},{bio:'🦎'.repeat(301)},{display_name:'이름\n뒤'},{tagline:'한 줄\u2028다음 줄'},{display_name:'이름\u0085뒤'},{bio:'a\u0000b'}])expect(designProfileSchema.safeParse({...valid,...patch}).success).toBe(false);expect(profileNameSchema.safeParse('이름\t뒤').success).toBe(false);});
 it('rejects unknown account/media/theme fields instead of treating them as profile text',()=>{for(const patch of [{id:crypto.randomUUID()},{slug:'other'},{is_published:true},{theme_token:'custom'},{avatar_asset_id:crypto.randomUUID()}])expect(designProfileSchema.safeParse({...valid,...patch}).success).toBe(false);});
 it('validates the entire profile and SNS set before a combined save',()=>{expect(designInputSchema.parse({profile:valid,links:emptySocials()}).profile).toEqual(valid);const links=emptySocials();links[0]={...links[0],url:'javascript:alert(1)',is_public:true};expect(designInputSchema.safeParse({profile:valid,links}).success).toBe(false);expect(designInputSchema.safeParse({profile:{...valid,display_name:''},links:emptySocials()}).success).toBe(false);});
 it('shares the same Unicode name and biography boundaries with onboarding/account editing',()=>{expect(profileSchema.parse({slug:'qa-name',name:'🦎'.repeat(40),bio:'🦎'.repeat(300)}).name).toBe('🦎'.repeat(40));expect(profileSchema.safeParse({slug:'qa-name',name:'이름\n두 줄',bio:''}).success).toBe(false);});
});

describe('profile image and theme options',()=>{
 it('accepts opaque UUIDs and the three supplied theme tokens only',()=>{for(const theme_token of ['green','mint','forest'])expect(designOptionsSchema.parse({avatar_asset_id:crypto.randomUUID(),cover_asset_id:null,theme_token}).theme_token).toBe(theme_token);});
 it('rejects URLs, CSS, malformed IDs and extra private fields',()=>{const base={avatar_asset_id:null,cover_asset_id:null,theme_token:'green'};for(const patch of [{avatar_asset_id:'https://example.com/a.webp'},{cover_asset_id:'../a'},{theme_token:'red'},{theme_token:'url(javascript:)'},{object_path:'private/a.webp'}])expect(designOptionsSchema.safeParse({...base,...patch}).success).toBe(false);});
});
