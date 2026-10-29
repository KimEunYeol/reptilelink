import { test, expect, type Page, type Locator } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir } from 'node:fs/promises';
import type { Animal, Dashboard } from '../../src/lib/domain';
const helperPath='../../scripts/local-utils.mjs';
const h=await import(helperPath) as { localStatus():{url:string;publishable:string}; localQuery(sql:string):string; localAdmin():SupabaseClient; fixturePassword:string };
const status=h.localStatus(),storageKey=`sb-${new URL(status.url).hostname.split('.')[0]}-auth-token`;
let owner:SupabaseClient,original:Animal,actor:string,profilePublic:boolean,slug:string,beforeAssets:Set<string>;
const fields=(a:Animal)=>Object.fromEntries(['name','species','morph','sex','birth_date','description','listing_status'].map(k=>[k,a[k as keyof Animal]]));
async function dash():Promise<Dashboard>{const r=await owner.schema('api').rpc('my_dashboard');expect(r.error).toBeNull();return r.data;}
const current=async()=> (await dash()).animals.find(a=>a.id===original.id)!;
async function reset(){const r=await owner.schema('api').rpc('save_animal_edit',{p_animal_id:original.id,p_data:fields(original),p_assets:[],p_expected:(await dash()).profile!.revision,p_request_id:crypto.randomUUID()});expect(r.error).toBeNull();}
const assetIds=()=>new Set<string>(JSON.parse(h.localQuery(`select coalesce(jsonb_agg(id),'[]') from private.media_assets where profile_id='${actor}' and animal_id='${original.id}'`)));
async function signIn(page:Page){const auth=await owner.auth.signInWithPassword({email:'qa-owner@reptilelink.test',password:h.fixturePassword});expect(auth.error).toBeNull();await page.goto('/auth/login');await page.evaluate(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:storageKey,session:auth.data.session});await page.goto('/dashboard/animals');await expect(page.getByRole('region',{name:'개체 목록 관리'})).toBeVisible();}
async function open(page:Page){await page.getByRole('button',{name:`${(await current()).name} 상세 보기`,exact:true}).click();const d=page.getByRole('dialog',{name:'개체 수정',exact:true});await expect(d).toBeVisible();return d;}
async function choose(page:Page,d:Locator,action='사진 추가',color='#185fbe'){
  const png=await page.evaluate(c=>{const canvas=document.createElement('canvas');canvas.width=720;canvas.height=480;const ctx=canvas.getContext('2d')!;ctx.fillStyle=c;ctx.fillRect(0,0,720,480);return canvas.toDataURL('image/png').split(',')[1];},color);
  const chooser=page.waitForEvent('filechooser');await d.getByRole('button',{name:action,exact:true}).click();await (await chooser).setFiles({name:'photo-qa.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(d.getByAltText('선택한 사진 미리보기')).toBeVisible();
}
async function save(d:Locator){await d.getByRole('button',{name:'저장',exact:true}).click();await expect(d).not.toBeVisible({timeout:45000});}
async function replaceFromOtherEditor(page:Page) {
  const encoded=await page.evaluate(()=>Object.fromEntries([['original_display',720],['thumbnail',240]].map(([variant,width])=>{const c=document.createElement('canvas');c.width=Number(width);c.height=Number(width)*2/3;c.getContext('2d')!.fillRect(0,0,c.width,c.height);return [variant,c.toDataURL('image/webp',.8).split(',')[1]];})));
  const token=(await owner.auth.getSession()).data.session!.access_token;
  const post=async(path:string)=>{const r=await fetch(`http://localhost:8787${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(path==='/api/uploads'?{animal_id:original.id,editing:true}:{})});expect(r.ok).toBe(true);return r.json();};
  const reservation=await post('/api/uploads');
  for(const object of reservation.objects)expect((await owner.storage.from('animal-media').uploadToSignedUrl(object.path,object.token,new Blob([Buffer.from(encoded[object.variant],'base64')],{type:'image/webp'}),{contentType:'image/webp',upsert:false})).error).toBeNull();
  await post(`/api/uploads/${reservation.asset_id}/complete`);
  const before=await current(),assets=[reservation.asset_id,...before.photos.slice(1).map(p=>p.asset_id)];
  expect((await owner.schema('api').rpc('save_animal_edit',{p_animal_id:original.id,p_data:fields(before),p_assets:assets,p_expected:(await dash()).profile!.revision,p_request_id:crypto.randomUUID()})).error).toBeNull();return assets;
}
test.describe('photo editing with real local QA Storage',()=>{
  test.beforeAll(async()=>{owner=createClient(status.url,status.publishable,{auth:{persistSession:false,autoRefreshToken:false}});expect((await owner.auth.signInWithPassword({email:'qa-owner@reptilelink.test',password:h.fixturePassword})).error).toBeNull();const d=await dash();original=d.animals[0];actor=d.profile!.id;slug=d.profile!.slug;profilePublic=d.profile!.is_published;expect(original.photos).toHaveLength(0);await mkdir('artifacts/photo-10',{recursive:true});});
  test.beforeEach(async({page})=>{await reset();let d=await dash();if(!d.profile!.is_published)expect((await owner.schema('api').rpc('set_profile_public',{p_public:true,p_expected:d.profile!.revision})).error).toBeNull();d=await dash();if(!(await current()).is_public)expect((await owner.schema('api').rpc('set_animal_public',{p_animal_id:original.id,p_public:true,p_expected:d.profile!.revision})).error).toBeNull();beforeAssets=assetIds();await signIn(page);});
  test.afterEach(async()=>{
    await reset();const admin=h.localAdmin();
    // Only assets created by this execution on the dedicated QA animal. No user/old fixture cleanup.
    for(const id of [...assetIds()].filter(id=>!beforeAssets.has(id))){h.localQuery(`update private.media_assets set cleanup_after=now()-interval '1 second' where id='${id}' and profile_id='${actor}'`);const m=await admin.schema('api').rpc('cleanup_manifest',{p_asset_id:id,p_actor:actor});expect(m.error).toBeNull();if(m.data?.length)expect((await admin.storage.from('animal-media').remove(m.data)).error).toBeNull();expect((await admin.schema('api').rpc('finish_cleanup',{p_asset_id:id})).error).toBeNull();}
  });
  test.afterAll(async()=>{if(!original)return;let d=await dash();expect((await owner.schema('api').rpc('set_animal_public',{p_animal_id:original.id,p_public:original.is_public,p_expected:d.profile!.revision})).error).toBeNull();d=await dash();expect((await owner.schema('api').rpc('set_profile_public',{p_public:profilePublic,p_expected:d.profile!.revision})).error).toBeNull();});

  test('three local photo drafts, cancellation and seven source widths never write before save',async({page})=>{
    let reservations=0;page.on('request',r=>{if(r.url().endsWith('/api/uploads')&&r.method()==='POST')reservations++;});const d=await open(page),before=await dash();
    await choose(page,d);await choose(page,d,'사진 추가','#63ad26');await choose(page,d,'사진 추가','#c95722');await expect(d.getByRole('button',{name:'사진 추가',exact:true})).toHaveCount(0);
    await d.getByRole('button',{name:'대표로 지정',exact:true}).click();
    for(const width of [320,360,390,450,768,1440,1920]){await page.setViewportSize({width,height:1000});await d.locator('.animal-edit-body').evaluate(el=>{el.scrollTop=0;});const b=(await d.boundingBox())!;expect(Math.abs(b.x-(width-b.width)/2)).toBeLessThanOrEqual(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`artifacts/photo-10/draft-${width}.png`});if([320,390,1440].includes(width)){await d.getByRole('button',{name:'저장',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/photo-10/bottom-${width}.png`});}}
    expect(reservations).toBe(0);expect((await dash()).profile!.revision).toBe(before.profile!.revision);expect((await current()).photos).toHaveLength(0);await d.getByRole('button',{name:'취소',exact:true}).click();await expect(d).not.toBeVisible();await page.reload();expect((await current()).photos).toHaveLength(0);
  });

  test('full replacement, representative order and all-photo deletion update public data atomically and defer physical cleanup',async({page,request})=>{
    let d=await open(page);await choose(page,d);await choose(page,d,'사진 추가','#63ad26');await choose(page,d,'사진 추가','#c95722');await d.getByRole('textbox',{name:'개체 이름',exact:true}).fill('사진과 이름 동시 저장');const rev=(await dash()).profile!.revision;
    await d.getByRole('button',{name:'저장',exact:true}).dblclick();await expect(d).not.toBeVisible({timeout:45000});expect((await dash()).profile!.revision).toBe(rev+1);const first=await current();expect(first.photos).toHaveLength(3);expect(first.name).toBe('사진과 이름 동시 저장');
    expect((await owner.schema('api').rpc('set_profile_public',{p_public:false,p_expected:(await dash()).profile!.revision})).error).toBeNull();
    expect((await request.get(`http://localhost:8787/api/media/${first.photos[0].asset_id}/thumbnail`)).status()).toBe(404);
    expect((await owner.schema('api').rpc('set_profile_public',{p_public:true,p_expected:(await dash()).profile!.revision})).error).toBeNull();
    await page.reload();
    d=await open(page);await d.getByRole('button',{name:'1번 사진 (대표)',exact:true}).click();await choose(page,d,'사진 교체','#ab309b');await save(d);const replaced=await current();expect(replaced.photos).toHaveLength(3);expect(replaced.photos[0].asset_id).not.toBe(first.photos[0].asset_id);
    expect((await request.get(`http://localhost:8787/api/media/${first.photos[0].asset_id}/thumbnail`)).status()).toBe(404);
    expect(h.localQuery(`select state from private.media_assets where id='${first.photos[0].asset_id}'`).trim()).toBe('delete_pending');
    expect(Number(h.localQuery(`select count(*) from storage.objects where bucket_id='animal-media' and name like '${actor}/${first.photos[0].asset_id}/%'`).trim())).toBe(2);
    const admin=h.localAdmin(),oldId=first.photos[0].asset_id,usageBefore=(await dash()).usage!.stored_bytes;
    expect((await admin.schema('api').rpc('cleanup_manifest',{p_asset_id:oldId,p_actor:actor})).data).toBeNull();
    expect((await admin.schema('api').rpc('finish_cleanup',{p_asset_id:oldId})).error?.message).toContain('CLEANUP_PENDING');
    const oldBytes=Number(h.localQuery(`select actual_bytes from private.media_assets where id='${oldId}'`).trim());
    // Advance only this disposable fixture's cleanup lease; production never bypasses it.
    h.localQuery(`update private.media_assets set cleanup_after=now()-interval '1 second' where id='${oldId}' and profile_id='${actor}'`);
    const paths=(await admin.schema('api').rpc('cleanup_manifest',{p_asset_id:oldId,p_actor:actor})).data as string[];
    expect((await admin.storage.from('animal-media').remove([paths[0]])).error).toBeNull();
    expect((await admin.schema('api').rpc('finish_cleanup',{p_asset_id:oldId})).error?.message).toContain('FILES_REMAIN');
    expect((await dash()).usage!.stored_bytes).toBe(usageBefore);
    expect((await admin.storage.from('animal-media').remove(paths.slice(1))).error).toBeNull();
    expect((await admin.schema('api').rpc('finish_cleanup',{p_asset_id:oldId})).error).toBeNull();
    expect((await dash()).usage!.stored_bytes).toBe(usageBefore-oldBytes);
    expect((await admin.schema('api').rpc('finish_cleanup',{p_asset_id:oldId})).error).toBeNull();
    d=await open(page);await d.getByRole('button',{name:'2번 사진',exact:true}).click();await d.getByRole('button',{name:'대표로 지정',exact:true}).click();await save(d);expect((await current()).photos[0].asset_id).toBe(replaced.photos[1].asset_id);
    const html=await (await request.get(`http://localhost:8787/u/${slug}`)).text();expect(html.match(/property="og:image" content="([^"]*)"/)?.[1]).toContain(replaced.photos[1].asset_id);const data=await owner.schema('api').rpc('public_page',{p_slug:slug});expect(data.data.animals.find((a:Animal)=>a.id===original.id).photos[0].asset_id).toBe(replaced.photos[1].asset_id);
    await page.reload();d=await open(page);for(let i=0;i<3;i++)await d.getByRole('button',{name:'사진 삭제',exact:true}).click();await save(d);expect((await current()).photos).toHaveLength(0);await expect(page.locator(`[data-collection-id="${original.id}"]`).getByText('사진 없음',{exact:true})).toBeVisible();
  });

  for(const mode of ['retry','cancel'] as const)test(`lost save response ${mode} reconciles the same receipt without deleting committed photos`,async({page})=>{
    const d=await open(page);await choose(page,d);const rev=(await dash()).profile!.revision,receipts:string[]=[];let first=true;
    await page.route('**/rest/v1/rpc/save_animal_edit',async route=>{receipts.push(route.request().postDataJSON().p_request_id);if(first){first=false;await route.fetch();await route.abort('failed');}else await route.continue();});
    await d.getByRole('button',{name:'저장',exact:true}).click();await expect(d.getByRole('alert')).toBeVisible();await expect(d.getByRole('textbox',{name:'개체 이름',exact:true})).toBeDisabled();
    if(mode==='retry')await save(d);else{await d.getByRole('button',{name:'취소',exact:true}).click();await expect(d).not.toBeVisible();}
    expect(new Set(receipts).size).toBe(1);expect(receipts.length).toBeGreaterThanOrEqual(2);expect((await dash()).profile!.revision).toBe(rev+1);expect((await current()).photos).toHaveLength(1);expect(h.localQuery(`select state from private.media_assets where id='${(await current()).photos[0].asset_id}'`).trim()).toBe('ready');
  });

  test('failed post-save refresh and failed cancellation retain the unresolved editor until reconciliation succeeds',async({page})=>{
    await page.setViewportSize({width:390,height:1000});const d=await open(page);await choose(page,d);await page.route('**/rest/v1/rpc/my_dashboard',route=>route.abort('failed'));await d.getByRole('button',{name:'저장',exact:true}).click();await expect(d.getByRole('alert')).toBeVisible();await d.getByRole('button',{name:'취소',exact:true}).click();await expect(d).toBeVisible();await expect(d.getByRole('textbox',{name:'개체 이름',exact:true})).toBeDisabled();await page.screenshot({path:'artifacts/photo-10/unresolved-390.png'});await page.unroute('**/rest/v1/rpc/my_dashboard');await d.getByRole('button',{name:'취소',exact:true}).click();await expect(d).not.toBeVisible();expect((await current()).photos).toHaveLength(1);
  });

  test('a version conflict keeps the local file until explicit latest review and reapply',async({page})=>{
    const d=await open(page);await choose(page,d);await choose(page,d,'사진 추가','#63ad26');await choose(page,d,'사진 추가','#c95722');expect((await owner.schema('api').rpc('update_animal',{p_animal_id:original.id,p_data:{...fields(original),name:'다른 화면의 이름'},p_expected:(await dash()).profile!.revision,p_request_id:crypto.randomUUID()})).error).toBeNull();await d.getByRole('button',{name:'저장',exact:true}).click();await expect(d.getByRole('alert')).toContainText('다른 화면');expect((await current()).photos).toHaveLength(0);await d.getByRole('button',{name:'최신 값 확인',exact:true}).click();await expect(d.getByRole('definition').filter({hasText:'다른 화면의 이름'})).toBeVisible();await d.getByRole('button',{name:'내 입력 유지',exact:true}).click();await save(d);expect((await current()).photos).toHaveLength(3);expect((await current()).name).toBe(original.name);
  });

  test('failed verification of a replacement preserves the old public photo and local file for retry',async({page})=>{
    let d=await open(page);await choose(page,d);await save(d);const old=await current();d=await open(page);await choose(page,d,'사진 교체','#c33a21');let first=true;await page.route('**/api/uploads/*/complete',async route=>{if(first){first=false;await route.fetch();await route.abort('failed');}else await route.continue();});await d.getByRole('button',{name:'저장',exact:true}).click();await expect(d.getByRole('alert')).toBeVisible();expect((await current()).photos).toEqual(old.photos);await expect(d.getByRole('textbox',{name:'개체 이름',exact:true})).toBeEnabled();await save(d);expect((await current()).photos[0].asset_id).not.toBe(old.photos[0].asset_id);
  });

  test('SPA Back retains a local photo until explicit discard, without reserving storage',async({page})=>{
    await page.getByRole('link',{name:'기본 정보',exact:true}).click();await page.getByRole('link',{name:'개체 관리',exact:true}).click();const d=await open(page);await choose(page,d);await page.evaluate(()=>history.back());await expect(d.getByRole('alert')).toContainText('저장하지 않은');await d.getByRole('button',{name:'계속 편집',exact:true}).click();await expect(d.getByAltText('선택한 사진 미리보기')).toBeVisible();await page.evaluate(()=>history.back());await d.getByRole('button',{name:'변경 버리고 이동',exact:true}).click();await expect(page).toHaveURL(/\/dashboard\/design$/);expect(assetIds()).toEqual(beforeAssets);
  });
  test('obsolete cached uploads are released before saving replacement drafts after a partial preparation failure',async({page})=>{
    const d=await open(page);await choose(page,d);await choose(page,d,'사진 추가','#63ad26');
    const chooser=page.waitForEvent('filechooser');await d.getByRole('button',{name:'사진 추가',exact:true}).click();await (await chooser).setFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not a decodable image')});
    await d.getByRole('button',{name:'저장',exact:true}).click();await expect(d.getByRole('alert')).toBeVisible();
    const obsolete=[...assetIds()].filter(id=>!beforeAssets.has(id));expect(obsolete).toHaveLength(2);expect((await current()).photos).toHaveLength(0);
    await choose(page,d,'사진 교체','#8251af');
    await d.getByRole('button',{name:'1번 사진 (대표)',exact:true}).click();await choose(page,d,'사진 교체','#3847c9');
    await d.getByRole('button',{name:'2번 사진',exact:true}).click();await choose(page,d,'사진 교체','#df7415');
    const applied=page.waitForResponse(r=>r.url().endsWith('/rpc/save_animal_edit'),{timeout:8000});await d.getByRole('button',{name:'저장',exact:true}).click();expect((await applied).ok()).toBe(true);await expect(d).not.toBeVisible();expect((await current()).photos).toHaveLength(3);
    for(const id of obsolete)expect(h.localQuery(`select state from private.media_assets where id='${id}'`).trim()).toBe('delete_pending');
  });

  test('a service-policy rejection allows cancellation and latest-value review while writes remain disabled',async({page})=>{
    const previous=h.localQuery('select writes_enabled from private.project_budget where id=1').trim();
    try {
      for(const mode of ['cancel','latest']){
        const d=await open(page);await d.getByRole('textbox',{name:'개체 이름',exact:true}).fill('쓰기 중지 중 거절된 변경');
        h.localQuery('update private.project_budget set writes_enabled=false where id=1');
        await d.getByRole('button',{name:'저장',exact:true}).click();await expect(d.getByRole('alert')).toContainText('지금은 저장');
        if(mode==='latest'){
          await d.getByRole('button',{name:'최신 값 검토',exact:true}).click();await d.getByRole('button',{name:'최신 값 확인',exact:true}).click();
          await expect(d.getByRole('group',{name:'최신 사진',exact:true})).toBeVisible();await d.getByRole('button',{name:'최신값으로 바꾸기',exact:true}).click();
        }
        await d.getByRole('button',{name:'취소',exact:true}).click();await expect(d).not.toBeVisible();expect((await current()).name).toBe(original.name);
      }
      await page.getByRole('link',{name:'기본 정보',exact:true}).click();await expect(page).toHaveURL(/\/dashboard\/design$/);
      expect(h.localQuery('select writes_enabled from private.project_budget where id=1').trim()).toBe('f');
    } finally {h.localQuery(`update private.project_budget set writes_enabled=${previous==='t'?'true':'false'} where id=1`);}
  });

  test('retaining local fields rebases untouched photos after another editor replaces the saved photo',async({page})=>{
    let d=await open(page);await choose(page,d);await save(d);d=await open(page);await d.getByRole('textbox',{name:'개체 이름',exact:true}).fill('유지할 일반 필드');
    const latest=await replaceFromOtherEditor(page);await d.getByRole('button',{name:'저장',exact:true}).click();await expect(d.getByRole('alert')).toContainText('다른 화면');await d.getByRole('button',{name:'최신 값 확인',exact:true}).click();await d.getByRole('button',{name:'내 입력 유지',exact:true}).click();
    const response=page.waitForResponse(r=>/\/rpc\/(update_animal|save_animal_edit)$/.test(r.url()));await d.getByRole('button',{name:'저장',exact:true}).click();expect((await response).ok()).toBe(true);await expect(d).not.toBeVisible();expect((await current()).name).toBe('유지할 일반 필드');expect((await current()).photos.map(p=>p.asset_id)).toEqual(latest);
  });
  test('a changed photo draft with an unavailable saved asset requires an explicit latest-photo choice',async({page})=>{
    let d=await open(page);await choose(page,d);await choose(page,d,'사진 추가','#63ad26');await save(d);d=await open(page);await d.getByRole('button',{name:'2번 사진',exact:true}).click();await d.getByRole('button',{name:'사진 삭제',exact:true}).click();await d.getByRole('textbox',{name:'개체 이름',exact:true}).fill('입력만 유지');
    const latest=await replaceFromOtherEditor(page);await d.getByRole('button',{name:'저장',exact:true}).click();await expect(d.getByRole('alert')).toContainText('다른 화면');await d.getByRole('button',{name:'최신 값 확인',exact:true}).click();await d.getByRole('button',{name:'내 입력 유지',exact:true}).click();
    await expect(d.getByRole('button',{name:'저장',exact:true})).toBeDisabled();for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`artifacts/photo-10/unavailable-${width}.png`});}await d.getByRole('button',{name:'입력 유지·최신 사진 사용',exact:true}).click();await save(d);expect((await current()).name).toBe('입력만 유지');expect((await current()).photos.map(p=>p.asset_id)).toEqual(latest);
  });

});
