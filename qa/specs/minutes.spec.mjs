// Minutes Register (dist/minutes.html). Each test gets a fresh browser context, so storage starts empty.
import { expect, test } from '@playwright/test';
import { download, LAB, openMinutesWithSample } from './helpers.mjs';

const rows = (page) => page.locator('#pane tbody tr, #pane .row, #pane [data-ref]');
const chipCount = async (page, type) => Number(await page.locator(`#chips .chip[data-type="${type}"] .ct`).textContent());

test('TC009 empty state, then load sample data opens the workspace', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(`${LAB()}/dist/minutes.html`);
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();
  await page.locator('#btn-load-sample').click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#empty-state')).toBeHidden();
  await expect(page.locator('#m-title')).not.toHaveText('—');
  await expect(page.locator('#m-date')).not.toHaveText('—');
  await expect(rows(page).first()).toBeVisible();
  expect(await page.locator('#m-switch option').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('TC010 add a decision and an action', async ({ page }) => {
  await openMinutesWithSample(page);
  const decisions = await chipCount(page, 'decision');
  const actions = await chipCount(page, 'action');

  const add = async (type, text, owner) => {
    await page.locator('#btn-add-item').click();
    await page.locator('#f-type').selectOption(type);
    await page.locator('#f-text').fill(text);
    if (owner) await page.locator('#f-owner').fill(owner);
    // The floating dock must not cover the Save button. Soft: report it, then go on so the add flow is still checked.
    const save = page.locator('#d-save');
    const covered = await save.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit && !el.contains(hit) ? `${hit.tagName}#${hit.id || hit.className}` : null;
    });
    expect.soft(covered, 'Add item (#d-save) is covered by another element').toBeNull();
    if (covered === null) await save.click();
    else await save.evaluate((el) => el.click());
    await expect(page.locator('#toast')).toHaveClass(/show/);
  };
  await add('decision', 'QA fixture decision: ship the lab build', null);
  await expect(page.locator('#pane')).toContainText('QA fixture decision: ship the lab build');
  await add('action', 'QA fixture action: rerun the suite', 'Dewi Fixture');
  await expect(page.locator('#pane')).toContainText('QA fixture action: rerun the suite');

  expect(await chipCount(page, 'decision')).toBe(decisions + 1);
  expect(await chipCount(page, 'action')).toBe(actions + 1);
});

test('TC011 type chips and search narrow the list', async ({ page }) => {
  await openMinutesWithSample(page);
  const all = await rows(page).count();
  expect(all).toBeGreaterThan(1);

  const chip = page.locator('#chips .chip[data-type="decision"]');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const onlyDecisions = await rows(page).count();
  expect(onlyDecisions).toBeGreaterThan(0);
  expect(onlyDecisions).toBeLessThan(all);
  expect(onlyDecisions).toBe(await chipCount(page, 'decision'));
  await chip.click();
  await expect(rows(page)).toHaveCount(all);

  // Board D01: the dock starts as an icon while the navigator is open; open it to reach search.
  await page.locator('#dock-mini').click();
  await page.locator('#btn-search-open').click();
  await expect(page.locator('#q')).toBeVisible();
  const firstWord = (await rows(page).first().locator('td').nth(3).innerText()).match(/[A-Za-z]{6,}/)?.[0];
  expect(firstWord, 'a searchable word in the Item cell of the first row').toBeTruthy();
  await page.locator('#q').fill(`${firstWord}zzzz`);
  await expect(rows(page)).toHaveCount(0);
  await page.locator('#q').fill(firstWord);
  expect(await rows(page).count()).toBeGreaterThan(0);
  await page.locator('#q').fill('');
  await expect(rows(page)).toHaveCount(all);
});

test('TC012 export Markdown, CSV and JSON', async ({ page }) => {
  await openMinutesWithSample(page);
  const exportAs = async (fmt) => {
    await page.locator('#btn-export').click();
    return download(page, () => page.locator(`#export-menu [data-export="${fmt}"]`).click());
  };
  const md = await exportAs('md');
  expect(md.name).toMatch(/\.md$/);
  expect(md.text).toMatch(/^#/m);

  const csv = await exportAs('csv');
  expect(csv.name).toMatch(/\.csv$/);
  expect(csv.text.trim().split(/\r?\n/).length).toBeGreaterThan(2);

  const json = await exportAs('json');
  expect(json.name).toMatch(/\.json$/);
  const meeting = JSON.parse(json.text);
  expect(Array.isArray(meeting.items)).toBe(true);
  expect(meeting.items.length).toBeGreaterThan(0);
  expect(json.name.replace(/\.json$/, '')).toBe(md.name.replace(/\.md$/, ''));
});

test('TC013 view dock minimises to an icon and opens again', async ({ page }) => {
  await openMinutesWithSample(page);
  const dock = page.locator('#viewdock');
  // Board D01: the dock starts minimised while the navigator is open.
  await expect(dock).toHaveClass(/\bmini\b/);
  await page.locator('#dock-mini').click();
  await expect(page.locator('#dock-full')).toBeVisible();
  await page.locator('#btn-dock-mini').click();
  await expect(dock).toHaveClass(/\bmini\b/);
  await expect(page.locator('#dock-mini')).toBeVisible();
  await page.locator('#dock-mini').click();
  await expect(dock).not.toHaveClass(/\bmini\b/);
  await expect(page.locator('#dock-full')).toBeVisible();
  await expect(page.locator('#tabs button[data-view]').first()).toBeVisible();
});
