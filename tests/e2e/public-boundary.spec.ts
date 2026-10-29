import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import type {SupabaseClient} from '@supabase/supabase-js';
const hp='../../scripts/account-qa.mjs',lp='../../scripts/local-utils.mjs';
type QA={id:string;slug:string;c:SupabaseClient;email:string};
const h=await import(hp)as{createAccount():Promise<QA>;finishAccount(a:QA):Promise<void>;call(c:SupabaseClient,n:string,p?:Record<string,unknown>):Promise<any>},local=await import(lp)as{localQuery(s:string):string};
const origin='http://localhost:8787';let owner:QA;
test.beforeEach(async()=>{owner=await h.createAccount();await h.call(owner.c,'set_profile_public',{p_public:true,p_expected:(await h.call(owner.c,'my_dashboard')).profile.revision});});
test.afterEach(async()=>{await h.finishAccount(owner);});
test('Worker bootstrap is consumed once; SPA Back checks current publication instead of reviving old HTML',async({page})=>{
 await page.goto(`${origin}/u/${owner.slug}`);await expect(page.getByRole('heading',{name:'탈퇴 QA',exact:true})).toBeVisible();await expect(page.locator('#public-bootstrap')).toHaveCount(0);
 await page.getByRole('link',{name:'나도 시작하기'}).click();await expect(page).toHaveURL(/auth\/login/);
 await h.call(owner.c,'set_profile_public',{p_public:false,p_expected:(await h.call(owner.c,'my_dashboard')).profile.revision});
 await page.goBack();await expect(page.getByRole('heading',{name:'페이지를 찾을 수 없어요',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'탈퇴 QA',exact:true})).toHaveCount(0);
 const r=await page.request.get(`${origin}/u/${owner.slug}`);expect(r.status()).toBe(404);expect(r.headers()['cache-control']).toBe('no-store');expect(await r.text()).not.toContain('public-bootstrap');
});
test('Back observes changed values and failed current reads do not display a previous bootstrap',async({page})=>{
 await page.goto(`${origin}/u/${owner.slug}`);await expect(page.getByRole('heading',{name:'탈퇴 QA',exact:true})).toBeVisible();await page.getByRole('link',{name:'나도 시작하기'}).click();await expect(page).toHaveURL(/auth\/login/);
 local.localQuery(`update public.profiles set display_name='현재 공개 이름'where id='${owner.id}'`);await page.goBack();await expect(page.getByRole('heading',{name:'현재 공개 이름',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'나도 시작하기'}).click();await expect(page).toHaveURL(/auth\/login/);await page.route('**/rest/v1/rpc/public_page',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'SERVICE_UNAVAILABLE',message:'SERVICE_UNAVAILABLE'})}));await page.goBack();await expect(page.getByRole('heading',{name:'페이지를 찾을 수 없어요',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'현재 공개 이름',exact:true})).toHaveCount(0);
});
test('public shell remains usable at seven widths and actual Worker HTML contains only the minimal profile',async({page})=>{
 await mkdir('artifacts/public-boundary-36',{recursive:true});const r=await page.goto(`${origin}/u/${owner.slug}`);expect(r!.status()).toBe(200);expect(r!.headers()['cache-control']).toBe('no-store');const html=await r!.text();const dto=JSON.parse(html.match(/<script type="application\/json" id="public-bootstrap">(.*?)<\/script>/s)![1]);expect(Object.keys(dto.profile).sort()).toEqual(['slug','display_name','bio','tagline','theme_token','avatar_asset_id','cover_asset_id'].sort());expect(html).not.toContain(owner.id);expect(html).not.toContain(owner.email);
 await expect(page.getByRole('heading',{name:'탈퇴 QA',exact:true})).toBeVisible();for(const width of[320,360,390,450,768,1440,1920]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`artifacts/public-boundary-36/public-${width}.png`,fullPage:true});}
 await page.getByRole('link',{name:'나도 시작하기'}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/auth\/login/);
});
