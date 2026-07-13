import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

test('renders the acquisition journey and preserves landing attribution', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?src=launch-partner');

  await expect(
    page.getByRole('heading', { level: 1, name: '친구의 목소리로 시작되는 소개' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '소개는 이렇게 시작돼요' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '당사자가 결정합니다' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'iOS 앱 준비 중' })).toBeVisible();
  await expect(page.getByRole('link', { name: '데모 피치 들어보기' })).toHaveAttribute(
    'href',
    '/p/demo-blair',
  );
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('fw_attribution')))
    .toBe('launch-partner');

  for (const linkName of ['Friendword 홈', '데모 보기', '먼저 데모 체험하기']) {
    const height = await page
      .getByRole('link', { name: linkName })
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole('link', { name: '데모 피치 들어보기' }).click();
  await page.waitForURL('**/p/demo-blair');
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('fw_attribution')))
    .toBe('launch-partner');
});

test('removes action transitions when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await expect(page.getByRole('link', { name: '데모 피치 들어보기' })).toHaveCSS(
    'transition-duration',
    '0s',
  );
});

for (const viewport of viewports) {
  test(`landing fits the ${viewport.name} breakpoint`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    await expect(page.locator('#pitch-a-friend')).toBeVisible();
    await expect(page.locator('#create')).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    await page.screenshot({
      path: `/tmp/friendword-landing-${viewport.width}.png`,
      fullPage: true,
    });
  });
}
