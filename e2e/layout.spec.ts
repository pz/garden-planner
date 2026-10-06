import type { Page } from '@playwright/test';
import type { Bed } from '../src/types';
import { expect, gardenWith, test } from './fixtures';

/** A point well inside the only bed: the layout editor fits the garden to its canvas, so a third of the way across, mid-height. */
async function insideBed(page: Page) {
  const box = (await page.getByTestId('layout-editor').boundingBox())!;
  return { x: box.x + box.width / 3, y: box.y + box.height / 2 };
}

test.describe('layout editor', () => {
  const planted = () =>
    gardenWith([
      { id: 'a', cropId: 'tomato', x: 20, y: 24 },
      { id: 'b', cropId: 'kale', x: 80, y: 40 },
    ]);

  test('dragging a bed moves the bed and leaves its plants untouched', async ({ page, garden }) => {
    await garden.seed(planted());
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit layout' }).click();
    const before = await garden.plan();
    const from = await insideBed(page);
    await garden.drag(from, { x: from.x + 90, y: from.y + 60 });

    const after = await garden.plan();
    expect(after.beds[0].cx).toBeGreaterThan(before.beds[0].cx);
    expect(after.beds[0].cy).toBeGreaterThan(before.beds[0].cy);
    expect(after.beds[0]).toMatchObject({ widthIn: 96, heightIn: 48, rotationDeg: 0 });
    expect(after.plants).toEqual(before.plants);
  });

  test('widening a bed keeps plants where they were in the garden', async ({ page, garden }) => {
    await garden.seed(planted());
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit layout' }).click();
    const inside = await insideBed(page);
    await page.mouse.click(inside.x, inside.y); // select the bed
    await page.getByRole('button', { name: 'Grow width' }).click(); // 8′ → 8′6″

    const plan = await garden.plan();
    const bed = plan.beds[0];
    expect(bed.widthIn).toBe(102);
    // Each plant's garden position (bed's top-left + local offset) is what it was before.
    const gardenX = (p: { x: number }) => bed.cx - bed.widthIn / 2 + p.x;
    const [a, b] = plan.plants;
    expect(gardenX(a)).toBeCloseTo(20, 6);
    expect(gardenX(b)).toBeCloseTo(80, 6);
    expect(a.y).toBeCloseTo(24, 6);
  });

  test('shrinking a bed over a plant asks first; keeping plants cancels, confirming removes only that plant', async ({ page, garden }) => {
    await garden.seed(planted());
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit layout' }).click();
    const inside = await insideBed(page);
    await page.mouse.click(inside.x, inside.y);
    const width = page.getByLabel('Width', { exact: true });
    await width.fill("5'");
    await width.press('Enter'); // 5′ wide: the kale at x=80 falls outside, the tomato at x=20 doesn't

    const dialog = page.getByRole('dialog', { name: 'Confirm' });
    await expect(dialog).toContainText('Remove 1 plant?');
    expect((await garden.plan()).plants).toHaveLength(2); // nothing happens until confirmed

    await dialog.getByRole('button', { name: 'Keep plants' }).click();
    expect(((await garden.plan()).beds[0] as Bed).widthIn).toBe(96);
    expect((await garden.plan()).plants).toHaveLength(2);

    await width.fill("5'");
    await width.press('Enter');
    await page.getByRole('dialog', { name: 'Confirm' }).getByRole('button', { name: 'Resize and remove' }).click();
    const plan = await garden.plan();
    expect(plan.beds[0].widthIn).toBe(60);
    expect(plan.plants.map((p) => p.id)).toEqual(['a']);
  });

  test('Undo restores the bed and plants after a confirmed removal', async ({ page, garden }) => {
    await garden.seed(planted());
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit layout' }).click();
    const before = await garden.plan();
    const inside = await insideBed(page);
    await page.mouse.click(inside.x, inside.y);
    await page.keyboard.press('Delete');
    await page.getByRole('dialog', { name: 'Confirm' }).getByRole('button', { name: 'Delete bed' }).click();
    expect((await garden.plan()).beds).toEqual([]);
    expect((await garden.plan()).plants).toEqual([]);

    await page.getByRole('button', { name: /^Undo/ }).click();
    const restored = await garden.plan();
    expect(restored.beds).toEqual(before.beds);
    expect(restored.plants).toEqual(before.plants);
  });
});
