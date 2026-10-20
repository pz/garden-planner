import { expect, gardenWith, test } from './fixtures';

test.describe('planting', () => {
  test('right-clicking the bed offers crops, and picking one plants it there', async ({ page, garden }) => {
    await garden.seed(gardenWith());
    await page.goto('/');
    const at = await garden.bedPoint('bed-1', 20, 24);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('button', { name: /^Tomato/ }).click();

    const { plants } = await garden.plan();
    expect(plants).toHaveLength(1);
    expect(plants[0]).toMatchObject({ bedId: 'bed-1', cropId: 'tomato' });
    expect(plants[0].x).toBeCloseTo(20, 0);
    expect(plants[0].y).toBeCloseTo(24, 0);
    expect(plants[0].groupId).toBeTruthy();
  });

  test('the menu refuses a crop that would crowd an existing plant', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ cropId: 'tomato', x: 48, y: 24 }]));
    await page.goto('/');
    // 14in from a tomato. The planting menu refuses within 0.7 of the average of the two crops'
    // spacings: tomato+tomato (24) → 16.8in, so a tomato is refused; tomato+carrot (13.5) → 9.45in, so a carrot is not.
    const at = await garden.bedPoint('bed-1', 62, 24);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const tomato = page.getByRole('button', { name: /^Tomato/ });
    await expect(tomato).toBeDisabled();
    await expect(tomato).toContainText("Won't fit here");
    await expect(page.getByRole('button', { name: /^Carrot/ })).toBeEnabled();
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

  test('a plant dragged past the bed edge stays inside it', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ cropId: 'basil', x: 90, y: 24 }]));
    await page.goto('/');
    const from = await garden.plantPoint('p1');
    await garden.drag(from, { x: from.x + 400, y: from.y });
    const [p] = (await garden.plan()).plants;
    expect(p.x).toBeLessThanOrEqual(96);
    expect(p.x).toBeGreaterThan(90);
  });

  test('the card\'s Remove button deletes just that plant', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'kale', x: 30, y: 30 }, { id: 'b', cropId: 'basil', x: 70, y: 30 }]));
    await page.goto('/');
    const at = await garden.plantPoint('a');
    await page.mouse.click(at.x, at.y);
    await expect(page.getByText('Kale').first()).toBeVisible();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
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
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await garden.plan()).plants).toEqual([
      expect.objectContaining({ id: 'keep', groupId: 'keep', cropId: 'kale', x: 30, y: 30, variety: 'Lacinato' }),
    ]);
  });

  test('press and drag from a plant to grow a patch from it', async ({ page, garden }) => {
    await garden.seed(gardenWith([{ id: 'c1', cropId: 'carrot', x: 20, y: 24 }]));
    await page.goto('/');
    const from = await garden.plantPoint('c1');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(600); // long enough to count as a press-and-hold
    // Carrots are 3 in apart and the bed is drawn at 7 px/in: sweep out about four more of them to the right.
    await page.mouse.move(from.x + 40, from.y, { steps: 4 });
    await page.mouse.move(from.x + 90, from.y, { steps: 6 });
    await page.mouse.up();

    const { plants } = await garden.plan();
    expect(plants.length).toBeGreaterThanOrEqual(4);
    expect(new Set(plants.map((p) => p.groupId))).toEqual(new Set(['c1'])); // all in the dragged plant's patch
    expect(new Set(plants.map((p) => p.id)).size).toBe(plants.length);
    const xs = plants.map((p) => p.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(3, 6);
  });

  test('Remove patch deletes every member of the patch and nothing else', async ({ page, garden }) => {
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
    await expect(page.getByText('patch of 2')).toBeVisible();
    await page.getByRole('button', { name: 'Remove patch' }).click();
    expect((await garden.plan()).plants.map((p) => p.id)).toEqual(['solo']);
  });
});

test.describe('spacing warnings', () => {
  const crowded = () =>
    gardenWith([
      { id: 't1', cropId: 'tomato', x: 20, y: 24 },
      { id: 't2', cropId: 'tomato', x: 28, y: 24 }, // 8in apart; tomatoes want 24in
      { id: 'far', cropId: 'kale', x: 80, y: 24 },
    ]);

  test('close plants are flagged, well-spaced ones are not, and the card says why', async ({ page, garden }) => {
    await garden.seed(crowded());
    await page.goto('/');
    const t1 = await garden.plantPoint('t1');
    await page.mouse.click(t1.x, t1.y);
    await expect(page.getByText('too close to a neighbor')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
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
