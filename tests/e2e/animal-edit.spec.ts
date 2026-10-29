import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir } from 'node:fs/promises';
import type { Animal, AnimalEditInput, Dashboard } from '../../src/lib/domain';

const helpersPath = '../../scripts/local-utils.mjs';
const helpers = await import(helpersPath) as { localStatus(): { url: string; publishable: string }; localQuery(sql: string): string; fixturePassword: string };
const status = helpers.localStatus();
const storageKey = `sb-${new URL(status.url).hostname.split('.')[0]}-auth-token`;
let owner: SupabaseClient, original: Animal, slug: string, originalPublic: boolean;
const fields = (a: Animal): AnimalEditInput => ({ name: a.name, species: a.species, morph: a.morph, sex: a.sex,
  birth_date: a.birth_date, description: a.description, listing_status: a.listing_status });
async function dashboard(): Promise<Dashboard> { const r = await owner.schema('api').rpc('my_dashboard'); expect(r.error).toBeNull(); return r.data; }
async function edit(data: AnimalEditInput) {
  const d = await dashboard();
  const r = await owner.schema('api').rpc('update_animal', { p_animal_id: original.id, p_data: data, p_expected: d.profile!.revision, p_request_id: crypto.randomUUID() });
  expect(r.error).toBeNull();
}
async function signIn(page: Page) {
  const auth = await owner.auth.signInWithPassword({ email: 'qa-owner@reptilelink.test', password: helpers.fixturePassword });
  expect(auth.error).toBeNull();
  await page.goto('/auth/login');
  await page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: storageKey, session: auth.data.session });
  await page.goto('/dashboard/animals');
  await expect(page.getByRole('button', { name: `${original.name} 상세 보기`, exact: true })).toBeVisible();
}
async function open(page: Page) {
  await page.getByRole('button', { name: `${original.name} 상세 보기`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '개체 수정' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('animal general field edit with real local QA identity', () => {
  test.beforeAll(async () => {
    owner = createClient(status.url, status.publishable, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = await owner.auth.signInWithPassword({ email: 'qa-owner@reptilelink.test', password: helpers.fixturePassword });
    expect(auth.error).toBeNull();
    const d = await dashboard();
    expect(d.animals.length, 'Run npm run test:db to prepare dedicated QA data').toBeGreaterThan(0);
    original = d.animals[0]; slug = d.profile!.slug; originalPublic = d.profile!.is_published;
  });
  test.beforeEach(async ({ page }) => {
    await edit(fields(original));
    let d = await dashboard();
    if (!d.profile!.is_published) {
      expect((await owner.schema('api').rpc('set_profile_public', { p_public: true, p_expected: d.profile!.revision })).error).toBeNull();
      d = await dashboard();
    }
    if (!d.animals.find(a => a.id === original.id)!.is_public) {
      expect((await owner.schema('api').rpc('set_animal_public', { p_animal_id: original.id, p_public: true, p_expected: d.profile!.revision })).error).toBeNull();
    }
    await signIn(page);
  });
  test.afterAll(async () => {
    if (!original) return;
    await edit(fields(original));
    let d = await dashboard();
    await owner.schema('api').rpc('set_animal_public', { p_animal_id: original.id, p_public: original.is_public, p_expected: d.profile!.revision });
    d = await dashboard();
    await owner.schema('api').rpc('set_profile_public', { p_public: originalPublic, p_expected: d.profile!.revision });
  });

  test('keeps the source dialog centered, usable and cancellable at every specified width', async ({ page }) => {
    await mkdir('artifacts/design-review-3', { recursive: true });
    for (const width of [320, 360, 390, 450, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const d = await open(page);
      const bounds = (await d.boundingBox())!;
      expect(Math.abs(bounds.x - (width - bounds.width) / 2)).toBeLessThanOrEqual(1);
      expect(bounds.y).toBeGreaterThan(0);
      expect(bounds.width).toBeLessThanOrEqual(width - 32);
      for (const radio of await d.getByRole('radio').all()) {
        const box = (await radio.boundingBox())!;
        expect(box.width).toBeLessThanOrEqual(28);
        expect(box.height).toBeLessThanOrEqual(28);
      }
      expect(await d.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: `artifacts/design-review-3/edit-${width}.png` });
      await expect(d.getByRole('textbox', { name: '개체 이름', exact: true })).toHaveValue(original.name);
      await d.getByRole('textbox', { name: '개체 이름', exact: true }).fill('저장하지 않은 입력');
      // The body scrolls independently so lower fields and actions remain reachable.
      await d.getByRole('textbox', { name: '개체 설명', exact: true }).fill('스크롤 조작 확인');
      await d.getByRole('button', { name: '저장', exact: true }).scrollIntoViewIfNeeded();
      await expect(d.getByRole('button', { name: '저장', exact: true })).toBeInViewport();
      await page.screenshot({ path: `artifacts/design-review-3/edit-bottom-${width}.png` });
      await d.getByRole('button', { name: '편집 닫기', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(d.getByRole('button', { name: '사진 추가', exact: true })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(d.getByRole('button', { name: '편집 닫기', exact: true })).toBeFocused();
      const before = (await dashboard()).profile!.revision;
      await d.getByRole('button', { name: '취소', exact: true }).click();
      await expect(d).not.toBeVisible();
      const after = await dashboard();
      expect(after.profile!.revision).toBe(before);
      expect(after.animals.find(a => a.id === original.id)!.name).toBe(original.name);
      await expect(page.getByRole('button', { name: `${original.name} 상세 보기`, exact: true })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });

  test('saves all fields once, survives reload/relogin and updates anonymous Worker HTML', async ({ page, request }) => {
    const d = await open(page);
    const name = `편집 확인 ${Date.now()}`;
    await d.getByRole('textbox', { name: '개체 이름', exact: true }).fill(name);
    await d.getByRole('combobox', { name: '종류', exact: true }).fill('레오파드 게코');
    await d.getByRole('textbox', { name: '모프', exact: true }).fill('수정 모프');
    await d.getByRole('radio', { name: '암컷', exact: true }).check();
    await d.getByLabel('생일', { exact: true }).fill('2024-02-29');
    await d.getByRole('combobox', { name: '분양 상태', exact: true }).selectOption('available');
    await d.getByRole('textbox', { name: '개체 설명', exact: true }).fill('수정 후 저장 확인');
    let saves = 0;
    page.on('request', req => { if (req.url().includes('/rpc/update_animal')) saves++; });
    await d.getByRole('button', { name: '저장', exact: true }).dblclick();
    await expect(d).not.toBeVisible();
    expect(saves).toBe(1);
    await expect(page.getByRole('status')).toContainText('개체 정보를 저장했어요.');
    await page.reload();
    await expect(page.getByRole('button', { name: `${name} 상세 보기`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    // Authenticate again using the QA fixture; never use the developer's breeder account.
    const auth = await owner.auth.signInWithPassword({ email: 'qa-owner@reptilelink.test', password: helpers.fixturePassword });
    expect(auth.error).toBeNull();
    await page.goto('/auth/login');
    await page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: storageKey, session: auth.data.session });
    await page.goto('/dashboard/animals');
    await expect(page.getByRole('button', { name: `${name} 상세 보기`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `${name} 상세 보기`, exact: true }).click();
    await expect(d.getByLabel('생일', { exact: true })).toHaveValue('2024-02-29');
    await expect(d.getByRole('radio', { name: '암컷', exact: true })).toBeChecked();
    await expect(d.getByRole('combobox', { name: '분양 상태', exact: true })).toHaveValue('available');
    const response = await request.get(`http://localhost:8787/u/${slug}/animals/${original.id}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const html = await response.text();
    expect(html).toContain(name);
    const bootstrap = JSON.parse(html.match(/id="public-bootstrap">(.*?)<\/script>/s)![1]);
    expect(bootstrap.animals.find((a: Animal) => a.id === original.id).birth_date).toBe('2024-02-29');
    expect(html).not.toMatch(/qa-owner@|object_path|private\.animal_notes/);
    await mkdir('artifacts', { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await d.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `artifacts/animal-edit-${width}.png`, fullPage: true });
    }
    await d.getByRole('button', { name: '취소', exact: true }).click();
  });

  test('a lost response preserves input and retries the same request without a second revision bump', async ({ page }) => {
    const before = (await dashboard()).profile!.revision;
    const d = await open(page);
    const name = '응답 유실 후 재시도';
    await d.getByRole('textbox', { name: '개체 이름', exact: true }).fill(name);
    const ids: string[] = [];
    await page.route('**/rest/v1/rpc/update_animal', async route => {
      ids.push(route.request().postDataJSON().p_request_id);
      await route.fetch(); // The server commits; simulate a connection loss before the response arrives.
      await route.abort('failed');
    });
    await d.getByRole('button', { name: '저장', exact: true }).click();
    await expect(d.getByRole('alert')).toContainText('연결');
    await expect(d.getByRole('textbox', { name: '개체 이름', exact: true })).toHaveValue(name);
    await page.unroute('**/rest/v1/rpc/update_animal');
    page.on('request', req => { if (req.url().includes('/rpc/update_animal')) ids.push(req.postDataJSON().p_request_id); });
    await d.getByRole('button', { name: '저장', exact: true }).click();
    await expect(d).not.toBeVisible();
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
    expect((await dashboard()).profile!.revision).toBe(before + 1);
  });

  test('a version conflict preserves input until the latest values are explicitly reviewed', async ({ page }) => {
    const d = await open(page);
    await d.getByRole('textbox', { name: '개체 이름', exact: true }).fill('보존할 내 입력');
    await edit({ ...fields(original), description: '다른 화면에서 수정한 설명' });
    await d.getByRole('button', { name: '저장', exact: true }).click();
    await expect(d.getByRole('alert')).toContainText('다른 화면');
    await expect(d.getByRole('textbox', { name: '개체 이름', exact: true })).toHaveValue('보존할 내 입력');
    await expect(d.getByRole('button', { name: '저장', exact: true })).toBeDisabled();
    await d.getByRole('button', { name: '최신 값 확인', exact: true }).click();
    await expect(d.getByRole('definition').filter({ hasText: '다른 화면에서 수정한 설명' })).toBeVisible();
    await d.getByRole('button', { name: '내 입력 유지', exact: true }).click();
    await expect(d.getByRole('textbox', { name: '개체 이름', exact: true })).toHaveValue('보존할 내 입력');
    await d.getByRole('button', { name: '저장', exact: true }).click();
    await expect(d).not.toBeVisible();
    expect((await dashboard()).animals.find(a => a.id === original.id)!.name).toBe('보존할 내 입력');
  });

  test('invalid inputs remain editable and never call the mutation API', async ({ page }) => {
    const d = await open(page);
    let saves = 0;
    page.on('request', req => { if (req.url().includes('/rpc/update_animal')) saves++; });
    await d.getByRole('textbox', { name: '개체 이름', exact: true }).fill('   ');
    await d.getByRole('button', { name: '저장', exact: true }).click();
    await expect(d.getByRole('textbox', { name: '개체 이름', exact: true })).toHaveAttribute('aria-invalid', 'true');
    await d.getByRole('textbox', { name: '개체 이름', exact: true }).fill(original.name);
    await d.getByLabel('생일', { exact: true }).fill('2999-01-01');
    await d.getByRole('button', { name: '저장', exact: true }).click();
    await expect(d.getByLabel('생일', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(saves).toBe(0);
    await d.getByRole('button', { name: '취소', exact: true }).click();
  });

  test('SPA Back preserves unsaved input until the user explicitly chooses to leave', async ({ page }) => {
    await page.getByRole('link', { name: '기본 정보', exact: true }).click();
    await page.getByRole('link', { name: /개체 관리/ }).click();
    const d = await open(page);
    await d.getByRole('textbox', { name: '개체 이름', exact: true }).fill('뒤로가기 보존');
    const before = (await dashboard()).profile!.revision;
    await page.evaluate(() => history.back());
    await expect(d.getByRole('alert')).toContainText('저장하지 않은');
    await expect(page).toHaveURL(/\/dashboard\/animals$/);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `artifacts/design-review-3/navigation-${width}.png` });
    }
    await d.getByRole('button', { name: '계속 편집', exact: true }).click();
    await expect(d.getByRole('textbox', { name: '개체 이름', exact: true })).toHaveValue('뒤로가기 보존');
    await expect(d.getByRole('textbox', { name: '개체 이름', exact: true })).toBeFocused();
    await page.evaluate(() => history.back());
    await d.getByRole('button', { name: '변경 버리고 이동', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/account$/);
    await expect(d).not.toBeVisible();
    expect((await dashboard()).profile!.revision).toBe(before);
  });

  test('SPA Forward and in-app links preserve the draft; clean and cancelled editors do not block', async ({ page }) => {
    await page.getByRole('link', { name: '기본 정보', exact: true }).click();
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/dashboard\/animals$/);
    let d = await open(page);
    await d.getByRole('textbox', { name: '개체 설명', exact: true }).fill('앞으로가기 보존');
    await page.evaluate(() => history.forward());
    await expect(d.getByRole('alert')).toContainText('저장하지 않은');
    await d.getByRole('button', { name: '계속 편집', exact: true }).click();
    // Dispatch a real Link handler while the modal makes underlying user clicks inert.
    await page.locator('a[href="/dashboard/account"]').evaluate(el => (el as HTMLAnchorElement).click());
    await expect(d.getByRole('alert')).toContainText('저장하지 않은');
    await d.getByRole('button', { name: '계속 편집', exact: true }).click();
    await expect(d.getByRole('textbox', { name: '개체 설명', exact: true })).toHaveValue('앞으로가기 보존');
    await d.getByRole('button', { name: '취소', exact: true }).click();
    await page.evaluate(() => history.forward());
    await expect(page).toHaveURL(/\/dashboard\/account$/);
    await page.getByRole('link', { name: /개체 관리/ }).click();
    d = await open(page); // Unchanged editor: no confirmation on the same SPA transition.
    await page.locator('a[href="/dashboard/account"]').evaluate(el => (el as HTMLAnchorElement).click());
    await expect(page).toHaveURL(/\/dashboard\/account$/);
    await expect(d.getByRole('alert')).toHaveCount(0);
    await expect(d).not.toBeVisible();
  });

  test('reload warns about dirty input, and navigation cannot discard an in-flight save', async ({ page }) => {
    await page.getByRole('link', { name: '기본 정보', exact: true }).click();
    await page.getByRole('link', { name: /개체 관리/ }).click();
    const d = await open(page);
    await d.getByRole('textbox', { name: '개체 이름', exact: true }).fill('이동 보호 저장');
    let unloadWarning = false;
    page.once('dialog', async warning => { unloadWarning = warning.type() === 'beforeunload'; await warning.dismiss(); });
    await page.reload({ timeout: 5000 }).catch(() => {});
    expect(unloadWarning).toBe(true);
    await expect(d.getByRole('textbox', { name: '개체 이름', exact: true })).toHaveValue('이동 보호 저장');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/rest/v1/rpc/update_animal', async route => { await gate; await route.continue(); });
    try {
      await d.getByRole('button', { name: '저장', exact: true }).click();
      await expect(d.getByRole('button', { name: '저장 중', exact: true })).toBeDisabled();
      await page.evaluate(() => history.back());
      await expect(d.getByRole('alert')).toContainText('저장 중');
      await expect(d.getByRole('button', { name: '변경 버리고 이동', exact: true })).toBeDisabled();
    } finally { release(); }
    await expect(d).not.toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/animals$/);
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/dashboard\/account$/);
  });
});
