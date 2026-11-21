import type { Page } from '@playwright/test';
import { expect, gardenWith, test } from './fixtures';

// The crops card: counts, the ask-for-more/fewer/exact controls, and the suggestion preview.
// The suggestions here come from a placeholder, so these tests check the interface, not the layouts.

/** A garden with two beds: tomatoes (3) and basil (2) in the first, lettuce (3) in the second. */
function twoBeds() {
  const g = gardenWith([
    { id: 't1', cropId: 'tomato', x: 12, y: 12, groupId: 'T' },
    { id: 't2', cropId: 'tomato', x: 36, y: 12, groupId: 'T' },
    { id: 't3', cropId: 'tomato', x: 60, y: 12, groupId: 'T' },
    { id: 'b1', cropId: 'basil', x: 12, y: 36, groupId: 'B' },
    { id: 'b2', cropId: 'basil', x: 24, y: 36, groupId: 'B' },
    { id: 'l1', cropId: 'lettuce', bedId: 'bed-2', x: 10, y: 10, groupId: 'L' },
    { id: 'l2', cropId: 'lettuce', bedId: 'bed-2', x: 20, y: 10, groupId: 'L' },
    { id: 'l3', cropId: 'lettuce', bedId: 'bed-2', x: 30, y: 10, groupId: 'L' },
  ]);
  g.beds.push({ id: 'bed-2', name: 'Bed 2', shape: 'rect', cx: 48, cy: 110, widthIn: 96, heightIn: 48, rotationDeg: 0 });
  return g;
}

const card = (page: Page) => page.getByRole('complementary', { name: 'Crops' });
const row = (page: Page, cropId: string) => card(page).locator(`[data-crop-row="${cropId}"]`);
const count = (page: Page, cropId: string) => page.evaluate(async (id) => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('garden-planner-plan:'))!;
  return (JSON.parse(localStorage.getItem(key)!).plants as { cropId: string }[]).filter((p) => p.cropId === id).length;
}, cropId);

