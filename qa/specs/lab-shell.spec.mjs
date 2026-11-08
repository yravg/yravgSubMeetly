// Lab shell (app.html): production side panel on the lab mock. No network, no model.
import { expect, test } from '@playwright/test';
import { download, emitPanel, openApp, openView } from './helpers.mjs';

const FINAL = { source: 'Selamat pagi', translation: 'Good morning', t0: 1.25, t1: 3.5, final: true };

test('TC001 lab shell opens with the five side-panel cards and both views', async ({ page }) => {
  const errors = await openApp(page);
  await openView(page, 'captions');
  const cards = page.locator('#view-captions .card');
  await expect(cards).toHaveCount(5);
  for (const sel of ['#mode-toggle', '#rt-target', '#task-toggle', '#src-lang', '#tgt-lang', '#btn-start', '#status-line', '#live-src-lines', '#live-tgt-lines', '#off-lines', '#helper-export']) {
    await expect(page.locator(sel), sel).toBeAttached();
  }
  await openView(page, 'notes');
  await expect(page.locator('#view-captions')).toBeHidden();
  await openView(page, 'captions');
  await expect(page.locator('#view-notes')).toBeHidden();
  expect(errors).toEqual([]);
});

test('TC002 interim caption is replaced by the final line, with direction tags', async ({ page }) => {
  await openApp(page);
  await openView(page, 'captions');
  const tgt = page.locator('#live-tgt-lines');

  await emitPanel(page, 'pipeline-status', { state: 'listening', device: 'wasm' });
  await expect(page.locator('#status-line')).toContainText('wasm');

  await emitPanel(page, 'subtitle', { source: 'Sedang bicara…', translation: 'Speaking…', interim: true, partial: true });
  await expect(tgt).toContainText('Speaking…');

  await emitPanel(page, 'subtitle', { source: 'Selamat pagi', translation: 'Good morning', t0: 10, t1: 12, dir: { src: 'id', tgt: 'en' } });
  await expect(tgt).toContainText(/ID → EN.*Good morning/s);
  await emitPanel(page, 'subtitle', { source: 'Thank you', translation: 'Terima kasih', t0: 12, t1: 14, dir: { src: 'en', tgt: 'id' } });
  await expect(tgt).toContainText(/EN → ID.*Terima kasih/s);
  await expect(tgt).not.toContainText('Speaking…');
});

test('TC003 pipeline error shows a friendly card with the raw message as detail', async ({ page }) => {
  await openApp(page);
  await openView(page, 'captions');
  await emitPanel(page, 'error', { message: 'Fixture failure' });
  const box = page.locator('#error-box');
  await expect(box).toBeVisible();
  const title = (await page.locator('#error-title').textContent()).trim();
  expect(title.length).toBeGreaterThan(0);
  await expect(page.locator('#status-line')).toHaveText(title);
  await expect(page.locator('#error-detail')).toContainText('Fixture failure');
});

test('TC004 export captions as SRT, VTT and TXT', async ({ page }) => {
  await openApp(page);
  await openView(page, 'captions');
  const srtBtn = page.locator('#helper-export [data-export-kind="srt"]');
  await expect(srtBtn).toBeDisabled();
  await emitPanel(page, 'subtitle', FINAL);
  await expect(srtBtn).toBeEnabled();
  await expect(page.locator('#helper-export-name-hint')).toContainText(/\.zh-en\.srt$/);

  const srt = await download(page, () => srtBtn.click());
  expect(srt.name).toMatch(/\.zh-en\.srt$/);
  // Cue 1 is the deliberate 1 ms metadata cue (title/source); the caption is cue 2.
  expect(srt.text).toMatch(/2\r?\n00:00:01,250 --> 00:00:03,500\r?\nSelamat pagi\r?\nGood morning/);

  const vtt = await download(page, () => page.locator('#helper-export [data-export-kind="vtt"]').click());
  expect(vtt.name).toMatch(/\.vtt$/);
  // Windows adds BOM + CRLF by default. A blank line must separate the header (and NOTE lines)
  // from the first cue, or ffmpeg drops cues.
  const vttBody = vtt.text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  expect(vttBody).toMatch(/^WEBVTT\n(NOTE [^\n]*\n)*\n00:00:01\.250 --> 00:00:03\.500\nSelamat pagi\nGood morning/);

  const txt = await download(page, () => page.locator('#helper-export [data-export-kind="txt"]').click());
  expect(txt.name).toMatch(/\.txt$/);
  expect(txt.text).toContain('Selamat pagi');
  expect(txt.text).toContain('Good morning');
});

