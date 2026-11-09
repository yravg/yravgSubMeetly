#!/usr/bin/env node
/**
 * ORACLE REMOVED IN S5 (ENG-004): the Python helper this script drove is gone.
 * The goldens in engine-rs/golden are frozen; this script cannot run any more
 * and is kept only as a record of how they were captured. No npm script calls it.
 *
 * Capture ASR goldens for the Rust engine from the Python oracle's engine.
 *
 *   node scripts/gen-engine-ml-golden.mjs            # writes engine-rs/golden/ml/whisper-base.json
 *   node scripts/gen-engine-ml-golden.mjs --python C:\py\python.exe
 *
 * Runs faster-whisper `base` exactly as native/server.py `asr_file` does in the
 * default "fast" engine mode (beam 1, CPU int8, language from the clip's
 * manifest entry), on five CC0 clips from test/samples. The helper's own
 * /transcribe_file route needs ffmpeg on PATH, so the same call is made
 * in-process instead of over HTTP.
 *
 * Models land in engine-rs/.hf-cache (HF_HOME), shared with the Rust test:
 *   cargo test --manifest-path engine-rs/Cargo.toml --test ml_golden -- --ignored --nocapture
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'engine-rs', 'golden', 'ml', 'whisper-base.json');
const argPython = process.argv.indexOf('--python');
const PYTHON =
  (argPython > -1 && process.argv[argPython + 1]) ||
  process.env.PYTHON ||
  (process.platform === 'win32' ? 'python' : 'python3');
const CLIPS = ['en-1', 'en-2', 'en-3', 'de-1', 'es-1'];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'samples', 'manifest.json'), 'utf8'));
const clips = CLIPS.map((id) => {
  const sample = manifest.samples.find((s) => s.id === id);
  if (!sample) throw new Error(`clip ${id} missing from test/samples/manifest.json`);
  return { id, file: `test/samples/${sample.file}`, language: sample.src, license: sample.license };
});

const PY = `
import json, sys, time
from faster_whisper import WhisperModel
clips = json.loads(sys.argv[1])
model = WhisperModel("base", device="cpu", compute_type="int8")
out = []
for clip in clips:
    t0 = time.time()
    segs, info = model.transcribe(clip["file"], language=clip["language"], task="transcribe", beam_size=1)
    segs = [{"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()} for s in segs if s.text.strip()]
    elapsed = time.time() - t0
    out.append({**clip, "duration": round(info.duration, 3), "elapsedSec": round(elapsed, 3),
                "rtf": round(elapsed / info.duration, 4), "segments": segs})
print(json.dumps(out, ensure_ascii=False))
`;

const env = {
  ...process.env,
  HF_HOME: process.env.HF_HOME || path.join(ROOT, 'engine-rs', '.hf-cache'),
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
};
const run = spawnSync(PYTHON, ['-c', PY, JSON.stringify(clips)], {
  cwd: ROOT,
  env,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (run.status !== 0) {
  console.error(run.stderr || run.error?.message);
  process.exit(1);
}
const results = JSON.parse(run.stdout.trim().split('\n').pop());
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      capturedFrom: 'faster-whisper base, CPU int8, beam 1 (native/server.py asr_file, fast mode)',
      model: 'base',
      clips: results,
    },
    null,
    2,
  )}\n`,
);
for (const r of results) {
  console.log(`${r.id.padEnd(6)} ${String(r.segments.length).padStart(2)} segments  ${r.duration}s  RTF ${r.rtf}`);
}
console.log(`wrote ${path.relative(ROOT, OUT)}`);
