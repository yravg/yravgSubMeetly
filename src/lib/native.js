// Client for the local native helper server (native/server.py). Everything
// stays on the machine — the extension just talks to 127.0.0.1.
import { DEFAULT_NATIVE_URL } from './registry.js';

function base(url) {
  return (url || DEFAULT_NATIVE_URL).replace(/\/+$/, '');
}

export async function nativeHealth(url, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/health`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// audio: Float32Array @16 kHz → {text}
export async function nativeTranscribe(url, audio, { language = 'auto', task = 'transcribe' } = {}) {
  const q = new URLSearchParams({ language, task });
  const r = await fetch(`${base(url)}/transcribe?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
  });
  if (!r.ok) throw new Error(`native /transcribe ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.text || '').trim();
}

// Whole media file (any format ffmpeg can read) → [{t0, t1, text}]
// Accepts ArrayBuffer or File/Blob — blobs stream without a 2 GiB JS buffer limit.
export async function nativeTranscribeFile(
  url,
  data,
  filename,
  { language = 'auto', task = 'transcribe' } = {},
  onProgress,
) {
  const q = new URLSearchParams({ language, task, filename });
  const body =
    data instanceof ArrayBuffer
      ? data
      : data instanceof Uint8Array
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : data;
  onProgress?.(1);
  const r = await fetch(`${base(url)}/transcribe_file?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });
  if (!r.ok) throw new Error(`native /transcribe_file ${r.status}: ${await r.text()}`);
  const j = await r.json();
  onProgress?.(100);
  return (j.segments || []).map((s) => ({
    t0: s.start ?? 0,
    t1: s.end ?? 0,
    text: (s.text || '').trim(),
  }));
}

// Live draft: fast partial ASR + fast translate in one round trip (~0.3–0.5 s).
export async function nativeDraft(url, audio, src, tgt, { language = 'auto' } = {}) {
  const q = new URLSearchParams({ src, tgt, language });
  const r = await fetch(`${base(url)}/draft?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
  });
  if (r.status === 501) return null;
  if (!r.ok) throw new Error(`native /draft ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return {
    source: (j.source || '').trim(),
    translation: (j.translation || '').trim(),
  };
}

// Optional text translation via the helper (LLM). Returns null when the
// server has no translation model installed so callers can fall back.
export async function nativeTranslate(url, text, src, tgt, { fast = false } = {}) {
  const q = new URLSearchParams({ src, tgt });
  if (fast) q.set('fast', '1');
  const r = await fetch(`${base(url)}/translate?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: text,
  });
  if (r.status === 501) return null;
  if (!r.ok) throw new Error(`native /translate ${r.status}`);
  const j = await r.json();
  return (j.text || '').trim();
}

// Semantic refinement: complete source + draft shown while still speaking.
export async function nativeTranslateRefine(url, text, draft, src, tgt) {
  const q = new URLSearchParams({ src, tgt });
  const r = await fetch(`${base(url)}/translate_refine?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text, draft: draft || '' }),
  });
  if (r.status === 501) return null;
  if (!r.ok) throw new Error(`native /translate_refine ${r.status}`);
  const j = await r.json();
  return (j.text || '').trim();
}

// Gracefully stop the helper server.
export async function nativeShutdown(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/shutdown`, { method: 'POST', signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
