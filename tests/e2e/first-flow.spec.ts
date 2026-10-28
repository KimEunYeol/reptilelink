import { test, expect } from '@playwright/test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdir } from 'node:fs/promises';
import { Gecko } from '../../src/components/Gecko';

const helpersPath = '../../scripts/local-utils.mjs';
const helpers = await import(helpersPath) as {
  localQuery(sql: string): string;
  localAdmin(): import('@supabase/supabase-js').SupabaseClient;
};
let createdFixture: string | null = null;
test.afterEach(async () => {
  if (!createdFixture) return;
  const id = createdFixture; createdFixture = null;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  const actor = helpers.localQuery("select id from auth.users where email='breeder-a@reptilelink.test'").trim();
  expect(actor).toMatch(/^[0-9a-f-]{36}$/);
  // Only the ID returned by this execution's create RPC may be removed; retain all old fixture/user rows.
  const assets: string[] = JSON.parse(helpers.localQuery(`select coalesce(jsonb_agg(id),'[]') from private.media_assets where animal_id='${id}' and profile_id='${actor}'`).trim());
  helpers.localQuery(`delete from public.animal_photos where animal_id='${id}' and profile_id='${actor}'`);
  const admin = helpers.localAdmin();
  for (const asset of assets) {
    const manifest = await admin.schema('api').rpc('cleanup_manifest', { p_asset_id:asset,p_actor:actor });
    expect(manifest.error).toBeNull();
    if (manifest.data?.length) expect((await admin.storage.from('animal-media').remove(manifest.data)).error).toBeNull();
    expect((await admin.schema('api').rpc('finish_cleanup',{p_asset_id:asset})).error).toBeNull();
  }
  helpers.localQuery(`delete from public.animals where id='${id}' and profile_id='${actor}'`);
});

test('real local first flow: login, profile, photo, publication and private access', async ({ page, browser, request }) => {
  await expect.poll(async () => (await request.get('http://localhost:8787/api/health')).status(), { timeout: 30000 }).toBe(200);
  await page.goto('/auth/login');
  await page.getByRole('button', { name: '테스트 브리더로 로그인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '개체 관리', exact: true }).or(page.getByRole('heading', { name: '우리 아이들의 이야기가 시작될 공간을 만들어봐요.' }))).toBeVisible();
  if (await page.getByRole('button', { name: '내 공간 만들기', exact: true }).isVisible()) {
    await page.getByRole('textbox', { name: '브리더 이름', exact: true }).fill('초록빛 브리딩룸');
    await page.getByRole('textbox', { name: '내 페이지 주소', exact: true }).fill('green-room');
    await page.getByRole('textbox', { name: '소개', exact: true }).fill('작은 발걸음, 천천히 자라는 우리 아이들.\n크레스티드 게코와 함께하는 일상을 기록합니다. 🌱');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '내 공간 만들기', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: '개체 관리', exact: true })).toBeVisible();
  // Build an original image fixture from our own vector illustration, then exercise the real file input.
  const svg = renderToStaticMarkup(createElement(Gecko));
  const png = await page.evaluate(async (source) => {
    const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 480;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#e9f1df'; ctx.fillRect(0,0,720,480); ctx.drawImage(image,0,0,720,480);
    return canvas.toDataURL('image/png').split(',')[1];
  }, svg);
  await page.getByRole('button', { name: '개체 등록', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '개체 이름', exact: true }).fill('도리');
  await dialog.getByRole('textbox', { name: '모프', exact: true }).fill('릴리화이트');
  await dialog.getByRole('combobox', { name: '성별', exact: true }).selectOption('male');
  await dialog.getByRole('textbox', { name: '개체 소개', exact: true }).fill('호기심이 많고 손 위에서 쉬는 걸 좋아하는 아이예요.');
  await dialog.getByLabel('개체 사진', { exact: true }).setInputFiles({ name: 'dori.png', mimeType: 'image/png', buffer: Buffer.from(png,'base64') });
  const created = page.waitForResponse(response => response.url().endsWith('/rpc/create_animal') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '개체 등록하기', exact: true }).click();
  createdFixture = (await (await created).json()).id;
  await expect(dialog).not.toBeVisible({ timeout: 45000 });
  async function revealCreated() {
    const registered = page.locator(`[data-collection-id="${createdFixture}"]`);
    if (await registered.count() === 0) await page.getByRole('button', { name:'다음 페이지',exact:true }).click();
    await expect(registered).toBeVisible();
    await expect(registered.locator('.animal-photo')).toBeVisible();
  }
  await revealCreated();
  await expect(page.getByRole('button', { name: '도리 상세 보기' }).last()).toBeVisible();
  await page.reload();
  await revealCreated();
  await expect(page.getByRole('button', { name: '도리 상세 보기' }).last()).toBeVisible();
  await expect(page.locator('.animal-photo').last()).toBeVisible();
  // Compare the scoped editor with an actual uploaded photo as well as the QA no-photo case.
  await mkdir('artifacts/design-review-3', { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '도리 상세 보기' }).last().click();
    const edit = page.getByRole('dialog', { name: '개체 수정' });
    const photo = edit.locator('.edit-photo img');
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: `artifacts/design-review-3/photo-${width}.png` });
    await edit.getByRole('button', { name: '저장', exact: true }).scrollIntoViewIfNeeded();
    await expect(edit.getByRole('button', { name: '저장', exact: true })).toBeInViewport();
    await page.screenshot({ path: `artifacts/design-review-3/photo-bottom-${width}.png` });
    await edit.getByRole('button', { name: '취소', exact: true }).click();
  }
  if (await page.getByRole('button', { name: '페이지 공개하기', exact: true }).isVisible()) await page.getByRole('button', { name: '페이지 공개하기', exact: true }).click();
  await expect(page.getByText('공개 중', { exact: true })).toBeVisible();
  await mkdir('artifacts', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: 'artifacts/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/dashboard-mobile.png', fullPage: true });
  const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitor = await anonymous.newPage();
  const response = await visitor.goto('http://localhost:8787/u/green-room');
  expect(response?.status()).toBe(200);
  await expect(visitor.getByRole('heading', { name: '초록빛 브리딩룸', exact: true })).toBeVisible();
  await expect(visitor.getByRole('button', { name: '도리 상세 보기' }).last()).toBeVisible();
  await expect(visitor.locator('.animal-photo').last()).toBeVisible();
  const raw = await request.get('http://localhost:8787/u/green-room');
  const publicHtml = await raw.text();
  expect(publicHtml).toContain('property="og:title"');
  const bootstrapped = JSON.parse(publicHtml.match(/id="public-bootstrap">(.*?)<\/script>/s)![1]);
  const publicAsset = bootstrapped.animals.at(-1).photos[0].asset_id;
  await visitor.screenshot({ path: 'artifacts/public-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '비공개로 전환', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '페이지 공개하기', exact: true })).toBeVisible();
  expect((await request.get('http://localhost:8787/u/green-room')).status()).toBe(404);
  expect((await request.get(`http://localhost:8787/api/media/${publicAsset}/thumbnail`)).status()).toBe(404);
  await page.getByRole('button', { name: '페이지 공개하기', exact: true }).click();
  await expect(page.getByText('공개 중', { exact: true })).toBeVisible();
  await anonymous.close();
});

test('local test login is excluded from the production build', async ({ page }) => {
  const response = await page.goto('http://localhost:8787/auth/login');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: '반가워요, 함께 기록해볼까요?' })).toBeVisible();
  await expect(page.getByRole('button', { name: '테스트 브리더로 로그인', exact: true })).toHaveCount(0);
});
