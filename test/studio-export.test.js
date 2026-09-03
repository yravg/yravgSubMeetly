import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSrt, generateVtt, generateTxt, toCues } from './studio-export.js';
import {
  wrapLines,
  pickEngineMode,
  scoreDevice,
  simulateFallback,
  STUB_SEGMENTS,
} from './studio-lib.js';

test('wrapLines respects max character budget', () => {
  const lines = wrapLines('one two three four five six seven eight nine ten', 12);
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.ok(l.length <= 12, l);
});

test('toCues applies wrapLines to src and tgt', () => {
  const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
  const cues = toCues([{ t0: 0, t1: 2, src: long, tgt: long }]);
  assert.equal(cues.length, 1);
  assert.ok(cues[0].src.includes('\n') || cues[0].src.length <= 42);
});

test('generateSrt dual and single', () => {
  const dual = generateSrt(STUB_SEGMENTS, { dualLine: true });
  assert.match(dual, /Welcome/);
  assert.match(dual, /Selamat/);
  const single = generateSrt(STUB_SEGMENTS, { dualLine: false });
  assert.match(single, /00:00:00/);
  assert.match(single, /-->/);
});

test('generateVtt has WEBVTT header and dual support', () => {
  const out = generateVtt(STUB_SEGMENTS, { dualLine: true, title: 'Demo' });
  assert.match(out, /^WEBVTT/m);
  assert.match(out, /Welcome/);
  assert.match(out, /Selamat/);
});

test('generateTxt includes title and timestamps', () => {
  const out = generateTxt(STUB_SEGMENTS, { title: 'Demo', dualLine: true });
  assert.match(out, /Title: Demo/);
  assert.match(out, /\[/);
});

test('pickEngineMode uses device score', () => {
  assert.equal(pickEngineMode(scoreDevice({ webgpu: true, ramGb: 16 })).device, 'webgpu');
  assert.equal(pickEngineMode(scoreDevice({ webgpu: false, ramGb: 4, cores: 2 })).engine, 'native');
});

test('simulateFallback switches to native when primary fails', () => {
  const primary = pickEngineMode(90);
  const r = simulateFallback(primary, false);
  assert.equal(r.active.engine, 'native');
  assert.ok(r.reason);
  const ok = simulateFallback(primary, true);
  assert.equal(ok.active, primary);
  assert.equal(ok.fallback, null);
});
