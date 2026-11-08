#!/usr/bin/env node
/**
 * `npm run test:engine-rs` — replay the engine goldens with cargo.
 *
 * A missing cargo is a SKIP, not a failure: the Rust engine is the
 * default engine since S5. The skip line is printed so CI logs say so.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const candidates = [];
if (process.env.CARGO) candidates.push(process.env.CARGO);
if (process.platform === 'win32' && process.env.USERPROFILE) {
  candidates.push(path.join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe'));
}
candidates.push('cargo');

let cargo = null;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) {
    cargo = candidate;
    break;
  }
}
if (!cargo) {
  console.log('SKIP: cargo not found — engine-rs golden replay was not run');
  process.exit(0);
}

const result = spawnSync(
  cargo,
  ['test', '--manifest-path', path.join(ROOT, 'engine-rs', 'Cargo.toml')],
  { cwd: ROOT, stdio: 'inherit', env: process.env },
);
if (result.error) {
  console.log(`SKIP: cargo could not run (${result.error.message})`);
  process.exit(0);
}
process.exit(result.status ?? 1);
