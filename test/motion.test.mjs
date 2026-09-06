/**
 * The motion primitives must hold up outside a browser: the integrator has to
 * stay stable at the stiffest constant we ship, and the odometer's digit maths
 * has to be continuous across a carry or the columns visibly jump.
 *   node --test test/motion.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPRING,
  integrate,
  spring,
  digitPositions,
  integerDigits,
  prefersReducedMotion,
} from '../src/lib/motion.js';

/* ---------------------------------------------------------------- *
 * integrator
 * ---------------------------------------------------------------- */

test('every shipped spring settles on its target and stays there', () => {
  for (const [name, cfg] of Object.entries(SPRING)) {
    let state = { x: 0, v: 0 };
    for (let i = 0; i < 600; i++) state = integrate(state, 100, cfg, 1 / 60);
    assert.ok(
      Math.abs(state.x - 100) < 0.01,
      `${name} did not settle: x=${state.x}`,
    );
    assert.ok(Math.abs(state.v) < 0.01, `${name} still moving: v=${state.v}`);
  }
});

test('the stiffest spring does not gain energy on a stalled frame', () => {
  // A backgrounded tab hands the next frame a huge delta. Semi-implicit Euler
  // plus the MAX_FRAME clamp must absorb it instead of throwing the value out.
  let state = { x: 0, v: 0 };
  for (let i = 0; i < 40; i++) state = integrate(state, 100, SPRING.highlight, 5);
  assert.ok(Number.isFinite(state.x), 'diverged to a non-finite value');
  assert.ok(state.x > -50 && state.x < 200, `overshot wildly: ${state.x}`);
});

test('a spring never overshoots further than the distance it travelled', () => {
  // Underdamped is fine and wanted; a 2x overshoot would read as a glitch.
  let state = { x: 0, v: 0 };
  let peak = 0;
  for (let i = 0; i < 600; i++) {
    state = integrate(state, 100, SPRING.number, 1 / 60);
    peak = Math.max(peak, state.x);
  }
  assert.ok(peak < 150, `overshoot too large: peak=${peak}`);
});

test('integrate is pure — it does not mutate the state it is given', () => {
  const before = { x: 3, v: 7 };
  integrate(before, 100, SPRING.progress, 1 / 60);
  assert.deepEqual(before, { x: 3, v: 7 });
});

/* ---------------------------------------------------------------- *
 * spring()
 * ---------------------------------------------------------------- */

test('a zero-length move resolves synchronously without scheduling a frame', () => {
  const seen = [];
  let done = false;
  const cancel = spring(42, 42, SPRING.number, (v) => seen.push(v), () => {
    done = true;
  });
  assert.deepEqual(seen, [42]);
  assert.equal(done, true);
  cancel();
});

test('spring converges to exactly the target and calls onDone once', async () => {
  const values = [];
  let doneCount = 0;
  await new Promise((resolve) => {
    spring(0, 100, SPRING.number, (v) => values.push(v), () => {
      doneCount++;
      resolve();
    });
  });
  assert.equal(doneCount, 1);
  assert.equal(values.at(-1), 100, 'last emitted value must be the exact target');
  assert.ok(values.length > 3, 'expected several intermediate frames');
});

test('cancel stops further updates', async () => {
  let last = 0;
  const cancel = spring(0, 100, SPRING.progress, (v) => {
    last = v;
  });
  await new Promise((r) => setTimeout(r, 40));
  cancel();
  const atCancel = last;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(last, atCancel, 'updates continued after cancel');
  assert.ok(atCancel < 100, 'test is meaningless if it had already landed');
});

test('prefersReducedMotion is false outside a browser rather than throwing', () => {
  assert.equal(prefersReducedMotion(), false);
});

/* ---------------------------------------------------------------- *
 * odometer maths
 * ---------------------------------------------------------------- */

test('digit columns read the value they are meant to show', () => {
  // 565.4 across powers [2, 1, 0, -1]
  const [h, t, u, d] = digitPositions(565.4, [2, 1, 0, -1]);
  assert.ok(Math.abs(h - 5.654) < 1e-9);
  assert.ok(Math.abs(t - 6.54) < 1e-9);
  assert.ok(Math.abs(u - 5.4) < 1e-9);
  assert.ok(Math.abs(d - 4) < 1e-9);
});

test('a carry is continuous — the tens column is already moving at 9.99', () => {
  // If the tens column snapped on integer boundaries it would sit at exactly 0
  // here and jump a whole cell when the units column wrapped.
  const [tens] = digitPositions(9.99, [1]);
  assert.ok(tens > 0.99 && tens < 1.0, `tens column not mid-carry: ${tens}`);
});

test('the 9 -> 0 wrap lands on the repeated 0 cell, so the seam is invisible', () => {
  // The rendered column is 0..9 plus a repeated 0 at index 10. Approaching a
  // carry the position must climb toward 10 (that repeated 0), never jump back.
  const near = digitPositions(9.999, [0])[0];
  const after = digitPositions(10.001, [0])[0];
  assert.ok(near > 9.99, `expected to approach the repeat cell, got ${near}`);
  assert.ok(after < 0.01, `expected to resume at 0, got ${after}`);
});

test('positions always stay inside the rendered column', () => {
  for (const v of [0, 0.5, 7, 99.99, 565.4, 2700, 123456.789]) {
    for (const p of [-1, 0, 1, 2, 3]) {
      const pos = digitPositions(v, [p])[0];
      assert.ok(pos >= 0 && pos < 10, `value ${v} power ${p} -> ${pos}`);
    }
  }
});

test('negative values are clamped rather than translating the column upward', () => {
  assert.deepEqual(digitPositions(-5, [0]), [0]);
});

test('integerDigits sizes the column count for the model sizes we ship', () => {
  assert.equal(integerDigits(0), 1);
  assert.equal(integerDigits(9.9), 1);
  assert.equal(integerDigits(80), 2);      // Whisper Base
  assert.equal(integerDigits(565.4), 3);   // Large v3 Turbo
  assert.equal(integerDigits(2700), 4);    // Voxtral Mini 3B
});
