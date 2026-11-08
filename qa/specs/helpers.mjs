import { readFileSync } from 'node:fs';

export const LAB = () => process.env.QA_LAB_URL;
export const ENGINE = () => process.env.QA_ENGINE_URL;

/** Open the lab shell (production side panel) and wait until the mock bridge and the panel are up. */
export async function openApp(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(`${LAB()}/app.html`);
  await page.waitForSelector('#app-mount .bottom-nav-item');
  await page.waitForFunction(() => typeof window.__mockEmit === 'function' && !!window.__labMock);
  return errors;
}

export const openView = async (page, view) => {
  await page.locator(`.bottom-nav-item[data-view="${view}"]`).click();
  await page.locator(`#view-${view}`).waitFor({ state: 'visible' });
};

/** Deliver a message to the panel the way the offscreen document does. */
export const emitPanel = (page, type, data) =>
  page.evaluate(([t, d]) => window.__mockEmit({ target: 'panel', type: t, data: d }), [type, data]);

/** Click something that triggers a blob download and return { name, text, bytes }. */
export async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const bytes = readFileSync(await dl.path());
  return { name: dl.suggestedFilename(), bytes, text: bytes.toString('utf8') };
}

/** Open the Minutes Register with clean storage and the sample register loaded. */
export async function openMinutesWithSample(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(`${LAB()}/dist/minutes.html`);
  await page.locator('#empty-state').waitFor({ state: 'visible' });
  await page.locator('#btn-load-sample').click();
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#chips .chip').length > 0);
  return errors;
}
