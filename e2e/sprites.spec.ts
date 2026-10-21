import { expect, test } from './fixtures';

test('/_sprites shows a sprite for every crop, and turning them redraws them', async ({ page }) => {
  await page.goto('/_sprites');
  await expect(page.getByRole('heading', { name: 'Plant sprites' })).toBeVisible();
  const cards = page.locator('figure[data-sprite]');
  expect(await cards.count()).toBeGreaterThanOrEqual(35);
  await expect(page.getByText('without a sprite')).toHaveCount(0);
  // Each card holds drawn art (leaf shapes), not an empty or flat-disc placeholder.
  for (const id of ['tomato', 'artichoke']) expect(await page.locator(`figure[data-sprite="${id}"] svg path`).count()).toBeGreaterThan(10);

  const before = await page.locator('figure[data-sprite="kale"] svg').first().innerHTML();
  await page.getByRole('slider', { name: 'Turn' }).fill('200');
  expect(await page.locator('figure[data-sprite="kale"] svg').first().innerHTML()).not.toBe(before);
});

test('the hash form works too, for hosts that cannot serve the path', async ({ page }) => {
  await page.goto('/#/_sprites');
  await expect(page.getByRole('heading', { name: 'Plant sprites' })).toBeVisible();
});
