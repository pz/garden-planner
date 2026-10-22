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

  test('the compass sets which way north points, by keys or by dragging, and survives a reload', async ({ page, garden }) => {
    await garden.seed(planted());
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit layout' }).click();
    const compass = page.getByRole('slider', { name: 'North direction' });
    await expect(compass).toHaveAttribute('aria-valuenow', '0');

    await compass.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); // 6 × 15°
    await expect(compass).toHaveAttribute('aria-valuenow', '90');
    expect((await garden.plan()).northDeg).toBe(90);

    // Drag the needle to point down the screen (south-up): 180° clockwise from up.
    const box = (await compass.boundingBox())!;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await garden.drag(c, { x: c.x, y: c.y + 30 });
    await expect(compass).toHaveAttribute('aria-valuenow', '180');
    expect((await garden.plan()).northDeg).toBe(180);
    // Turning north never touches the beds or plants.
    expect((await garden.plan()).beds).toEqual(planted().beds);

    await page.reload();
    await page.getByRole('button', { name: 'Edit layout' }).click();
    await expect(page.getByRole('slider', { name: 'North direction' })).toHaveAttribute('aria-valuenow', '180');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('compass')).toHaveAttribute('title', /180°/);
  });

  test('the layout editor and the plant view are full bleed, hanging below the header', async ({ page, garden }) => {
    await garden.seed(planted());
    await page.goto('/');
    const viewport = page.viewportSize()!;
    const headerBottom = (await page.locator('header').boundingBox())!.y + (await page.locator('header').boundingBox())!.height;

    const plantView = (await page.getByTestId('garden-viewport').boundingBox())!;
    expect(plantView).toMatchObject({ x: 0, width: viewport.width });
    expect(plantView.y).toBeCloseTo(headerBottom, 0);
    expect(plantView.y + plantView.height).toBeCloseTo(viewport.height, 0);

    await page.getByRole('button', { name: 'Edit layout' }).click();
    const editor = (await page.getByTestId('layout-editor').boundingBox())!;
    expect(editor).toMatchObject({ x: 0, width: viewport.width });
    expect(editor.y).toBeCloseTo(headerBottom, 0);
    expect(editor.y + editor.height).toBeCloseTo(viewport.height, 0);
  });
});

test.describe('lines', () => {
  test('the Line tool draws a line that is saved, can be selected and deleted, and undone', async ({ page, garden }) => {
    await garden.seed(gardenWith());
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit layout' }).click();
    const from = await insideBed(page);
    await page.getByRole('button', { name: 'Line (L)' }).click();
    await garden.drag(from, { x: from.x + 200, y: from.y });

    const lines = (await garden.plan()).lines!;
    expect(lines).toHaveLength(1);
    expect(lines[0].b.y).toBe(lines[0].a.y);
    expect(lines[0].b.x).toBeGreaterThan(lines[0].a.x);

    await page.keyboard.press('Escape'); // back to Select
    await page.locator('[data-line-id] line').nth(1).click({ force: true });
    await page.keyboard.press('Delete');
    expect((await garden.plan()).lines).toBeUndefined();

    await page.keyboard.press('Control+z');
    expect((await garden.plan()).lines).toHaveLength(1);
  });

  test('a line shows in the planting view too', async ({ page, garden }) => {
    const plan = { ...gardenWith(), lines: [{ id: 'l1', a: { x: 0, y: 60 }, b: { x: 96, y: 60 } }] };
    await garden.seed(plan);
    await page.goto('/');
    await expect(page.locator('[data-testid="garden-viewport"] svg line')).toHaveCount(1);
  });
});
