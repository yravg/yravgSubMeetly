// Overlay must never hang off the viewport edge, whatever the stored position.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampOverlayPos, fitSizeToViewport, overlayRect } from '../src/lib/overlay-geometry.js';

const vp = { vw: 1280, vh: 720, w: 720, h: 280, margin: 8 };
const inside = (r, { vw, vh }) => r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;

test('extreme positions are pulled back so the whole panel is visible', () => {
  for (const pos of [{ xPct: 0, yPct: 0 }, { xPct: 100, yPct: 100 }, { xPct: 5, yPct: 90 }, { xPct: -50, yPct: 500 }]) {
    const p = clampOverlayPos(pos, vp);
    assert.ok(inside(overlayRect(p, vp), vp), `pos ${JSON.stringify(pos)} → ${JSON.stringify(p)}`);
  }
});

test('an in-range position is left untouched', () => {
  const p = clampOverlayPos({ xPct: 50, yPct: 8 }, vp);
  assert.deepEqual(p, { xPct: 50, yPct: 8 });
});

test('panel shrinks to fit a viewport smaller than the panel', () => {
  const small = { vw: 400, vh: 300 };
  const size = fitSizeToViewport({ w: 720, h: 280 }, { ...small, min: { w: 280, h: 140 } });
  assert.deepEqual(size, { w: 384, h: 280 });
  const p = clampOverlayPos({ xPct: 50, yPct: 8 }, { ...small, ...size });
  assert.ok(inside(overlayRect(p, { ...small, ...size }), small));
});

test('a viewport narrower than the minimum size centres the panel instead of failing', () => {
  const tiny = { vw: 200, vh: 120, w: 280, h: 140 };
  const p = clampOverlayPos({ xPct: 90, yPct: 90 }, tiny);
  assert.equal(p.xPct, 50);
  assert.ok(p.yPct >= 0);
});
