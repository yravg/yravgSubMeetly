/**
 * TIDE-023 (A04c): src/lib/minutes-window.js dengan chrome palsu.
 *   node --test test/minutes-window.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openMinutesWindow, trackMinutesWindow, isMinutesWindowOpen, cleanBounds,
  WIN_ID_KEY, WIN_BOUNDS_KEY, DEFAULT_BOUNDS,
} from '../src/lib/minutes-window.js';

function fakeChrome() {
  const store = {};
  const wins = new Map();
  const listeners = { bounds: [], removed: [] };
  let next = 100;
  const calls = [];
  return {
    store, wins, calls,
    fire: {
      bounds: (w) => Promise.all(listeners.bounds.map((f) => f(w))),
      removed: (id) => { wins.delete(id); return Promise.all(listeners.removed.map((f) => f(id))); },
    },
    storage: { local: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (o) => { Object.assign(store, o); },
      remove: async (k) => { delete store[k]; },
    } },
    windows: {
      create: async (o) => { calls.push(['create', o]); const id = next++; wins.set(id, o); return { id }; },
      get: async (id) => { if (!wins.has(id)) throw new Error('No window with id'); return { id }; },
      update: async (id, o) => { calls.push(['update', id, o]); return { id }; },
      onBoundsChanged: { addListener: (f) => listeners.bounds.push(f) },
      onRemoved: { addListener: (f) => listeners.removed.push(f) },
    },
  };
}

test('klik pertama membuat popup dengan ukuran bawaan dan mencatat id', async () => {
  const c = fakeChrome();
  assert.equal(await openMinutesWindow(c, 'minutes.html'), 'created');
  const [kind, o] = c.calls[0];
  assert.equal(kind, 'create');
  assert.equal(o.type, 'popup');
  assert.equal(o.url, 'minutes.html');
  assert.equal(o.width, DEFAULT_BOUNDS.width);
  assert.equal(o.height, DEFAULT_BOUNDS.height);
  assert.equal(c.store[WIN_ID_KEY], 100);
  assert.equal(await isMinutesWindowOpen(c), true);
});

test('klik kedua memfokuskan jendela yang terbuka, tidak membuka yang baru', async () => {
  const c = fakeChrome();
  await openMinutesWindow(c, 'minutes.html');
  assert.equal(await openMinutesWindow(c, 'minutes.html'), 'focused');
  assert.equal(c.calls.filter(([k]) => k === 'create').length, 1);
  assert.deepEqual(c.calls[1], ['update', 100, { focused: true }]);
});

test('ukuran dan posisi diingat setelah ditutup, lalu dipakai lagi', async () => {
  const c = fakeChrome();
  trackMinutesWindow(c);
  await openMinutesWindow(c, 'minutes.html');
  await c.fire.bounds({ id: 999, left: 1, top: 1, width: 900, height: 700 }); // jendela lain: diabaikan
  assert.equal(c.store[WIN_BOUNDS_KEY], undefined);
  await c.fire.bounds({ id: 100, left: 40.4, top: 60, width: 1100, height: 760 });
  assert.deepEqual(c.store[WIN_BOUNDS_KEY], { left: 40, top: 60, width: 1100, height: 760 });
  await c.fire.removed(100);
  assert.equal(c.store[WIN_ID_KEY], undefined);
  assert.equal(await isMinutesWindowOpen(c), false);
  assert.equal(await openMinutesWindow(c, 'minutes.html'), 'created');
  const o = c.calls.at(-1)[1];
  assert.deepEqual([o.left, o.top, o.width, o.height], [40, 60, 1100, 760]);
});

test('id basi (jendela ditutup saat background tidur) dibersihkan; popup baru dibuat', async () => {
  const c = fakeChrome();
  c.store[WIN_ID_KEY] = 42;
  assert.equal(await isMinutesWindowOpen(c), false);
  assert.equal(c.store[WIN_ID_KEY], undefined);
  assert.equal(await openMinutesWindow(c, 'minutes.html'), 'created');
});

test('ukuran yang tidak masuk akal jatuh ke bawaan', () => {
  assert.deepEqual(cleanBounds(null), DEFAULT_BOUNDS);
  assert.deepEqual(cleanBounds({ width: 100, height: 50 }), DEFAULT_BOUNDS);
  assert.deepEqual(cleanBounds({ width: 'x', height: 700 }), DEFAULT_BOUNDS);
});

test('lab tanpa chrome.windows: window.open bernama sebagai popup', async () => {
  const opened = [];
  const win = { open: (...a) => opened.push(a) };
  assert.equal(await openMinutesWindow(undefined, '/src/minutes.html', win), 'tab');
  assert.equal(opened[0][0], '/src/minutes.html');
  assert.equal(opened[0][1], 'ysm-minutes');
  assert.match(opened[0][2], /popup/);
});