test('TC005 export options CRLF and BOM change the bytes and persist after reload', async ({ page }) => {
  await openApp(page);
  await openView(page, 'captions');
  await emitPanel(page, 'subtitle', FINAL);
  await expect(page.locator('#helper-export [data-export-kind="srt"]')).toBeEnabled();

  const box = (opt) => page.locator(`#helper-export [data-export-opt="${opt}"]`);
  // The OS default differs (BOM + CRLF on Windows), so remember it and force each option explicitly.
  const osDefault = { crlf: await box('crlf').isChecked(), bom: await box('bom').isChecked() };
  // The card re-renders on every toggle: wait for the stored value before the next click.
  const setOpt = async (opt, want) => {
    if ((await box(opt).isChecked()) === want) return;
    await box(opt).click({ force: true });
    await page.waitForFunction(([k, v]) => JSON.parse(localStorage.getItem('settings') || 'null')?.exportOptions?.[k] === v, [opt, want]);
  };
  const exportSrt = () => download(page, () => page.locator('#helper-export [data-export-kind="srt"]').click());

  await setOpt('crlf', false);
  await setOpt('bom', false);
  const plain = await exportSrt();
  expect([...plain.bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  expect(plain.text).not.toContain('\r\n');

  await setOpt('crlf', true);
  await setOpt('bom', true);
  const srt = await exportSrt();
  expect([...srt.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(srt.text).toContain('\r\n');

  await page.reload();
  await page.waitForSelector('#helper-export [data-export-opt="crlf"]');
  await expect(box('crlf')).toBeChecked();
  await expect(box('bom')).toBeChecked();

  await page.locator('#btn-export-os-default').click();
  await expect(box('crlf')).toBeChecked({ checked: osDefault.crlf });
  await expect(box('bom')).toBeChecked({ checked: osDefault.bom });
});

test('TC006 settings modal holds one centred card, fits a phone screen and closes', async ({ page }) => {
  await openApp(page);
  await page.locator('#btn-settings').click();
  const modal = page.locator('#settings-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator(':scope > *')).toHaveCount(1);
  const card = modal.locator('.modal-card');
  for (const id of ['engine-toggle', 'theme-toggle', 'ui-lang-toggle']) await expect(card.locator(`#${id}`), id).toBeAttached();

  const centred = async () =>
    card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, off: Math.abs(r.left + r.width / 2 - window.innerWidth / 2), w: window.innerWidth };
    });
  let b = await centred();
  expect(b.left).toBeGreaterThanOrEqual(0);
  expect(b.off).toBeLessThan(3);

  await page.setViewportSize({ width: 390, height: 800 });
  b = await centred();
  expect(b.left).toBeGreaterThanOrEqual(0);
  expect(b.right).toBeLessThanOrEqual(b.w + 1);

  await page.locator('#btn-close-settings').click();
  await expect(modal).toBeHidden();
});

test('TC007 notes view: load the sample meeting, then export TXT and Markdown', async ({ page }) => {
  await openApp(page);
  await openView(page, 'notes');
  await expect(page.locator('#btn-notes-txt')).toHaveCount(0);
  await page.locator('#btn-notes-sample').click();
  await expect(page.locator('#btn-notes-txt')).toBeVisible();
  await expect(page.locator('#notes-saved-list .notes-saved-item').first()).toBeVisible();

  const txt = await download(page, () => page.locator('#btn-notes-txt').click());
  expect(txt.name).toMatch(/\.txt$/);
  expect(txt.text.length).toBeGreaterThan(50);
  const md = await download(page, () => page.locator('#btn-notes-md').click());
  expect(md.name).toMatch(/\.md$/);
  expect(md.text).toMatch(/^#/m);
});

test('TC008 native helper card: fixture shows the engine, offline shows a warning', async ({ page }) => {
  await openApp(page);
  await page.locator('#btn-settings').click();
  await expect(page.locator('#native-block')).toBeHidden();

  await page.evaluate(() => (window.__labMock.helper.mode = 'fixture'));
  await page.locator('#engine-toggle').selectOption('native');
  await expect(page.locator('#native-block')).toBeVisible();
  await page.locator('#btn-native-check').click();
  await expect(page.locator('#native-status')).toContainText('faster-whisper');
  await expect(page.locator('#native-status')).toHaveClass(/\bon\b/);

  await page.evaluate(() => (window.__labMock.helper.mode = 'offline'));
  await page.locator('#btn-native-check').click();
  await expect(page.locator('#native-status')).toContainText(/not running/);
  await expect(page.locator('#native-status')).toHaveClass(/\boff\b/);
  await expect(page.locator('#model-warning')).toContainText(/not running/);

  await page.locator('#engine-toggle').selectOption('browser');
  await expect(page.locator('#native-block')).toBeHidden();
});
