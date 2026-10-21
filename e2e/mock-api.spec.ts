import type { Warning } from '../src/api/types';
import { expect, gardenWith, test } from './fixtures';

// These run the real UI against the app's mock GardenApi, so they test the client on its own: what
// it asks the API for, and how it shows what the API says back. They don't depend on the real
// command layer's rules.

const warning = (over: Partial<Warning> = {}): Warning => ({
  id: 'spacing:a::b',
  kind: 'spacing',
  severity: 'problem',
  bedId: 'bed-1',
  subjects: ['a', 'b'],
  message: 'Tomato and Tomato are 8 in apart.',
  dismissed: false,
  ...over,
});

test.describe('the client, against a mock API', () => {
  test('planting from the menu asks the API to add that crop at that spot, and lets it choose the ids', async ({ page, garden, mock }) => {
    await garden.seed(gardenWith());
    await mock.enable();
    await page.goto('/');
    const at = await garden.bedPoint('bed-1', 20, 24);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('button', { name: /^Tomato/ }).click();

    const [command, ...rest] = await mock.commands();
    expect(rest).toEqual([]);
    expect(command).toMatchObject({ type: 'addPlant', bedId: 'bed-1', cropId: 'tomato' });
    expect((command as { x: number }).x).toBeCloseTo(20, 0);
    expect(command).not.toHaveProperty('id');
    expect(command).not.toHaveProperty('groupId');
    await expect(page.locator('[data-plant-id]')).toHaveCount(1);
  });

  test('dragging a patch asks to move that patch by the dragged amount', async ({ page, garden, mock }) => {
    await garden.seed(gardenWith([{ id: 'c1', cropId: 'carrot', x: 40, y: 20, groupId: 'row' }, { id: 'c2', cropId: 'carrot', x: 43, y: 20, groupId: 'row' }]));
    await mock.enable();
    await page.goto('/');
    const from = await garden.plantPoint('c1');
    await garden.drag(from, { x: from.x + 70, y: from.y + 35 });

    const [command] = await mock.commands();
    expect(command).toMatchObject({ type: 'movePatch', groupId: 'row' });
    expect((command as { dx: number }).dx).toBeGreaterThan(5);
    expect((command as { dy: number }).dy).toBeGreaterThan(2);
  });

  test('remove, undo, remove patch and variety edits each send the matching command', async ({ page, garden, mock }) => {
    await garden.seed(
      gardenWith([
        { id: 'k', cropId: 'kale', x: 30, y: 30, variety: 'Lacinato', groupId: 'kg' },
        { id: 'c1', cropId: 'carrot', x: 60, y: 10, groupId: 'row' },
        { id: 'c2', cropId: 'carrot', x: 63, y: 10, groupId: 'row' },
      ]),
    );
    await mock.enable();
    await page.goto('/');

    const kale = await garden.plantPoint('k');
    await page.mouse.click(kale.x, kale.y);
    await page.keyboard.press('Delete');
    await page.getByRole('button', { name: 'Undo' }).click(); // restores it under its old identity
    const carrot = await garden.plantPoint('c1');
    await page.mouse.click(carrot.x, carrot.y);
    await page.getByRole('button', { name: 'Remove patch' }).click();

    expect(await mock.commands()).toEqual([
      { type: 'removePlant', id: 'k' },
      { type: 'addPlant', id: 'k', groupId: 'kg', bedId: 'bed-1', cropId: 'kale', x: 30, y: 30, variety: 'Lacinato' },
      { type: 'removePatch', groupId: 'row' },
    ]);
  });

  test('a refused commit shows the API\'s reason and leaves the garden as it was', async ({ page, garden, mock }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'basil', x: 40, y: 24 }]));
    await mock.enable();
    await page.goto('/');
    await mock.failNext([{ code: 'outside_bed', path: '/commands/0', message: 'Plant center (101, 20) is outside bed "Bed 1".' }]);
    const from = await garden.plantPoint('a');
    await garden.drag(from, { x: from.x + 50, y: from.y });

    await expect(page.getByText('Plant center (101, 20) is outside bed "Bed 1".')).toBeVisible();
    expect((await mock.plan()).plants).toEqual([expect.objectContaining({ id: 'a', x: 40, y: 24 })]);
    // The next attempt isn't affected: the failure was one-shot.
    const again = await garden.plantPoint('a');
    await garden.drag(again, { x: again.x + 50, y: again.y });
    expect((await mock.plan()).plants[0].x).toBeGreaterThan(40);
  });

  test('a failed removal keeps the plant selected and shows no undo', async ({ page, garden, mock }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'kale', x: 40, y: 24 }]));
    await mock.enable();
    await page.goto('/');
    await mock.failNext([{ code: 'unknown_id', path: '/commands/0/id', message: 'There is no plant with id "a".' }]);
    const at = await garden.plantPoint('a');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('Delete');
    await expect(page.getByText('There is no plant with id "a".')).toBeVisible();
    await expect(page.getByText('Removed Kale')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible(); // card still open
  });

  test('warnings shown are the ones the API reports, not ones the client works out itself', async ({ page, garden, mock }) => {
    // Far apart: nothing here is really too close.
    await garden.seed(gardenWith([{ id: 'a', cropId: 'tomato', x: 10, y: 24 }, { id: 'b', cropId: 'tomato', x: 80, y: 24 }]));
    await mock.enable();
    await page.goto('/');
    const a = await garden.plantPoint('a');
    await page.mouse.click(a.x, a.y);
    await expect(page.getByText('too close to a neighbor')).toHaveCount(0);

    await mock.setWarnings([warning({ subjects: ['a', 'b'] })]);
    await expect(page.getByText('too close to a neighbor')).toBeVisible();

    await mock.setWarnings([warning({ subjects: ['a', 'b'], dismissed: true })]);
    await expect(page.getByText('too close to a neighbor')).toHaveCount(0); // dismissed ones aren't flagged

    await mock.setWarnings(null);
    await expect(page.getByText('too close to a neighbor')).toHaveCount(0);
  });

  test('shade and companion warnings from the API are shown in the card with their own wording, and dismissing sends their ids', async ({ page, garden, mock }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'basil', x: 10, y: 24 }, { id: 'b', cropId: 'tomato', x: 80, y: 24 }]));
    await mock.enable();
    await page.goto('/');
    await mock.setWarnings([
      warning({ id: 'shade:b>a', kind: 'shade', subjects: ['b', 'a'], message: 'Made-up shade message.', suggestion: 'Made-up fix.' }),
      warning({ id: 'companion:a::b', kind: 'companion', subjects: ['a', 'b'], message: 'Made-up companion message.' }),
    ]);
    const a = await garden.plantPoint('a');
    await page.mouse.click(a.x, a.y);
    await expect(page.getByText('! In shade from a neighbor')).toBeVisible();
    await expect(page.getByText('Made-up shade message. Made-up fix.')).toBeVisible();
    await expect(page.getByText('! Usually kept apart')).toBeVisible();
    await expect(page.getByText('Made-up companion message.')).toBeVisible();
    await expect(page.getByText('too close to a neighbor')).toHaveCount(0); // no spacing warning was reported

    await page.getByRole('button', { name: 'Dismiss this warning' }).click();
    expect(await mock.commands()).toEqual([
      { type: 'dismissWarning', id: 'shade:b>a' },
      { type: 'dismissWarning', id: 'companion:a::b' },
    ]);
  });

  test('dismissing asks the API to dismiss each live warning on that patch, and only those', async ({ page, garden, mock }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'tomato', x: 10, y: 24 }, { id: 'b', cropId: 'tomato', x: 50, y: 24 }, { id: 'c', cropId: 'tomato', x: 80, y: 24 }]));
    await mock.enable();
    await page.goto('/');
    await mock.setWarnings([
      warning({ id: 'spacing:a::b', subjects: ['a', 'b'] }),
      warning({ id: 'spacing:a::c', subjects: ['a', 'c'] }),
      warning({ id: 'spacing:b::c', subjects: ['b', 'c'] }),
      warning({ id: 'spacing:a::z', subjects: ['a', 'z'], dismissed: true }),
    ]);
    const a = await garden.plantPoint('a');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('button', { name: 'Dismiss this warning' }).click();
    expect(await mock.commands()).toEqual([
      { type: 'dismissWarning', id: 'spacing:a::b' },
      { type: 'dismissWarning', id: 'spacing:a::c' },
    ]);
  });

  test('changes made behind the client\'s back show up without a reload', async ({ page, garden, mock }) => {
    await garden.seed(gardenWith([{ id: 'a', cropId: 'kale', x: 20, y: 24 }]));
    await mock.enable();
    await page.goto('/');
    await expect(page.locator('[data-plant-id]')).toHaveCount(1);

    const elsewhere = gardenWith([{ id: 'x', cropId: 'basil', x: 10, y: 10 }, { id: 'y', cropId: 'basil', x: 60, y: 30 }, { id: 'z', cropId: 'kale', x: 90, y: 40 }]);
    await mock.replacePlan({ ...elsewhere, name: 'Edited elsewhere' });
    await expect(page.locator('[data-plant-id]')).toHaveCount(3);
    await expect(page.getByRole('button', { name: /Edited elsewhere/ })).toBeVisible();
  });

  test('first-run setup sends the profile and the garden name', async ({ page, mock }) => {
    await mock.enable();
    await page.goto('/');
    await page.getByRole('button', { name: 'Zone 8' }).click();
    await page.getByRole('button', { name: /^Part shade/ }).click();
    await page.getByRole('button', { name: 'Continue to your garden' }).click();
    await expect(page.getByRole('button', { name: 'Edit layout' })).toBeVisible();

    const commands = await mock.commands();
    expect(commands.map((c) => c.type)).toEqual(['setProfile', 'setGardenName']);
    expect(commands[0]).toMatchObject({ profile: { zoneId: '8', sunExposure: 'part-shade', onboarded: true } });
  });

  test.describe('layout editor', () => {
    const insideBed = async (page: import('@playwright/test').Page) => {
      const box = (await page.getByTestId('layout-editor').boundingBox())!;
      return { x: box.x + box.width / 3, y: box.y + box.height / 2 };
    };

    test('moving, resizing and undoing a bed each send one command', async ({ page, garden, mock }) => {
      await garden.seed(gardenWith([{ id: 'a', cropId: 'kale', x: 20, y: 24 }]));
      await mock.enable();
      await page.goto('/');
      await page.getByRole('button', { name: 'Edit layout' }).click();
      const before = (await mock.plan()).beds;

      const from = await insideBed(page);
      await garden.drag(from, { x: from.x + 90, y: from.y + 60 });
      await page.getByRole('button', { name: 'Grow width' }).click();
      await page.getByRole('button', { name: /^Undo/ }).click();

      const commands = await mock.commands();
      expect(commands.map((c) => c.type)).toEqual(['moveBed', 'reshapeBed', 'restoreLayout']);
      expect(commands[0]).toMatchObject({ id: 'bed-1' });
      expect((commands[0] as { dx: number }).dx).toBeGreaterThan(0);
      expect(commands[1]).toMatchObject({ type: 'reshapeBed', id: 'bed-1', heightIn: 48 });
      expect((commands[1] as { widthIn: number }).widthIn).toBe(102);
      // Undo sends the layout as it was before the resize (so after the move), not the original.
      const restore = commands[2] as { beds: { id: string; cx: number; widthIn: number }[] };
      expect(restore.beds[0]).toMatchObject({ id: 'bed-1', widthIn: 96 });
      expect(restore.beds[0].cx).toBeGreaterThan(before[0].cx);
    });

    test('adding a bed with the rectangle tool sends addBed with the editor\'s id and name', async ({ page, garden, mock }) => {
      await garden.seed(gardenWith());
      await mock.enable();
      await page.goto('/');
      await page.getByRole('button', { name: 'Edit layout' }).click();
      await page.getByRole('button', { name: /^Rectangle bed/ }).click();
      const box = (await page.getByTestId('layout-editor').boundingBox())!;
      await garden.drag({ x: box.x + box.width * 0.75, y: box.y + box.height * 0.2 }, { x: box.x + box.width * 0.9, y: box.y + box.height * 0.5 });

      const [command] = await mock.commands();
      expect(command).toMatchObject({ type: 'addBed', shape: 'rect', name: 'Bed 2', rotationDeg: 0 });
      expect((command as { id: string }).id).toBeTruthy();
      expect((await mock.plan()).beds).toHaveLength(2);
    });
  });
});
