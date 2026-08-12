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

test('shows the honest written demo and opens the interest flow', async ({ page }) => {
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
    // GP-P0-3: the demo shows no fabricated age — the heading is the name alone.
    await expect(page.getByRole('heading', { level: 1, name: 'Blair', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Blair, 29' })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.sessionStorage.getItem('fw_attribution')))
      .toBe('instagram');
  });

  await test.step('When the visitor reads the demo (CP-3: no fake playback)', async () => {
    const interestButton = page.getByRole('link', { name: "I'm interested" }).first();
    await interestButton.hover();
    await waitForAnimations(interestButton);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({ path: '/tmp/friendword-pitch-interest-hover.png', fullPage: false });
    await expect(page.getByRole('button', { name: /Play .*pitch/ })).toHaveCount(0);
    await expect(page.getByTestId('written-pitch')).toContainText('you should meet Blair');
    await expect(page.getByText('No voice recording in this preview')).toBeVisible();
  });

  await test.step('Then interest routes to the profile flow', async () => {
    await expect(
      page.getByText(
        'Interest requires signing in and completing a dating profile with 2 photos, a bio, and dating intent.',
      ),
    ).toBeVisible();
    const interestButton = page.getByRole('link', { name: "I'm interested" }).first();
    await page.keyboard.press('Tab');
    await expect(interestButton).toBeFocused();
    await page.screenshot({ path: '/tmp/friendword-pitch-interest-focus.png', fullPage: false });
    await interestButton.click();
    await page.waitForURL('**/p/demo-blair/interest');
    await expect(
      page.getByRole('heading', { name: 'This is a demo — Blair isn’t a real person.' }),
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/friendword-pitch-interest-demo.png', fullPage: false });
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
      // GP-P0-3: no fabricated "+2 friends vouch" (Flow D is unshipped). CP-2:
      // the dater-approved structure renders as labelled scenes instead.
      await expect(page.getByText('friends vouch')).toHaveCount(0);
      await expect(page.getByText('Three specific things')).toBeVisible();
      await expect(page.getByText('Demo data').first()).toBeVisible();
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
        const mobileInterestButton = page.getByRole('link', { name: "I'm interested" }).last();
        await expect(mobileInterestButton).toBeVisible();
        // The vouch cards are gone (Flow D unshipped); anchor the scroll on the
        // structured story card, which sits mid-page above the footer.
        const storyCard = page.locator('[class*="storyCard"]').first();
        await storyCard.evaluate((card) => {
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
    await expect(page.getByRole('heading', { name: 'Blair' })).toHaveCount(0);
  });
});

// Slice 5 (GP-P0-2 / H-8): the "Pitch a friend" footer CTA now routes new
// visitors into the landing waitlist, carrying the pitch's slug as a referral so
// the source campaign keeps attribution. "Create my Friendword" still deep-links
// to the create anchor.
test('routes the pitch footer CTA into the waitlist with referral attribution', async ({
  page,
}) => {
  await page.goto('/p/demo-blair');

  // The public pitch seeds its own slug as the first-touch referral, in
  // localStorage so it survives the closed tab between viewing and signing in.
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('fw_referral')))
    .not.toBeNull();
  const seeded = JSON.parse(
    (await page.evaluate(() => window.localStorage.getItem('fw_referral'))) ?? 'null',
  );
  expect(seeded.slug).toBe('demo-blair');

  const pitchFriend = page.getByRole('link', { name: 'Pitch a friend' });
  await expect(pitchFriend).toHaveAttribute('href', '/?src=public-pitch&ref=demo-blair#start');
  await pitchFriend.click();
  await page.waitForURL('**/?src=public-pitch&ref=demo-blair#start');
  await expect(page.locator('#start')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'The beta is open. The app isn’t.' }),
  ).toBeVisible();

  await page.goto('/p/demo-blair');
  const createFriendword = page.getByRole('link', { name: 'Create my Friendword' });
  await expect(createFriendword).toHaveAttribute('href', '/#create');
  await createFriendword.click();
  await page.waitForURL('**/#create');
  await expect(page.locator('#create')).toBeVisible();
});
