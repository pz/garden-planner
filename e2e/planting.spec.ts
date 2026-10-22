import type { Page } from '@playwright/test';
import { expect, gardenWith, test } from './fixtures';

/** Picks a plant from the list, then moves off it and waits for the list (open while hovered) to fold back over the bed. */
async function arm(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.mouse.move(700, 600);
  await page.waitForTimeout(300);
}

test.describe('planting', () => {
  test('the garden switcher dropdown opens in front of the plant toolbar', async ({ page, garden }) => {
    await garden.seed(gardenWith());
    await page.goto('/');
    await page.locator('header button', { hasText: '▾' }).click();
    const menu = page.locator('header div[style*="width: 260px"]');
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    const onTop = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest('header'),
      [box.x + 20, box.y + box.height - 4],
    );
    expect(onTop).toBe(true);
  });

  test('right-clicking the bed offers recent crops, and picking one plants it there', async ({ page, garden }) => {
    await garden.seed(gardenWith());
    await page.goto('/');
    const at = await garden.bedPoint('bed-1', 20, 24);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(page.getByText('Plant here')).toBeVisible();
    await page.getByRole('menuitem', { name: /^Tomato/ }).click();

    const { plants } = await garden.plan();
    expect(plants).toHaveLength(1);
    expect(plants[0]).toMatchObject({ bedId: 'bed-1', cropId: 'tomato' });
    expect(plants[0].x).toBeCloseTo(20, 0);
    expect(plants[0].y).toBeCloseTo(24, 0);
    expect(plants[0].groupId).toBeTruthy();
  });

  test('picking a plant arms planting: each click in a bed places one, and it stays armed until Done', async ({ page, garden }) => {
    await garden.seed(gardenWith());
    await page.goto('/');
    await arm(page, 'Kale');
    await expect(page.getByRole('status')).toContainText('Kale');

    for (const x of [20, 60]) {
      const at = await garden.bedPoint('bed-1', x, 24);
      await page.mouse.click(at.x, at.y);
    }
    expect((await garden.plan()).plants.map((p) => [p.cropId, Math.round(p.x)])).toEqual([['kale', 20], ['kale', 60]]);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
    const at = await garden.bedPoint('bed-1', 40, 40);
    await page.mouse.click(at.x, at.y); // selecting now, not planting
    expect((await garden.plan()).plants).toHaveLength(2);
  });

  test('clicking a plant, or off every bed, while armed goes back to selecting', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'kale', x: 30, y: 24 }]));
    await page.goto('/');
    await arm(page, 'Basil');
    const plant = await garden.plantPoint('a');
    await page.mouse.click(plant.x, plant.y);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Selection' })).toContainText('Kale');
    expect((await garden.plan()).plants).toHaveLength(1);
  });

  test('painting across a bed plants one patch at the crop spacing, skipping taken spots', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'x', cropId: 'kale', x: 60, y: 24 }]));
    await page.goto('/');
    await arm(page, 'Carrot');
    const from = await garden.bedPoint('bed-1', 6, 24);
    const to = await garden.bedPoint('bed-1', 36, 24);
    await garden.drag(from, to);

    const carrots = (await garden.plan()).plants.filter((p) => p.cropId === 'carrot');
    expect(carrots.length).toBeGreaterThanOrEqual(8);
    expect(new Set(carrots.map((p) => p.groupId)).size).toBe(1);
    const xs = carrots.map((p) => p.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(3, 6);
  });

  test('overlapping plants are allowed, and flagged', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'tomato', x: 48, y: 24 }]));
    await page.goto('/');
    const at = await garden.bedPoint('bed-1', 62, 24); // 14 in away; tomatoes want 24
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('menuitem', { name: /^Tomato/ }).click();
    const { plants } = await garden.plan();
    expect(plants).toHaveLength(2);
    await expect(page.getByRole('complementary', { name: 'Selection' })).toContainText('too close to a neighbor');
  });

  test('dragging a patch moves every member by the same amount', async ({ page, garden }) => {
    await garden.seed(
      gardenWith([
        { id: 'c1', cropId: 'carrot', x: 40, y: 20, groupId: 'c' },
        { id: 'c2', cropId: 'carrot', x: 43, y: 20, groupId: 'c' },
        { id: 'c3', cropId: 'carrot', x: 46, y: 20, groupId: 'c' },
      ]),
    );
    await page.goto('/');
    const from = await garden.plantPoint('c2');
    await garden.drag(from, { x: from.x + 70, y: from.y + 35 });

    const { plants } = await garden.plan();
    const moved = plants.map((p) => [p.x - ({ c1: 40, c2: 43, c3: 46 } as Record<string, number>)[p.id], p.y - 20]);
    expect(moved[0][0]).toBeGreaterThan(5);
    expect(moved[0][1]).toBeGreaterThan(2);
    for (const m of moved) {
      expect(m[0]).toBeCloseTo(moved[0][0], 6);
      expect(m[1]).toBeCloseTo(moved[0][1], 6);
    }
  });

  test('a plant dragged past the bed edge is refused and stays where it was', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ cropId: 'basil', x: 90, y: 24 }]));
    await page.goto('/');
    const from = await garden.plantPoint('p1');
    await garden.drag(from, { x: from.x + 400, y: from.y });
    await expect(page.getByText('Plants need to stay inside a bed')).toBeVisible();
    const [p] = (await garden.plan()).plants;
    expect([p.x, p.y]).toEqual([90, 24]);
  });

  test('a plant dragged into another bed moves there', async ({ page, garden }) => {
    const plan = gardenWith([{ id: 'a', cropId: 'basil', x: 80, y: 24 }]);
    plan.beds.push({ id: 'bed-2', name: 'Bed 2', shape: 'rect', cx: 48 + 140, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0 });
    await garden.seed(plan);
    await page.goto('/');
    const from = await garden.plantPoint('a');
    const to = await garden.bedPoint('bed-2', 20, 20);
    await garden.drag(from, to);
    const [p] = (await garden.plan()).plants;
    expect(p.bedId).toBe('bed-2');
    expect(p.x).toBeCloseTo(20, 0);
  });

  test('in a turned bed, a plant lands where you pointed, in the bed\'s own frame', async ({ page, garden }) => {
    const plan = gardenWith();
    plan.beds[0] = { ...plan.beds[0], rotationDeg: 90 }; // 96 × 48 turned to stand 48 wide and 96 tall
    await garden.seed(plan);
    await page.goto('/');
    const box = (await page.locator('[data-bed-id="bed-1"]').boundingBox())!;
    expect(box.height).toBeGreaterThan(box.width);
    // The bed's top-left corner turns to the top-right of the turned box; walk 24 in along the bed's x axis (down the screen).
    const scale = box.height / 96;
    await page.mouse.click(box.x + box.width - 10 * scale, box.y + 24 * scale, { button: 'right' });
    await page.getByRole('menuitem', { name: /^Tomato/ }).click();
    const [p] = (await garden.plan()).plants;
    expect(p.x).toBeCloseTo(24, 0);
    expect(p.y).toBeCloseTo(10, 0);
  });

  test('dragging across bare soil selects the plants inside, and the panel counts them', async ({ page, garden }) => {
    await garden.seed(
      gardenWith([
        { id: 'a', cropId: 'kale', x: 20, y: 20 },
        { id: 'b', cropId: 'kale', x: 40, y: 20 },
        { id: 'c', cropId: 'kale', x: 80, y: 20 },
      ]),
    );
    await page.goto('/');
    await garden.drag(await garden.bedPoint('bed-1', 2, 4), await garden.bedPoint('bed-1', 50, 40));
    await expect(page.getByRole('complementary', { name: 'Selection' })).toContainText('2 kale plants');
    expect((await garden.plan()).plants).toHaveLength(3); // selecting changes nothing
  });

  test('Group into patch and Ungroup join and split plants', async ({ page, garden }) => {
    await garden.seed(
      gardenWith([
        { id: 'a', cropId: 'kale', x: 20, y: 20 },
        { id: 'b', cropId: 'basil', x: 40, y: 20 },
      ]),
    );
    await page.goto('/');
    await garden.drag(await garden.bedPoint('bed-1', 2, 4), await garden.bedPoint('bed-1', 50, 40));
    await page.getByRole('button', { name: /^Group into patch/ }).click();
    expect(new Set((await garden.plan()).plants.map((p) => p.groupId)).size).toBe(1);
    await expect(page.getByRole('complementary', { name: 'Selection' })).toContainText('Mixed patch');

    await page.getByRole('button', { name: /^Ungroup/ }).click();
    expect(new Set((await garden.plan()).plants.map((p) => p.groupId)).size).toBe(2);
  });

  test('Duplicate stamps copies wherever you click, until Done', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'basil', x: 20, y: 20 }]));
    await page.goto('/');
    const at = await garden.plantPoint('a');
    await page.mouse.click(at.x, at.y);
    await page.getByRole('button', { name: /^Duplicate/ }).click();
    await expect(page.getByRole('status')).toContainText('Duplicating 1 plant');
    for (const x of [50, 70]) {
      const p = await garden.bedPoint('bed-1', x, 30);
      await page.mouse.click(p.x, p.y);
    }
    expect((await garden.plan()).plants).toHaveLength(3);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('the panel\'s Delete button deletes just that plant', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'kale', x: 30, y: 30 }, { id: 'b', cropId: 'basil', x: 70, y: 30 }]));
    await page.goto('/');
    const at = await garden.plantPoint('a');
    await page.mouse.click(at.x, at.y);
    await expect(page.getByRole('complementary', { name: 'Selection' })).toContainText('Kale');
    await page.getByRole('button', { name: 'Delete plant' }).click();
    expect((await garden.plan()).plants.map((p) => p.id)).toEqual(['b']);
  });

  test('Delete removes the selected plant and the toast Undo brings it back unchanged', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'keep', cropId: 'kale', x: 30, y: 30, variety: 'Lacinato' }]));
    await page.goto('/');
    const at = await garden.plantPoint('keep');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('Delete');
    expect((await garden.plan()).plants).toEqual([]);

    await expect(page.getByText('Removed Kale')).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await garden.plan()).plants).toEqual([
      expect.objectContaining({ id: 'keep', groupId: 'keep', cropId: 'kale', x: 30, y: 30, variety: 'Lacinato' }),
    ]);
  });

  test('Undo (⌘Z) takes back the last change, one at a time', async ({ page, garden }) => {
    await garden.seed(gardenWith());
    await page.goto('/');
    await arm(page, 'Kale');
    for (const x of [20, 60]) {
      const at = await garden.bedPoint('bed-1', x, 24);
      await page.mouse.click(at.x, at.y);
    }
    await page.getByRole('button', { name: 'Undo last change' }).click();
    expect((await garden.plan()).plants).toHaveLength(1);
    await page.keyboard.press('Control+z');
    expect((await garden.plan()).plants).toHaveLength(0);
    await expect(page.getByRole('button', { name: 'Undo last change' })).toBeDisabled();
  });

  test('deleting a patch removes every member of it and nothing else', async ({ page, garden }) => {
    await garden.seed(
      gardenWith([
        { id: 'c1', cropId: 'carrot', x: 40, y: 20, groupId: 'c' },
        { id: 'c2', cropId: 'carrot', x: 43, y: 20, groupId: 'c' },
        { id: 'solo', cropId: 'kale', x: 80, y: 40 },
      ]),
    );
    await page.goto('/');
    const at = await garden.plantPoint('c1');
    await page.mouse.click(at.x, at.y);
    await expect(page.getByRole('complementary', { name: 'Selection' })).toContainText('Carrot patch');
    await page.getByRole('button', { name: 'Delete 2 plants' }).click();
    expect((await garden.plan()).plants.map((p) => p.id)).toEqual(['solo']);
  });

  test('clicking a patch selects it all; clicking again picks one plant', async ({ page, garden }) => {
    await garden.seed(
      gardenWith([
        { id: 'c1', cropId: 'carrot', x: 40, y: 20, groupId: 'c' },
        { id: 'c2', cropId: 'carrot', x: 43, y: 20, groupId: 'c' },
      ]),
    );
    await page.goto('/');
    const at = await garden.plantPoint('c1');
    await page.mouse.click(at.x, at.y);
    const panel = page.getByRole('complementary', { name: 'Selection' });
    await expect(panel).toContainText('Carrot patch');
    await page.mouse.click(at.x, at.y);
    await expect(panel).toContainText('One plant from a patch of 2');
  });
});

