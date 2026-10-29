import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

async function login(page: Page) {
  await page.goto('/auth/login');
  await page.getByRole('button', { name: '테스트 브리더로 로그인', exact: true }).click();
  await expect(page.getByRole('region', { name: '개체 목록 관리' })).toBeVisible();
}

test('management source layout, keyboard menus and footer work at seven widths', async ({ page, request }) => {
  const logo = await request.get('http://localhost:8787/brand/reptilelink-source.png');
  expect(logo.headers()['content-type']).toContain('image/png');
  expect(createHash('sha256').update(await logo.body()).digest('hex')).toBe('648cd5f09273a03ad28229b8f4bbb4fe0fc155080d31cb0ec9fa3ad3b102aba6');
  await login(page);
  await mkdir('artifacts/shell-8', { recursive: true });
  const tabs = page.getByRole('navigation', { name: '마이페이지 메뉴' });
  expect(await tabs.locator(':scope > *').evaluateAll(els=>els.map(el=>{const clone=el.cloneNode(true) as HTMLElement;clone.querySelectorAll('.sr-only').forEach(n=>n.remove());return clone.textContent;}))).toEqual(['개체 관리', '링크 관리', '일정 관리', '디자인 수정', '기본 정보', '통계/알림']);
  for (const width of [320, 360, 390, 450, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('.management-content').boundingBox())!.width).toBeLessThanOrEqual(378);
    await expect(page.locator('.management-header .management-brand img')).toHaveJSProperty('naturalWidth', 120);
    await expect(page.locator('.management-shell .sidebar, .management-shell .sidebar-note, .management-shell .brand-mark')).toHaveCount(0);
    await page.screenshot({ path: `artifacts/shell-8/top-${width}.png` });
    const footer = page.getByRole('contentinfo');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole('link', { name: '개인정보처리방침', exact: true })).toHaveAttribute('href', '/privacy');
    await expect(footer).not.toContainText('010-4287');
    await page.screenshot({ path: `artifacts/shell-8/footer-${width}.png` });
  }
  await page.setViewportSize({ width: 320, height: 900 });
  const animals = tabs.getByRole('link', { name: '개체 관리', exact: true });
  await animals.focus();
  await page.keyboard.press('Tab');
  await expect(tabs.getByRole('link', { name: '링크 관리', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tabs.getByRole('link', { name: '일정 관리', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tabs.getByRole('link', { name: '디자인 수정', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tabs.getByRole('link', { name: '기본 정보', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\/account$/);
  await expect(tabs.getByRole('link', { name: '기본 정보', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: '브리더 이름', exact: true })).toBeVisible();
  await expect(page.getByText(/사진 저장 공간/)).toBeVisible();
  await page.screenshot({ path: 'artifacts/shell-8/basic-320.png' });
  await tabs.getByRole('link', { name: '개체 관리', exact: true }).click();
  await expect(animals).toHaveAttribute('aria-current', 'page');
  for (const button of await tabs.getByRole('button').all()) await expect(button).toBeDisabled();
});

test('sharing uses the actual address, private sharing explains publication, and unsaved collection locks remain', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  const publish = page.getByRole('button', { name: '페이지 공개하기', exact: true });
  const hide = page.getByRole('button', { name: '비공개로 전환', exact: true });
  const originallyPublic = await hide.isVisible();
  try {
    if (originallyPublic) await hide.click();
    await expect(publish).toBeVisible();
    await page.getByRole('button', { name: '공개 주소 복사', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('페이지를 공개한 뒤');
    await publish.click();
    await expect(hide).toBeVisible();
    await page.getByRole('button', { name: '공개 주소 복사', exact: true }).click();
    await expect(page.getByText('공개 주소를 복사했어요.', { exact: true })).toBeAttached();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    const open = page.getByRole('link', { name: '공개 페이지 열기', exact: true });
    expect(url).toBe(new URL((await open.getAttribute('href'))!, page.url()).href);
    const popup = page.waitForEvent('popup');
    await open.click();
    const publicPage = await popup;
    await publicPage.waitForURL(url);
    await publicPage.close();
    const list = page.getByRole('region', { name: '개체 목록 관리' });
    await list.getByRole('switch').first().click();
    await expect(hide).toBeDisabled();
    await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeDisabled();
    await page.getByRole('navigation', { name: '마이페이지 메뉴' }).getByRole('link', { name: '기본 정보', exact: true }).click();
    await expect(list.getByRole('alert')).toContainText('적용하지 않은');
    await page.getByRole('button', { name: '계속 수정', exact: true }).click();
    await list.getByRole('button', { name: '변경 취소', exact: true }).click();
    await expect(hide).toBeEnabled();
  } finally {
    // Restore only this test's profile-public change; no collection apply is sent.
    if (originallyPublic && await publish.isVisible()) await publish.click();
    if (!originallyPublic && await hide.isVisible()) await hide.click();
  }
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
});

test('empty list and maximum-length address fit the narrow source column', async ({ page }) => {
  // Response-only display fixture: never save a synthetic slug or delete existing animals.
  await page.route('**/rest/v1/rpc/my_dashboard', async route => {
    const response = await route.fetch();
    const data = await response.json();
    if (data.profile) { data.profile.slug = 'a'.repeat(30); data.animals = []; }
    await route.fulfill({ response, json: data });
  });
  await login(page);
  await page.setViewportSize({ width: 320, height: 1000 });
  await expect(page.getByRole('region', { name: '개체 목록 관리' }).getByText('등록된 개체가 없습니다.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const address = page.locator('.management-share > span[title]');
  expect(await address.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/shell-8/empty-long-320.png', fullPage: true });
});
