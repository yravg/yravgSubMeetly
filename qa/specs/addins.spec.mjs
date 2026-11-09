// Add-ins (ADD-001): Recap email, Glossary, Due dates to calendar. Real mouse and keyboard on the lab shell (app.html), light theme.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { download, openApp, openView } from './helpers.mjs';

const SHOTS = path.resolve('qa', 'evidence', 'addins');
const SIZES = [[1440, 900], [1024, 768], [390, 844]];

/** Sample register loaded, the three add-ins trusted (real clicks), Notes view open on the newest meeting. */
async function setup(page) {
  await page.emulateMedia({ colorScheme: 'light' });
  const errors = await openApp(page);
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; }; // mailto and the register tab stay inside the page
  });
  await openView(page, 'notes');
  await page.locator('#btn-notes-sample').click();
  await page.locator('#btn-settings').click();
  await page.locator('#settings-tabs button[data-stab="addins"]').click();
  for (const name of ['Recap email', 'Glossary', 'Due dates to calendar']) {
    await page.locator('.ai-row', { hasText: name }).click();
    await expect(page.locator('.ai-mh h4')).toHaveText(name);
    await page.locator('[data-ai="trust"]').click();
    await expect(page.locator('.ai-pill-enabled')).toBeVisible();
  }
  await page.locator('#btn-close-settings').click();
  await expect(page.locator('[data-addins-strip]')).toBeVisible();
  return errors;
}

async function shots(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.locator('[data-addins-strip]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

test('TC020 Recap email: build the recap, open the mail draft, copy it, nothing is sent', async ({ page }) => {
  const errors = await setup(page);
  await page.locator('[data-addin="recap-email:recap"]').click();
  const card = page.locator('[data-ai-result="recap"]');
  await expect(card).toContainText(/To: \d+ attendees? with a known email/);
  await expect(card).toContainText('Nothing is sent');
  await expect(card).toContainText(/No email for: .*QA\/QC/);
  await card.locator('summary').click();
  await expect(card.locator('.ai-pre')).toContainText(/Decisions|Actions/);
  await shots(page, 'recap-email');
  await card.locator('[data-ai-act="recap-open"]').click();
  const opened = await page.evaluate(() => window.__opened.filter((u) => String(u).startsWith('mailto:')));
  expect(opened).toHaveLength(1);
  expect(decodeURIComponent(opened[0])).toContain('example.com');
  await card.locator('[data-ai-act="dismiss"]').click();
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('TC021 Glossary: needs input, add a term, import and export CSV, remove', async ({ page }) => {
  const errors = await setup(page);
  const panel = page.locator('[data-ai-panel="glossary"]');
  await expect(panel).toContainText('HLV'); // demo terms ship with the sample data
  await panel.locator('[data-ai-act="gl-add"]').click();
  await expect(panel.locator('.ai-note-error')).toContainText('Type the term first');
  await panel.locator('#gl-term').fill('Kubernetes');
  await panel.locator('#gl-heard').fill('cooper netties | kubernetties');
  await panel.locator('[data-ai-act="gl-add"]').click();
  await expect(panel.locator('.gl-list li', { hasText: 'Kubernetes' })).toContainText('cooper netties | kubernetties');
  await expect(panel.locator('.ai-note-error')).toHaveCount(0);
  await shots(page, 'glossary');

  const out = await download(page, () => panel.locator('[data-ai-act="gl-export"]').click());
  expect(out.name).toMatch(/^glossary-.*\.csv$/);
  expect(out.text).toMatch(/^﻿?term,heard_as,translation\r\n/);
  expect(out.text).toContain('Kubernetes,cooper netties|kubernetties,');

  await panel.locator('#gl-file').setInputFiles({ name: 'terms.csv', mimeType: 'text/csv', buffer: Buffer.from('term,heard_as,translation\r\n,x,y\r\nPTTEP,p t t e p,\r\n') });
  await expect(panel.locator('.ai-note')).toContainText('1 term imported');
  await expect(panel.locator('.ai-note')).toContainText('1 row skipped');
  await expect(panel.locator('.gl-list li', { hasText: 'PTTEP' })).toBeVisible();

  const before = await panel.locator('.gl-list li').count();
  await panel.locator('.gl-list li', { hasText: 'PTTEP' }).locator('[data-ai-act="gl-del"]').click();
  await expect(panel.locator('.gl-list li')).toHaveCount(before - 1);
  expect(errors).toEqual([]);
});

test('TC022 Due dates to calendar: one .ics of open actions with a due date', async ({ page }) => {
  const errors = await setup(page);
  const ics = await download(page, () => page.locator('[data-addin="due-to-calendar:ics"]').click());
  expect(ics.name).toMatch(/^actions-.*\.ics$/);
  expect(ics.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(ics.text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  const events = ics.text.split('BEGIN:VEVENT').length - 1;
  expect(events).toBeGreaterThan(0);
  expect(ics.text.split('END:VEVENT').length - 1).toBe(events);
  expect(ics.text).toMatch(/DTSTART;VALUE=DATE:\d{8}\r\n/);
  for (const line of ics.text.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  const card = page.locator('[data-ai-result="ics"]');
  await expect(card).toContainText(new RegExp(`${events} actions? saved to actions-`));
  await shots(page, 'due-to-calendar');
  expect(errors).toEqual([]);
});

test('TC023 Add-ins tab: how-to text for each new add-in; locked add-ins stay out of the Notes strip', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const errors = await openApp(page);
  await openView(page, 'notes');
  await page.locator('#btn-notes-sample').click();
  await expect(page.locator('[data-addins-strip]')).toHaveCount(0); // not trusted yet: nothing runs
  await page.locator('#btn-settings').click();
  await page.locator('#settings-tabs button[data-stab="addins"]').click();
  for (const [name, re] of [['Recap email', /Open mail draft/], ['Glossary', /Glossary/], ['Due dates to calendar', /\.ics file/]]) {
    await page.locator('.ai-row', { hasText: name }).click();
    await expect(page.locator('.ai-mh h4')).toHaveText(name);
    await expect(page.locator('.ai-pill-needs-trust')).toBeVisible();
    await expect(page.locator('.ai-how')).toContainText(re);
  }
  mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.screenshot({ path: path.join(SHOTS, `addins-tab-${w}.png`) });
  }
  expect(errors).toEqual([]);
});
