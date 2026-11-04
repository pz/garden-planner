import { expect, test, gardenWith } from './fixtures';

// The solver viewer is a development-only page (see App.tsx); the dev server these tests run against serves it.

test('/_solver: load a scenario, solve, see the new patches outlined, and apply them', async ({ page }) => {
  await page.goto('/_solver');
  await expect(page.getByRole('heading', { name: 'Planting solver' })).toBeVisible();

  await page.getByLabel('Scenario').selectOption('fill-empty-4x8');
  await expect(page.getByLabel('Spec (JSON)')).toHaveValue(/"tomato"/);
  await page.getByLabel('Iterations').fill('300');
  await page.getByRole('button', { name: 'Solve' }).click();

  // The proposal: the crops table, a score breakdown, and plants in the After panel, all outlined as new.
  const after = page.locator('[data-panel="after"]');
  await expect(after.locator('[data-plant-id]').first()).toBeVisible();
  const planted = await after.locator('[data-plant-id]').count();
  expect(planted).toBeGreaterThan(8);
  await expect(after.locator('[data-new-plant]')).toHaveCount(planted);
  await expect(page.getByRole('table', { name: 'Crops' }).locator('[data-crop-row="tomato"]')).toContainText('met');
  await expect(page.getByRole('table', { name: 'Score' })).toContainText('total');
  await expect(page.locator('[data-panel="before"] [data-plant-id]')).toHaveCount(0);

  // Applying goes through the garden API.
  await page.getByRole('button', { name: 'Apply to this garden' }).click();
  await expect(page.getByRole('status')).toContainText('Applied');
});

test('/_solver: a bad spec is reported with its path, and a replace scenario shows its expectations', async ({ page }) => {
  await page.goto('/#/_solver');
  await page.getByLabel('Spec (JSON)').fill('{ "mode": "fill", "demands": [{ "cropId": "ghost", "weight": 1 }] }');
  await page.getByRole('button', { name: 'Solve' }).click();
  await expect(page.getByRole('alert')).toContainText('unknown_crop');
  await expect(page.getByRole('alert')).toContainText('/demands/0/cropId');

  await page.getByLabel('Scenario').selectOption('replace-bed-2');
  await page.getByLabel('Iterations').fill('300');
  await page.getByRole('button', { name: 'Solve' }).click();
  await expect(page.getByText('All 3 hold.')).toBeVisible();
  // Bed 1 is outside the scope, so nothing there is new; bed 2 has new plants.
  await expect(page.locator('[data-panel="after"] [data-bed-view="bed-2"] [data-new-plant]').first()).toBeVisible();
  await expect(page.locator('[data-panel="after"] [data-bed-view="bed-1"] [data-new-plant]')).toHaveCount(0);
});

test('/_solver: the current garden is a source too, and Apply changes the saved garden', async ({ page, garden }) => {
  await garden.seed(gardenWith([]));
  await page.goto('/_solver');
  await page.getByLabel('Scenario').selectOption('current-garden');
  await page.getByLabel('Iterations').fill('200');
  await page.getByRole('button', { name: 'Solve' }).click();
  await expect(page.locator('[data-panel="after"] [data-plant-id]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Apply to this garden' }).click();
  await expect(page.getByRole('status')).toContainText('Applied');
  expect((await garden.plan()).plants.length).toBeGreaterThan(5);
});
