import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir } from 'node:fs/promises';
import { collectionItems, type Animal, type CollectionItem, type Dashboard } from '../../src/lib/domain';

const helpersPath = '../../scripts/local-utils.mjs';
const helpers = await import(helpersPath) as { localStatus(): { url:string; publishable:string }; localQuery(sql:string):string; fixturePassword:string };
const status = helpers.localStatus(), storageKey = `sb-${new URL(status.url).hostname.split('.')[0]}-auth-token`;
let owner: SupabaseClient, original: Animal[], originalPublic: boolean, slug:string;
async function dash(): Promise<Dashboard> { const r=await owner.schema('api').rpc('my_dashboard'); expect(r.error).toBeNull(); return r.data; }
async function apply(items:CollectionItem[]) {
  const r=await owner.schema('api').rpc('apply_animal_collection',{p_items:items,p_expected:(await dash()).profile!.revision,p_request_id:crypto.randomUUID()}); expect(r.error).toBeNull();
}
async function signIn(page:Page) {
  const auth=await owner.auth.signInWithPassword({email:'qa-owner@reptilelink.test',password:helpers.fixturePassword}); expect(auth.error).toBeNull();
  await page.goto('/auth/login');
  await page.evaluate(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:storageKey,session:auth.data.session});
  await page.goto('/dashboard/animals');
  await expect(page.getByRole('region',{name:'개체 목록 관리'})).toBeVisible();
}
const list = (page:Page) => page.getByRole('region',{name:'개체 목록 관리'});
const card = (page:Page, a:Animal) => list(page).locator(`[data-collection-id="${a.id}"]`);