test.describe('spacing warnings', () => {
  const crowded = () =>
    gardenWith([
      { id: 't1', cropId: 'tomato', x: 20, y: 24 },
      { id: 't2', cropId: 'tomato', x: 28, y: 24 }, // 8in apart; tomatoes want 24in
      { id: 'far', cropId: 'kale', x: 80, y: 24 },
    ]);

  test('close plants are flagged, well-spaced ones are not, and the panel says why', async ({ page, garden }) => {
    await garden.seed(crowded());
    await page.goto('/');
    const t1 = await garden.plantPoint('t1');
    await page.mouse.click(t1.x, t1.y);
    await expect(page.getByText('too close to a neighbor')).toBeVisible();

    await page.getByRole('button', { name: 'Deselect' }).click();
    const far = await garden.plantPoint('far');
    await page.mouse.click(far.x, far.y);
    await expect(page.getByText('too close to a neighbor')).toHaveCount(0);
  });

  test('dismissing the warning is saved and survives a reload', async ({ page, garden }) => {
    await garden.seed(crowded());
    await page.goto('/');
    const t1 = await garden.plantPoint('t1');
    await page.mouse.click(t1.x, t1.y);
    await page.getByRole('button', { name: 'Dismiss this warning' }).click();
    expect((await garden.plan()).dismissedConflictKeys).toEqual(['t1::t2']);

    await page.reload();
    const again = await garden.plantPoint('t1');
    await page.mouse.click(again.x, again.y);
    await expect(page.getByText('too close to a neighbor')).toHaveCount(0);
  });
});