test.describe('the crops card', () => {
  test('is open with nothing selected, and lists the garden’s crops with their counts', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await expect(card(page).getByRole('heading', { name: 'Garden' })).toBeVisible();
    await expect(card(page)).toContainText('2 beds · 8 plants');
    // Most first, then by name.
    await expect(card(page).locator('[data-crop-row]')).toHaveCount(3);
    expect(await card(page).locator('[data-crop-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-crop-row')))).toEqual(['lettuce', 'tomato', 'basil']);
    await expect(row(page, 'tomato')).toContainText('3');
    await expect(card(page).getByRole('button', { name: /^Suggest/ })).toHaveCount(0);
  });

  test('a plant selection takes the card’s place, and deselecting brings the card back', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    const at = await garden.plantPoint('t1');
    await page.mouse.click(at.x, at.y);
    await expect(page.getByRole('complementary', { name: 'Selection' })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(card(page)).toBeVisible();
  });

  test('the arrows ask for more or fewer without changing the count, and the other arrow takes it back', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await row(page, 'tomato').hover();
    await page.getByRole('button', { name: 'More Tomato' }).click();
    await expect(row(page, 'tomato')).toHaveAttribute('data-request', 'more');
    await expect(page.getByRole('button', { name: 'More Tomato' })).toHaveAttribute('aria-pressed', 'true');
    await expect(row(page, 'tomato').getByLabel('Tomato count')).toHaveValue('3');
    await expect(card(page).getByRole('button', { name: 'Suggest for the garden · 1 change' })).toBeVisible();

    await page.getByRole('button', { name: 'Fewer Tomato' }).click();
    await expect(row(page, 'tomato')).not.toHaveAttribute('data-request', /.+/);
    await expect(card(page).getByRole('button', { name: /^Suggest/ })).toHaveCount(0);
  });

  test('typing a number sets an exact target; the arrows then step it, and a cross takes the request away', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await row(page, 'tomato').hover();
    const input = row(page, 'tomato').getByLabel('Tomato count');
    await input.fill('6');
    await input.press('Enter');
    await expect(row(page, 'tomato')).toHaveAttribute('data-request', 'exact');
    await expect(row(page, 'tomato').getByLabel('Tomato target')).toHaveValue('6');
    await expect(row(page, 'tomato')).toContainText('3 →');

    await page.getByRole('button', { name: 'More Tomato' }).click();
    await expect(row(page, 'tomato').getByLabel('Tomato target')).toHaveValue('7');
    await row(page, 'tomato').getByRole('button', { name: 'Clear request for Tomato' }).click();
    await expect(row(page, 'tomato')).not.toHaveAttribute('data-request', /.+/);
  });

  test('Reset clears every request', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    for (const id of ['tomato', 'basil']) {
      await row(page, id).hover();
      await page.getByRole('button', { name: `More ${id[0].toUpperCase()}${id.slice(1)}` }).click();
    }
    await expect(card(page).getByRole('button', { name: /2 changes/ })).toBeVisible();
    await card(page).getByRole('button', { name: 'Reset' }).click();
    await expect(card(page).getByRole('button', { name: /^Suggest/ })).toHaveCount(0);
  });

  test('+ Add a crop adds a new row that already asks for more, and its cross removes the row', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await card(page).getByRole('button', { name: 'Add a crop' }).click();
    await card(page).getByLabel('Search crops to add').fill('mari');
    await card(page).getByRole('option', { name: 'Marigold' }).getByRole('button').click();
    await expect(row(page, 'marigold')).toContainText('new');
    await expect(row(page, 'marigold')).toHaveAttribute('data-request', 'more');
    await expect(card(page).getByRole('button', { name: 'Suggest for the garden · 1 change' })).toBeVisible();
    await row(page, 'marigold').getByRole('button', { name: 'Remove Marigold from the request' }).click();
    await expect(row(page, 'marigold')).toHaveCount(0);
  });

  test('clicking soil in a bed scopes the card to it; Esc goes back to the garden', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    const soil = await garden.bedPoint('bed-2', 80, 40);
    await page.mouse.click(soil.x, soil.y);
    await expect(card(page).getByRole('heading', { name: 'Bed 2' })).toBeVisible();
    await expect(card(page)).toContainText('3 plants');
    await expect(card(page).locator('[data-crop-row]')).toHaveCount(1);
    await expect(row(page, 'lettuce')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card(page).getByRole('heading', { name: 'Garden' })).toBeVisible();
    await expect(card(page).locator('[data-crop-row]')).toHaveCount(3);
  });

  test('requests are kept per scope while moving between a bed and the garden', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await row(page, 'tomato').hover();
    await page.getByRole('button', { name: 'More Tomato' }).click();
    const soil = await garden.bedPoint('bed-2', 80, 40);
    await page.mouse.click(soil.x, soil.y);
    await expect(card(page).getByRole('button', { name: /^Suggest/ })).toHaveCount(0);
    await card(page).getByRole('button', { name: 'Back to the garden' }).click();
    await expect(row(page, 'tomato')).toHaveAttribute('data-request', 'more');
  });
});

