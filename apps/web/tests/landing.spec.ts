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
    page.getByRole('heading', { level: 1, name: 'Introductions that start with a friend’s voice' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How an introduction starts' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'The person being introduced decides' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The iOS app is on its way' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'See a demo pitch' })).toHaveAttribute(
    'href',
    '/p/demo-blair',
  );
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('fw_attribution')))
    .toBe('launch-partner');

  for (const linkName of ['Friendword home', 'See the demo', 'Try the demo first']) {
    const height = await page
      .getByRole('link', { name: linkName })
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole('link', { name: 'See a demo pitch' }).click();
  await page.waitForURL('**/p/demo-blair');
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('fw_attribution')))
    .toBe('launch-partner');
});

// Second audit §8-16: English is the launch locale. The html lang attribute
// and every public acquisition surface must carry no Korean product copy.
test('ships English as the default public locale with no Korean copy', async ({ page }) => {
  for (const path of ['/', '/p/demo-blair']) {
    await page.goto(path);
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang, `${path} html lang`).toBe('en');
    const koreanText = await page.evaluate(() => {
      const matches = (document.body.innerText ?? '').match(/[가-힣]+/g);
      return matches === null ? '' : matches.join(' ');
    });
    expect(koreanText, `${path} contains Korean copy`).toBe('');
  }
});

// Second audit CP-3: the demo has no recording, so it must not pretend to
// play one — no Play control, no fake timer, and an honest note instead.
test('keeps the Blair demo honest about having no voice recording', async ({ page }) => {
  await page.goto('/p/demo-blair');

  await expect(page.getByRole('button', { name: /Play .*pitch/ })).toHaveCount(0);
  await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.locator('[class*="timeRow"]')).toHaveCount(0);
  await expect(page.getByText('No voice recording in this preview')).toBeVisible();
  await expect(page.getByTestId('written-pitch')).toContainText(
    'Blair is the person who turns an ordinary Tuesday',
  );
});

test('removes action transitions when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'See a demo pitch' })).toHaveCSS(
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