test.describe('shade and companion warnings', () => {
  test('a tall crop just south of a full-sun crop is reported as shading it, in the card', async ({ page, garden }) => {
    // Up is north. The tomato (48 in tall) shades 26 in north of it: the basil there wants full sun.
    await garden.seed(gardenWith([{ id: 't', cropId: 'tomato', x: 40, y: 44 }, { id: 'b', cropId: 'basil', x: 40, y: 18 }]));
    await page.goto('/');
    const basil = await garden.plantPoint('b');
    await page.mouse.click(basil.x, basil.y);
    await expect(page.getByText('! In shade from a neighbor')).toBeVisible();
    await expect(page.getByText(/Tomato \(about 48 in tall\) shades Basil/)).toBeVisible();
    await expect(page.getByText('too close to a neighbor')).toHaveCount(0); // 26 in apart is fine for spacing
  });

  test('turning the garden so that north is down moves the shadow to the other side', async ({ page, garden }) => {
    const plan = gardenWith([{ id: 't', cropId: 'tomato', x: 40, y: 44 }, { id: 'b', cropId: 'basil', x: 40, y: 18 }]);
    await garden.seed({ ...plan, northDeg: 180 });
    await page.goto('/');
    const basil = await garden.plantPoint('b');
    await page.mouse.click(basil.x, basil.y);
    await expect(page.getByRole('button', { name: 'Delete plant' })).toBeVisible(); // the panel is open
    await expect(page.getByText('In shade from a neighbor')).toHaveCount(0);
  });

  test('beans near onions get a plain-spoken "usually kept apart" note, which can be dismissed and stays dismissed', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'be', cropId: 'beans', x: 20, y: 10 }, { id: 'o', cropId: 'onion', x: 30, y: 10 }]));
    await page.goto('/');
    const beans = await garden.plantPoint('be');
    await page.mouse.click(beans.x, beans.y);
    await expect(page.getByText('! Usually kept apart')).toBeVisible();
    await expect(page.getByText(/little research behind it/)).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss this warning' }).click();
    expect((await garden.plan()).dismissedWarnings).toEqual(['companion:be::o']);
    await page.reload();
    const again = await garden.plantPoint('be');
    await page.mouse.click(again.x, again.y);
    await expect(page.getByText('! Usually kept apart')).toHaveCount(0);
  });
});

