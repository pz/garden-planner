import { readFile, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { GardenFile } from '../src/core/gardenFile';
import { expect, gardenWith, test } from './fixtures';

const LIBRARY_KEY = 'garden-planner-custom-crops/v1';
/** A saved user-made plant, as the app stores it (spelled out: the data layer can't be imported into Node as is). */
const mine = {
  id: 'custom-abc12345',
  name: 'Rhubarb',
  family: 'custom',
  spacingIn: 30,
  defaultPatch: false,
  sowMethod: 'direct-sow',
  directSowWeeksRelativeToLastFrost: 0,
  daysToMaturity: 0,
  sunNeed: 'partial',
  look: { shape: 'bushy', leaf: 'dark', accent: 'red' },
  heightIn: 36,
};

/** Saves `mine` as the app's own plant library, on the first load only (a reload must keep what the app saved). */
const seedLibrary = (page: Page) =>
  page.addInitScript(
    ([k, v]) => {
      if (!localStorage.getItem('garden-planner-index/v1')) localStorage.setItem(k, v);
    },
    [LIBRARY_KEY, JSON.stringify({ version: 1, crops: [mine] })],
  );

/** Opens the plant list (it folds open while hovered) and waits for it to be wide enough to read. */
async function openList(page: Page) {
  await page.mouse.move(40, 300);
  await expect(page.getByRole('complementary', { name: 'Plants' })).toHaveCSS('width', '256px');
}

test.describe('your own plants', () => {
  test('are made in the list, planted at once, and kept for next time', async ({ page, garden }) => {
    await garden.seed(gardenWith());
    await page.goto('/');
    await openList(page);
    await page.getByRole('button', { name: 'Add your own plant' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Mystery herb');
    await page.getByRole('textbox', { name: 'Spacing' }).fill("1' 6\"");
    await expect(page.getByText('= 1′ 6″ apart')).toBeVisible();
    await page.getByRole('button', { name: 'Rosette' }).click();
    await page.getByRole('button', { name: 'Add plant' }).click();

    await expect(page.getByRole('status')).toContainText('Mystery herb'); // armed straight away
    await page.mouse.move(700, 600);
    await page.waitForTimeout(300);
    const at = await garden.bedPoint('bed-1', 30, 24);
    await page.mouse.click(at.x, at.y);
    const [plant] = (await garden.plan()).plants;
    expect(plant.cropId).toMatch(/^custom-/);

    await page.reload();
    await openList(page);
    await expect(page.getByText('My plants')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mystery herb', exact: true })).toBeVisible();
    expect(await page.locator('[data-plant-id]').count()).toBe(1);
    const stored = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), LIBRARY_KEY))!);
    expect(stored.crops[0]).toMatchObject({ name: 'Mystery herb', spacingIn: 18, look: { shape: 'rosette' } });
  });

  test('refuse a nameless plant and a spacing that cannot be read', async ({ page, garden }) => {
    await garden.seed(gardenWith());
    await page.goto('/');
    await openList(page);
    await page.getByRole('button', { name: 'Add your own plant' }).click();
    await page.getByRole('button', { name: 'Add plant' }).click();
    await expect(page.getByRole('alert')).toHaveText('Give your plant a name.');
    await page.getByRole('textbox', { name: 'Name' }).fill('X');
    await page.getByRole('textbox', { name: 'Spacing' }).fill('wide');
    await page.getByRole('button', { name: 'Add plant' }).click();
    await expect(page.getByRole('alert')).toContainText('Spacing should be');
  });

  test('are edited from the list, and deleting one takes its plants with it after a second click', async ({ page, garden }) => {
    await seedLibrary(page);
    await garden.seed(gardenWith([{ id: 'r1', cropId: mine.id, x: 30, y: 24 }, { id: 'k', cropId: 'kale', x: 70, y: 24 }]));
    await page.goto('/');
    await openList(page);
    await page.getByRole('button', { name: 'Edit Rhubarb' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Giant rhubarb');
    await page.getByRole('button', { name: 'Save' }).click();
    await openList(page);
    await expect(page.getByRole('button', { name: 'Giant rhubarb', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Edit Giant rhubarb' }).click();
    await page.getByRole('button', { name: 'Delete plant' }).click(); // asks first: one plant of it is in this garden
    await expect(page.getByRole('button', { name: 'Delete and remove 1 from garden' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete and remove 1 from garden' }).click();
    expect((await garden.plan()).plants.map((p) => p.id)).toEqual(['k']);
    await page.reload();
    await openList(page);
    await expect(page.getByText('My plants')).toHaveCount(0);
  });

  test('travel in the garden file, so it loads on a device that does not have them', async ({ page, garden }, info) => {
    await seedLibrary(page);
    await garden.seed(gardenWith([{ id: 'r1', cropId: mine.id, x: 30, y: 24 }]));
    await page.goto('/');
    await page.getByRole('button', { name: /Test garden/ }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('Export garden').click()]);
    const file = JSON.parse(await readFile((await download.path())!, 'utf8')) as GardenFile;
    expect(file.customCrops).toEqual([mine]);
    const path = info.outputPath('with-custom.json');
    await writeFile(path, JSON.stringify(file));

    // Another device: nothing saved but a plain garden.
    await page.evaluate((plan) => {
      localStorage.clear();
      localStorage.setItem('garden-planner-index/v1', JSON.stringify({ version: 1, gardenIds: ['other'], activeGardenId: 'other' }));
      localStorage.setItem('garden-planner-plan:other', JSON.stringify({ ...plan, id: 'other', name: 'Other garden', plants: [] }));
    }, await garden.plan());
    await page.reload();
    expect(await page.evaluate((k) => localStorage.getItem(k), LIBRARY_KEY)).toBeNull();
    await page.getByRole('button', { name: /Other garden/ }).click();
    await page.locator('input[type=file]').setInputFiles(path);

    await expect.poll(async () => (await garden.plan()).plants.map((p) => p.cropId)).toEqual([mine.id]);
    const stored = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), LIBRARY_KEY))!);
    expect(stored.crops).toEqual([mine]);
    await expect(page.locator('[data-plant-id]')).toHaveCount(1);
  });
});