test.describe('collection apply using real local QA identities',()=>{
  test.beforeAll(async()=>{
    owner=createClient(status.url,status.publishable,{auth:{persistSession:false,autoRefreshToken:false}});
    expect((await owner.auth.signInWithPassword({email:'qa-owner@reptilelink.test',password:helpers.fixturePassword})).error).toBeNull();
    const d=await dash(); original=d.animals; expect(original).toHaveLength(20); originalPublic=d.profile!.is_published; slug=d.profile!.slug;
  });
  test.beforeEach(async({page})=>{
    await apply(collectionItems(original));
    const d=await dash(); if(!d.profile!.is_published) expect((await owner.schema('api').rpc('set_profile_public',{p_public:true,p_expected:d.profile!.revision})).error).toBeNull();
    await signIn(page);
  });
  test.afterAll(async()=>{
    if(!original) return; await apply(collectionItems(original));
    expect((await owner.schema('api').rpc('set_profile_public',{p_public:originalPublic,p_expected:(await dash()).profile!.revision})).error).toBeNull();
  });

  test('source-width list is usable at seven widths, and hidden-page edits cancel without writes',async({page})=>{
    await mkdir('artifacts/collection-6',{recursive:true});
    for(const width of [320,360,390,450,768,1440,1920]){
      await page.setViewportSize({width,height:900});
      await expect(list(page).locator('article')).toHaveCount(10);
      expect((await list(page).boundingBox())!.width).toBeLessThanOrEqual(378);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await list(page).getByRole('button',{name:'개체 등록',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:`artifacts/collection-6/list-${width}.png`});
    }
    const before=await dash();
    await card(page,original[0]).getByRole('switch').click();
    await expect(card(page,original[0]).getByRole('button',{name:`${original[0].name} 상세 보기`,exact:true})).toBeDisabled();
    await list(page).getByRole('button',{name:'다음 페이지',exact:true}).click();
    await card(page,original[10]).getByRole('switch').click();
    await card(page,original[10]).getByRole('button',{name:`${original[10].name} 위로`,exact:true}).click();
    await expect(list(page).getByRole('button',{name:'1페이지',exact:true})).toHaveAttribute('aria-current','page');
    await expect(card(page,original[10])).toBeFocused();
    await expect(card(page,original[0]).getByRole('switch')).toHaveAttribute('aria-checked',String(!original[0].is_public));
    expect(collectionItems((await dash()).animals)).toEqual(collectionItems(before.animals));
    expect((await dash()).profile!.revision).toBe(before.profile!.revision);
    await list(page).getByRole('button',{name:'변경 취소',exact:true}).click();
    await expect(list(page).getByRole('button',{name:'적용하기',exact:true})).toBeDisabled();
    expect(collectionItems((await dash()).animals)).toEqual(collectionItems(before.animals));
  });

  test('applies all pages once, survives reload/relogin and updates anonymous HTML order',async({page,request})=>{
    const before=await dash(); let saves=0;
    page.on('request',r=>{if(r.url().includes('/rpc/apply_animal_collection'))saves++;});
    await card(page,original[0]).getByRole('switch').click();
    await card(page,original[1]).getByRole('button',{name:`${original[1].name} 위로`,exact:true}).click();
    await list(page).getByRole('button',{name:'다음 페이지',exact:true}).click();
    await card(page,original[19]).getByRole('switch').click();
    await list(page).getByRole('button',{name:'적용하기',exact:true}).dblclick();
    await expect(list(page).getByRole('status')).toContainText('목록을 적용했어요.'); expect(saves).toBe(1);
    const saved=await dash(); expect(saved.profile!.revision).toBe(before.profile!.revision+1);
    expect(saved.animals[0].id).toBe(original[1].id); expect(saved.animals[1].id).toBe(original[0].id);
    expect(saved.animals.find(a=>a.id===original[0].id)!.is_public).toBe(!original[0].is_public);
    expect(saved.animals.find(a=>a.id===original[19].id)!.is_public).toBe(!original[19].is_public);
    await page.reload(); await expect(list(page).locator('article').first()).toHaveAttribute('data-collection-id',original[1].id);
    await page.getByRole('button',{name:'로그아웃',exact:true}).click(); await signIn(page);
    await expect(list(page).locator('article').first()).toHaveAttribute('data-collection-id',original[1].id);
    const response=await request.get(`http://localhost:8787/u/${slug}`); expect(response.status()).toBe(200);
    const html=await response.text(), bootstrap=JSON.parse(html.match(/id="public-bootstrap">(.*?)<\/script>/s)![1]);
    expect(bootstrap.animals.map((a:Animal)=>a.id)).toEqual(saved.animals.filter(a=>a.is_public).map(a=>a.id));
    expect(html).not.toMatch(/qa-owner@|profile_id|object_path|request_hash/);
  });

  test('lost response preserves draft and retries the same receipt without a second revision',async({page})=>{
    const before=(await dash()).profile!.revision, ids:string[]=[];
    await card(page,original[0]).getByRole('switch').click();
    await page.route('**/rest/v1/rpc/apply_animal_collection',async route=>{ids.push(route.request().postDataJSON().p_request_id);await route.fetch();await route.abort('failed');});
    await list(page).getByRole('button',{name:'적용하기',exact:true}).click();
    await expect(list(page).getByRole('alert')).toContainText('연결');
    await expect(card(page,original[0]).getByRole('switch')).toHaveAttribute('aria-checked',String(!original[0].is_public));
    await page.unroute('**/rest/v1/rpc/apply_animal_collection');
    page.on('request',r=>{if(r.url().includes('/rpc/apply_animal_collection'))ids.push(r.postDataJSON().p_request_id);});
    await list(page).getByRole('button',{name:'적용하기',exact:true}).click();
    await expect(list(page).getByRole('status')).toContainText('목록을 적용했어요.');
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]); expect((await dash()).profile!.revision).toBe(before+1);
  });

  test('conflicts require explicit latest-list review before keeping a draft and applying',async({page})=>{
    await card(page,original[1]).getByRole('button',{name:`${original[1].name} 위로`,exact:true}).click();
    await apply([...collectionItems(original)].reverse());
    await list(page).getByRole('button',{name:'적용하기',exact:true}).click();
    await expect(list(page).getByRole('alert')).toContainText('다른 화면');
    await expect(list(page).locator('article').first()).toHaveAttribute('data-collection-id',original[1].id);
    await expect(list(page).getByRole('button',{name:'적용하기',exact:true})).toBeDisabled();
    await list(page).getByRole('button',{name:'최신 목록 확인',exact:true}).click();
    await expect(list(page).getByRole('list',{name:'최신 저장 목록'}).locator('li')).toHaveCount(20);
    await list(page).getByRole('button',{name:'내 목록 유지',exact:true}).click();
    await list(page).getByRole('button',{name:'적용하기',exact:true}).click();
    await expect(list(page).getByRole('status')).toContainText('목록을 적용했어요.');
    expect((await dash()).animals[0].id).toBe(original[1].id);
  });

  test('keyboard and drag reorder, dirty navigation and cancel preserve the unsaved full list',async({page})=>{
    await page.setViewportSize({width:1440,height:1500});
    await card(page,original[1]).getByRole('button',{name:`${original[1].name} 위로`,exact:true}).focus();
    await page.keyboard.press('Enter');
    await expect(list(page).locator('article').first()).toHaveAttribute('data-collection-id',original[1].id);
    await card(page,original[1]).dragTo(card(page,original[2]));
    await expect(list(page).locator('article').nth(2)).toHaveAttribute('data-collection-id',original[1].id);
    await page.getByRole('link',{name:'프로필 설정',exact:true}).click();
    await expect(list(page).getByRole('alert')).toContainText('적용하지 않은');
    await list(page).getByRole('button',{name:'계속 수정',exact:true}).click();
    expect((await dash()).animals.map(a=>a.id)).toEqual(original.map(a=>a.id));
    await page.getByRole('link',{name:'프로필 설정',exact:true}).click();
    await list(page).getByRole('button',{name:'변경 버리고 이동',exact:true}).click();
    await expect(page).toHaveURL(/\/dashboard\/design$/);
    await page.getByRole('link',{name:/개체 관리/}).click();
    await expect(list(page).locator('article').first()).toHaveAttribute('data-collection-id',original[0].id);
  });

  test('a failed refresh after a committed apply keeps the draft visible for a safe retry',async({page})=>{
    await card(page,original[0]).getByRole('switch').click();
    const before=(await dash()).profile!.revision;
    await page.route('**/rest/v1/rpc/my_dashboard',route=>route.abort('failed'));
    await list(page).getByRole('button',{name:'적용하기',exact:true}).click();
    await expect(list(page)).toBeVisible(); await expect(list(page).getByRole('alert')).toContainText('연결');
    await page.unroute('**/rest/v1/rpc/my_dashboard');
    await list(page).getByRole('button',{name:'적용하기',exact:true}).click();
    await expect(list(page).getByRole('status')).toContainText('목록을 적용했어요.');
    expect((await dash()).profile!.revision).toBe(before+1);
  });

  test('a changed membership cannot keep an obsolete full-set draft',async({page})=>{
    const removed=original[19];
    // This dedicated QA row has no media/notes to cascade; preserve its complete row for restoration.
    expect(removed.photos).toHaveLength(0);
    expect(helpers.localQuery(`select count(*) from private.animal_notes where animal_id='${removed.id}'`).trim()).toBe('0');
    const row=helpers.localQuery(`select to_jsonb(a) from public.animals a where id='${removed.id}'`).trim();
    const actor=(await dash()).profile!.id;
    await card(page,original[0]).getByRole('switch').click();
    try {
      helpers.localQuery(`begin;delete from public.animals where id='${removed.id}' and profile_id='${actor}';update public.profiles set revision=revision+1 where id='${actor}';commit;`);
      await list(page).getByRole('button',{name:'적용하기',exact:true}).click();
      await expect(list(page).getByRole('alert')).toContainText('다른 화면');
      await list(page).getByRole('button',{name:'최신 목록 확인',exact:true}).click();
      await expect(list(page).getByRole('button',{name:'내 목록 유지',exact:true})).toBeDisabled();
      await list(page).getByRole('button',{name:'최신 목록으로 바꾸기',exact:true}).click();
      await expect(list(page).getByRole('button',{name:'적용하기',exact:true})).toBeDisabled();
      await list(page).getByRole('button',{name:'다음 페이지',exact:true}).click();
      await expect(list(page).locator('article')).toHaveCount(9);
    } finally {
      helpers.localQuery(`insert into public.animals select * from jsonb_populate_record(null::public.animals,'${row.replaceAll("'","''")}')`);
    }
  });
});
