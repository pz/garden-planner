import { expect, test } from './fixtures';

test('a first visit walks through setup and lands on an empty bed', async ({ page, garden }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little about your garden' })).toBeVisible();
  await page.getByRole('button', { name: 'Zone 8' }).click();
  await page.getByRole('button', { name: /^Part shade/ }).click();
  await page.getByRole('button', { name: 'Continue to your garden' }).click();

  await expect(page.getByRole('button', { name: 'Edit layout' })).toBeVisible();
  const plan = await garden.plan();
  expect(plan.profile).toMatchObject({ zoneId: '8', sunExposure: 'part-shade', onboarded: true });
  expect(plan.beds).toHaveLength(1);
  expect(plan.plants).toEqual([]);
});
