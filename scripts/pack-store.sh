#!/usr/bin/env bash
# Build dist/ lalu bungkus ZIP Chrome Web Store (lihat scripts/pack-store.mjs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node esbuild.config.mjs
node scripts/pack-store.mjs
