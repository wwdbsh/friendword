import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

async function waitForAnimations(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((element) =>
        element.getAnimations().every((animation) => animation.playState === 'finished'),
      ),
    )
    .toBe(true);
}

test('plays the pitch and opens verified interest when the demo campaign is viewed', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await test.step('Given the public pitch with share attribution', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/p/demo-blair?src=instagram');
    await expect(page.getByRole('heading', { level: 1, name: 'Blair, 29' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.sessionStorage.getItem('fw_attribution')))
      .toBe('instagram');
  });

  await test.step('When the visitor plays the mock timeline', async () => {
    const interestButton = page.getByRole('button', { name: "I'm interested" }).first();
    await interestButton.hover();
    await waitForAnimations(interestButton);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({ path: '/tmp/friendword-pitch-interest-hover.png', fullPage: false });
    await page.getByRole('button', { name: 'Play Maya’s pitch' }).click();
  });

  await test.step('Then progress advances and the verified-interest modal is usable', async () => {
    await expect
      .poll(() => page.locator('[class*="timeRow"] span').first().textContent())
      .not.toBe('0:00');
    await page.screenshot({ path: '/tmp/friendword-pitch-playing.png', fullPage: false });
    const interestButton = page.getByRole('button', { name: "I'm interested" }).first();
    await page.keyboard.press('Tab');
    await expect(interestButton).toBeFocused();
    await page.screenshot({ path: '/tmp/friendword-pitch-interest-focus.png', fullPage: false });
    await interestButton.click();
    const interestDialog = page.getByRole('dialog', {
      name: 'Coming soon — verified interest',
    });
    await expect(interestDialog).toBeVisible();
    await expect(interestDialog).toHaveCSS('opacity', '1');
    await waitForAnimations(interestDialog);
    await page.screenshot({ path: '/tmp/friendword-pitch-modal.png', fullPage: false });
    await expect(page.getByRole('button', { name: 'Got it' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Got it' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(interestButton).toBeFocused();
    expect(pageErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});

for (const viewport of viewports) {
  test(`renders without horizontal overflow at the ${viewport.name} breakpoint`, async ({
    page,
  }) => {
    await test.step(`Given a ${viewport.width}px viewport`, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    await test.step('When the demo pitch loads', async () => {
      await page.goto('/p/demo-blair');
      await expect(page.getByText('+2 friends vouch')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.getAnimations().every((animation) => animation.playState === 'finished'),
          ),
        )
        .toBe(true);
    });

    await test.step('Then the page fits and a fresh screenshot is captured', async () => {
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);

      if (viewport.name === 'mobile') {
        await page.locator('[class*="mobileInterest"]').evaluate((element) => {
          element.setAttribute('data-capture-hidden', 'true');
          (element as HTMLElement).style.display = 'none';
        });
      }
      await page.screenshot({
        path: `/tmp/friendword-pitch-${viewport.width}.png`,
        fullPage: true,
      });

      if (viewport.name === 'mobile') {
        await page.locator('[data-capture-hidden]').evaluate((element) => {
          element.removeAttribute('data-capture-hidden');
          (element as HTMLElement).style.removeProperty('display');
        });
        const mobileInterestButton = page.getByRole('button', { name: "I'm interested" }).last();
        await expect(mobileInterestButton).toBeVisible();
        const firstVouchCard = page.locator('blockquote').first().locator('..');
        await firstVouchCard.evaluate((card) => {
          const dock = document.querySelector('[class*="mobileInterest"]');
          if (!(dock instanceof HTMLElement)) {
            return;
          }
          const cardBottom = card.getBoundingClientRect().bottom;
          const dockHeight = dock.getBoundingClientRect().height;
          window.scrollBy({ top: cardBottom - (window.innerHeight - dockHeight - 16) });
        });
        const buttonBox = await mobileInterestButton.boundingBox();
        expect(buttonBox?.y).toBeGreaterThan(0);
        expect(buttonBox === null ? null : buttonBox.y + buttonBox.height).toBeLessThanOrEqual(
          viewport.height,
        );
        await page.screenshot({
          path: '/tmp/friendword-pitch-mobile-sticky.png',
          fullPage: false,
        });

        await page.locator('[data-pitch-footer]').scrollIntoViewIfNeeded();
        await expect(page.locator('[class*="mobileInterestHidden"]')).toHaveCSS('opacity', '0');
      }
    });
  });
}

test('returns not found when the campaign slug is unknown', async ({ page }) => {
  await test.step('Given an unknown public campaign slug', async () => {
    const response = await page.goto('/p/nope');
    expect(response?.status()).toBe(404);
  });

  await test.step('Then the pitch player is not rendered', async () => {
    await expect(page.getByRole('heading', { name: 'Blair, 29' })).toHaveCount(0);
  });
});