test.describe('a suggestion', () => {
  async function ask(page: Page, cropId: string, name: string, target: string) {
    await row(page, cropId).hover();
    const input = row(page, cropId).getByLabel(`${name} count`);
    await input.fill(target);
    await input.press('Enter');
    await card(page).getByRole('button', { name: /^Suggest/ }).click();
  }

  test('is drawn on the garden with a diff card, and nothing is saved until Apply; Apply is one Undo', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await ask(page, 'tomato', 'Tomato', '5');

    const sug = page.getByRole('complementary', { name: 'Suggestion' });
    await expect(sug).toContainText('Suggested · not applied yet');
    await expect(sug.locator('[data-suggestion-row="tomato"]')).toContainText('3 → 5');
    await expect(page.locator('[data-suggested-add="tomato"]')).toHaveCount(2);
    expect(await count(page, 'tomato')).toBe(3);

    await sug.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('[data-suggested-add]')).toHaveCount(0);
    expect(await count(page, 'tomato')).toBe(5);
    await expect(page.getByText('Applied: +2 tomato')).toBeVisible();
    await expect(card(page).getByRole('button', { name: /^Suggest/ })).toHaveCount(0); // the applied request is cleared

    await page.keyboard.press('Control+z');
    expect(await count(page, 'tomato')).toBe(3);
  });

  test('shows removals faded, and a shortfall in words', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await ask(page, 'basil', 'Basil', '0');
    await expect(page.locator('[data-suggested-removal]')).toHaveCount(2);
    await expect(page.getByRole('complementary', { name: 'Suggestion' }).locator('[data-suggestion-row="basil"]')).toContainText('2 → 0');
  });

  test('Esc discards it and the request is still there to change', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await ask(page, 'tomato', 'Tomato', '5');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Suggestion' })).toHaveCount(0);
    await expect(page.locator('[data-suggested-add]')).toHaveCount(0);
    await expect(row(page, 'tomato')).toHaveAttribute('data-request', 'exact');
    expect(await count(page, 'tomato')).toBe(3);
  });

  test('Try again makes another arrangement of the same request', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await ask(page, 'tomato', 'Tomato', '5');
    const spots = () => page.locator('[data-suggested-add="tomato"]').evaluateAll((els) => els.map((e) => e.getAttribute('transform')));
    const first = await spots();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('complementary', { name: 'Suggestion' }).locator('[data-suggestion-row="tomato"]')).toContainText('3 → 5');
    expect(await spots()).not.toEqual(first);
  });

  test('is read-only while it is showing: Delete does nothing, and a drag on a plant only pans', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await ask(page, 'tomato', 'Tomato', '5');
    const at = await garden.plantPoint('t1');
    await garden.drag(at, { x: at.x + 40, y: at.y + 30 });
    await page.keyboard.press('Delete');
    expect(await count(page, 'tomato')).toBe(3);
    const plants = (await garden.plan()).plants.filter((p) => p.cropId === 'tomato');
    expect(plants.find((p) => p.id === 't1')).toMatchObject({ x: 12, y: 12 });
  });

  test('is dropped if the garden changes under it', async ({ page, garden, mock }) => {
    await mock.enable();
    await garden.seed(twoBeds());
    await page.goto('/');
    await ask(page, 'basil', 'Basil', '0');
    await expect(page.getByRole('complementary', { name: 'Suggestion' })).toBeVisible();
    // Someone else's edit arrives: the suggestion was made from plants that are gone.
    const changed = twoBeds();
    changed.plants.push({ id: 'extra', bedId: 'bed-1', cropId: 'kale', x: 80, y: 12, groupId: 'K' });
    await mock.replacePlan(changed);
    await expect(page.getByRole('complementary', { name: 'Suggestion' })).toHaveCount(0);
    await expect(card(page)).toBeVisible();
  });

  test('scoped to a bed, only that bed gets the plants', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    const soil = await garden.bedPoint('bed-2', 80, 40);
    await page.mouse.click(soil.x, soil.y);
    await ask(page, 'lettuce', 'Lettuce', '8');
    await expect(page.locator('[data-suggested-add="lettuce"]')).toHaveCount(5);
    await page.getByRole('complementary', { name: 'Suggestion' }).getByRole('button', { name: 'Apply' }).click();
    const plants = (await garden.plan()).plants.filter((p) => p.cropId === 'lettuce');
    expect(plants).toHaveLength(8);
    expect(plants.every((p) => p.bedId === 'bed-2')).toBe(true);
  });

  test('a new crop is planted as asked and counted', async ({ page, garden }) => {
    await garden.seed(twoBeds());
    await page.goto('/');
    await card(page).getByRole('button', { name: 'Add a crop' }).click();
    await card(page).getByLabel('Search crops to add').fill('mari');
    await card(page).getByRole('option', { name: 'Marigold' }).getByRole('button').click();
    await card(page).getByRole('button', { name: /^Suggest/ }).click();
    const sug = page.getByRole('complementary', { name: 'Suggestion' });
    await expect(sug.locator('[data-suggestion-row="marigold"]')).toContainText('0 → 6');
    await sug.getByRole('button', { name: 'Apply' }).click();
    expect(await count(page, 'marigold')).toBe(6);
  });
});
