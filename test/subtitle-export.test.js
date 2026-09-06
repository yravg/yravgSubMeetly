// Subtitle export: long ASR segments must become readable cues, not a wall of text.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSrt, formatVtt, splitSubtitleCues } from '../src/lib/transcript-cache.js';

const WALL =
  'This is a very long transcription segment that would cover the entire video screen ' +
  'if exported as a single subtitle cue because speech recognition returns multi-sentence ' +
  'chunks that can last twenty or thirty seconds with hundreds of characters of continuous text ' +
  'and video players then lag while trying to render all of that at once on every frame.';

test('splitSubtitleCues breaks long ASR text into short readable cues', () => {
  const cues = splitSubtitleCues([{ t0: 0, t1: 30, src: WALL, tgt: WALL }]);
  assert.ok(cues.length >= 4, `expected several cues, got ${cues.length}`);
  for (const c of cues) {
    const text = c.tgt || c.src;
    assert.ok(text.length <= 90, `cue too long (${text.length}): ${text}`);
    assert.ok(c.t1 > c.t0, 'end must be after start');
  }
  assert.equal(cues[0].t0, 0);
  assert.ok(Math.abs(cues.at(-1).t1 - 30) < 0.05);
  for (let i = 1; i < cues.length; i++) {
    assert.ok(cues[i].t0 >= cues[i - 1].t1 - 0.001, 'cues must not overlap');
  }
});

test('formatSrt does not dump a paragraph into one cue', () => {
  const out = formatSrt([{ t0: 1, t1: 25, src: WALL, tgt: WALL }]);
  const blocks = out.trim().split(/\n\n+/);
  assert.ok(blocks.length >= 4, `expected multiple SRT cues, got ${blocks.length}`);
  for (const block of blocks) {
    const lines = block.split('\n');
    const text = lines.slice(2).join('\n');
    assert.ok(text.length <= 90, `SRT cue text too long: ${text.length}`);
  }
});

test('formatVtt keeps both source and translation — an export is an archive', () => {
  // Ekspor sengaja menyimpan keduanya: membuang teks asli itu lossy dan tidak
  // bisa dipulihkan. Kartu ekspor produksi mengandalkan ini
  // (test/export-browser.test.mjs), jadi tidak ada opsi untuk mematikannya.
  const both = formatVtt([{ t0: 0, t1: 4, src: 'Hello world', tgt: '你好世界' }]);
  assert.match(both, /你好世界/);
  assert.match(both, /Hello world/);
  assert.match(both, /Hello world\n你好世界/, 'sumber dulu, lalu terjemahan');

  const dual = formatVtt([{ t0: 0, t1: 4, src: 'Hello world', tgt: '你好世界' }], {
    dualLine: true,
  });
  assert.match(dual, /Hello world/);
  assert.match(dual, /你好世界/);
});
