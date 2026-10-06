import { readFile, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { GardenFile } from '../src/core/gardenFile';
import { expect, gardenWith, test } from './fixtures';

const planted = () =>
  gardenWith([
    { id: 'a', cropId: 'tomato', x: 20, y: 24 },
    { id: 'b', cropId: 'carrot', x: 60, y: 10, groupId: 'c' },
    { id: 'c2', cropId: 'carrot', x: 63, y: 10, groupId: 'c' },
  ]);

const openSwitcher = async (page: Page) => {
  if (!(await page.locator('input[type=file]').count())) await page.getByRole('button', { name: /Test garden/ }).click();
};

test.describe('export / load', () => {
  test('exports the garden as a self-describing file', async ({ page, garden }, info) => {
    await garden.seed(planted());
    await page.goto('/');
    await openSwitcher(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('Export garden').click()]);
    expect(download.suggestedFilename()).toMatch(/^test-garden-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(await readFile((await download.path())!, 'utf8')) as GardenFile;
    expect(file).toMatchObject({ format: 'garden-planner-export', formatVersion: 1 });
    expect(file.plan).toEqual(await garden.plan());
    info.annotations.push({ type: 'plants', description: String(file.plan.plants.length) });
  });

  test('loading an exported file adds it as a new garden with the same content', async ({ page, garden }, info) => {
    await garden.seed(planted());
    await page.goto('/');
    await openSwitcher(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('Export garden').click()]);
    const path = info.outputPath('roundtrip.json');
    await writeFile(path, await readFile((await download.path())!));

    await openSwitcher(page);
    await page.locator('input[type=file]').setInputFiles(path);
    await expect.poll(async () => (await garden.plan()).id).not.toBe('g1'); // the loaded garden becomes active, with a fresh id
    const loaded = await garden.plan();
    expect({ ...loaded, id: '' }).toEqual({ ...planted(), id: '' });
  });

  for (const [name, mutate, message] of [
    ['an unknown crop', (f: GardenFile) => (f.plan.plants[0].cropId = 'kale2'), 'plant 1 has an unknown crop (kale2)'],
    ['a plant in a missing bed', (f: GardenFile) => (f.plan.plants[0].bedId = 'nope'), "plant 1 is in a bed that doesn't exist"],
  ] as const) {
    test(`rejects a file with ${name} and leaves the saved gardens alone`, async ({ page, garden }, info) => {
      await garden.seed(planted());
      await page.goto('/');
      await openSwitcher(page);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('Export garden').click()]);
      const file = JSON.parse(await readFile((await download.path())!, 'utf8')) as GardenFile;
      mutate(file);
      const path = info.outputPath('bad.json');
      await writeFile(path, JSON.stringify(file));

      await openSwitcher(page);
      await page.locator('input[type=file]').setInputFiles(path);
      await expect(page.getByText(`Couldn't load garden: ${message}.`)).toBeVisible();
      expect((await garden.plan()).id).toBe('g1');
    });
  }

  test('rejects a file that is not JSON', async ({ page, garden }, info) => {
    await garden.seed(planted());
    await page.goto('/');
    await openSwitcher(page);
    const path = info.outputPath('junk.json');
    await writeFile(path, 'not json');
    await page.locator('input[type=file]').setInputFiles(path);
    await expect(page.getByText("That file isn't valid JSON.")).toBeVisible();
  });
});