test.describe('crowded beds and modifier keys', () => {
  test('a click plants even where a plant already is, and the spacing warning follows', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'tomato', x: 40, y: 24 }]));
    await page.goto('/');
    await arm(page, 'Tomato');
    const at = await garden.bedPoint('bed-1', 54, 24); // clear of the tomato's hit area but well inside its spacing
    await page.mouse.click(at.x, at.y);
    expect((await garden.plan()).plants.map((p) => p.cropId)).toEqual(['tomato', 'tomato']);
  });

  test('the plant list can be pinned open, and stays pinned after a reload', async ({ page, garden }) => {
    await garden.seed(gardenWith());
    await page.goto('/');
    const panel = page.getByRole('complementary', { name: 'Plants' });
    expect((await panel.boundingBox())!.width).toBeLessThan(100);
    await panel.hover(); // the pin appears once the list opens
    await page.getByRole('button', { name: 'Keep plant list open' }).click();
    await page.mouse.move(700, 600);
    await page.waitForTimeout(300);
    expect((await panel.boundingBox())!.width).toBeGreaterThan(200);
    await page.reload();
    await page.waitForTimeout(300);
    expect((await panel.boundingBox())!.width).toBeGreaterThan(200);
  });

  test('Ctrl-dragging from outside every bed selects the plants it covers', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'kale', x: 20, y: 24 }, { id: 'b', cropId: 'kale', x: 80, y: 24 }]));
    await page.goto('/');
    const a = await garden.plantPoint('a');
    const b = await garden.plantPoint('b');
    await page.keyboard.down('Control');
    await garden.drag({ x: a.x - 60, y: a.y - 200 }, { x: b.x + 60, y: b.y + 60 });
    await page.keyboard.up('Control');
    await expect(page.getByText(/2 plants|Kale/).first()).toBeVisible();
    await page.keyboard.press('Delete');
    expect((await garden.plan()).plants).toHaveLength(0);
  });
});
