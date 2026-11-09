// Client for the local native helper server (native/server.py). Everything
// stays on the machine — the extension just talks to 127.0.0.1.
import { DEFAULT_NATIVE_URL } from './registry.js';
import { assertLocalUrl } from './native-protocol.js';

// The Rust engine downloads nothing by itself: a speech or translation model that is not on disk answers 409
// { code: 'model-not-downloaded', id }. The error carries that code so the panel can offer Download instead of a generic failure.
function refused(status, text, what) {
  const e = new Error(`native ${what} ${status}: ${text}`);
  if (status === 409) {
    try {
      const j = JSON.parse(text);
      if (j?.code === 'model-not-downloaded') {
        e.code = j.code;
        e.modelId = j.id || '';
        e.message = `model-not-downloaded ${e.modelId}`.trim();
      }
    } catch { /* not the engine's JSON: keep the plain message */ }
  }
  return e;
}

function base(url) {
  return assertLocalUrl(url || DEFAULT_NATIVE_URL);
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

// audio: Float32Array @16 kHz → trimmed text.
// `nativeTranscribeDetailed` additionally surfaces the helper's own language
// field when it sends one — today it only returns {text}, so it stays null.
export async function nativeTranscribeDetailed(
  url,
  audio,
  { language = 'auto', task = 'transcribe' } = {},
) {
  const q = new URLSearchParams({ language, task });
  const r = await fetch(`${base(url)}/transcribe?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
  });
  if (!r.ok) throw refused(r.status, await r.text(), '/transcribe');
  const j = await r.json();
  const lang = typeof j.language === 'string' ? j.language : typeof j.lang === 'string' ? j.lang : null;
  return { text: (j.text || '').trim(), language: lang || null };
}

export async function nativeTranscribe(url, audio, { language = 'auto', task = 'transcribe' } = {}) {
  const q = new URLSearchParams({ language, task });
  const r = await fetch(`${base(url)}/transcribe?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
  });
  if (!r.ok) throw refused(r.status, await r.text(), '/transcribe');
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
  if (!r.ok) throw refused(r.status, await r.text(), '/transcribe_file');
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
  if (!r.ok) throw refused(r.status, await r.text(), '/draft');
  const j = await r.json();
  return {
    source: (j.source || '').trim(),
    translation: (j.translation || '').trim(),
    translateState: typeof j.translateState === 'string' ? j.translateState : '', // off | missing | loading | ready (Rust engine)
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
  if (!r.ok) throw refused(r.status, await r.text(), '/translate');
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
  if (!r.ok) throw refused(r.status, await r.text(), '/translate_refine');
  const j = await r.json();
  return (j.text || '').trim();
}

// Installed language-model inventory + on-disk cache catalog (GET /models).
// Null when helper unreachable.
export async function nativeGetModels(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/models`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Start a background download of one catalog model. 202 = started, 200 = already there.
// Returns the parsed body, or { error } when refused or unreachable.
export async function nativePullModel(url, id, timeoutMs = 5000) {
  return postJson(`${base(url)}/models/pull`, { id }, timeoutMs);
}

// Put one model's files in another folder (dir) or back in the default (null). 200 remapped, 202 a move started
// (progress is on the model row); refusals come back as { error, code, needBytes?, freeBytes? }.
export async function nativeSetModelLocation(url, id, dir, timeoutMs = 8000) {
  return postJson(`${base(url)}/engine/models/location`, { id, dir }, timeoutMs);
}

// Choose the speech and/or translation model: { asr?: id, translate?: id | 'off' }.
export async function nativeSetModels(url, patch, timeoutMs = 5000) {
  return postJson(`${base(url)}/engine/models`, patch, timeoutMs);
}

async function postJson(u, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { ...j, error: j.error || `HTTP ${r.status}` };
  } catch (e) {
    return { error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Shared local UI prefs (theme + reskin) on the helper — same on-disk home
// as notes (~/.yraveragesubmin/ui-prefs.json). Null when helper unreachable.
export async function nativeGetUiPrefs(url, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/ui-prefs`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeSetUiPrefs(url, patch, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/ui-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(patch || {}),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Meeting-note documents on the helper (shared JSON store). Shapes follow
// the v1 helper schema — see _normalize_note_doc in native/server.py.
export async function nativeGetNotes(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/notes`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeGetNote(url, id, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/notes/${encodeURIComponent(id)}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeSaveNote(url, note, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ note }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeDeleteNote(url, id, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/notes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

// ---------------------------------------------------------------------------
// Large-file jobs (>1.5 GiB): POST /transcribe_file_job streams the media to
// the helper's disk and returns {jobId}; GET /jobs/:id reports
// {status: running|cancelling|cancelled|done|error, progress, segments, error};
// POST /jobs/:id/cancel asks the helper to stop. Upload progress comes from
// XMLHttpRequest (fetch has no upload events).

/** Normalise helper segments → [{t0, t1, text}]. */
function mapSegments(segs) {
  return (segs || []).map((s) => ({
    t0: s.start ?? 0,
    t1: s.end ?? 0,
    text: (s.text || '').trim(),
  }));
}

/** Upload a File/Blob/ArrayBuffer with progress; resolves {jobId}. */
export function nativeStartFileJob(
  url,
  data,
  filename,
  { language = 'auto', task = 'transcribe' } = {},
  onUpload,
  onXhr,
) {
  const q = new URLSearchParams({ language, task, filename });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onXhr?.(xhr);
    xhr.open('POST', `${base(url)}/transcribe_file_job?${q}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUpload?.(e.loaded, e.total);
    };
    xhr.onerror = () => reject(new Error('native /transcribe_file_job: network error'));
    xhr.onabort = () => reject(new Error('cancelled'));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(refused(xhr.status, xhr.responseText, '/transcribe_file_job'));
        return;
      }
      try {
        const j = JSON.parse(xhr.responseText || '{}');
        if (!j.jobId) throw new Error('no jobId');
        resolve({ jobId: j.jobId });
      } catch (e) {
        reject(new Error(`native /transcribe_file_job: bad response (${e.message})`));
      }
    };
    xhr.send(data);
  });
}

export async function nativeGetJob(url, jobId, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/jobs/${encodeURIComponent(jobId)}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`native /jobs/${jobId} ${r.status}`);
    return r.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeCancelJob(url, jobId, timeoutMs = 3000) {
  if (!jobId) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      signal: ctrl.signal,
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whole-file transcription as a helper job with real progress + cancel.
 *
 * onProgress receives { stage: 'upload'|'queued'|'transcribe', pct (0–100),
 * loaded?, total?, jobId? } — pct is monotonic across stages: upload 0–40,
 * helper processing 40–100 (server reports 0.05 → 0.2 → 1.0; we map it
 * and let elapsed time fill the gap so the bar never looks frozen).
 *
 * `ctl.cancel()` aborts the upload or tells the helper to stop the job.
 */
export async function nativeTranscribeFileJob(
  url,
  data,
  filename,
  { language = 'auto', task = 'transcribe', pollMs = 1000, sizeBytes = 0 } = {},
  onProgress,
  ctl = {},
) {
  let cancelled = false;
  let jobId = null;
  let xhr = null;
  ctl.cancel = async () => {
    cancelled = true;
    try {
      xhr?.abort();
    } catch {}
    if (jobId) await nativeCancelJob(url, jobId);
  };

  onProgress?.({ stage: 'upload', pct: 0, loaded: 0, total: sizeBytes });
  const started = nativeStartFileJob(
    url,
    data,
    filename,
    { language, task },
    (loaded, total) => onProgress?.({ stage: 'upload', pct: Math.round((loaded / total) * 40), loaded, total }),
    (x) => {
      xhr = x;
    },
  );
  ({ jobId } = await started);
  if (cancelled) {
    await nativeCancelJob(url, jobId);
    throw new Error('cancelled');
  }
  onProgress?.({ stage: 'queued', pct: 40, jobId, loaded: sizeBytes, total: sizeBytes });

  // Estimate: faster-whisper/mlx on a long file runs at ~10–30× realtime; without
  // duration info we ease the bar from 42 → 95 over time (asymptotic), and the
  // server's coarse 0.2 → 1.0 jumps snap it forward when they arrive.
  const t0 = Date.now();
  let lastPct = 40;
  while (true) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (cancelled) throw new Error('cancelled');
    let job;
    try {
      job = await nativeGetJob(url, jobId);
    } catch (e) {
      // transient poll failure — keep waiting unless the helper is really gone
      if (cancelled) throw new Error('cancelled');
      continue;
    }
    if (job.status === 'done') {
      onProgress?.({ stage: 'transcribe', pct: 100, jobId, segments: (job.segments || []).length });
      return mapSegments(job.segments);
    }
    if (job.status === 'cancelled') throw new Error('cancelled');
    if (job.status === 'error') throw new Error(job.error || 'native job failed');
    const serverP = Number(job.progress) || 0; // 0.05 … 1.0
    const elapsedS = (Date.now() - t0) / 1000;
    const eased = 42 + 53 * (1 - Math.exp(-elapsedS / 240)); // ~65% at 4 min, ~90% at 10 min
    const fromServer = 40 + serverP * 60;
    const pct = Math.min(95, Math.max(lastPct, Math.round(Math.max(eased, fromServer))));
    lastPct = pct;
    onProgress?.({
      stage: job.status === 'cancelling' ? 'cancelling' : 'transcribe',
      pct,
      jobId,
      elapsedS: Math.round(elapsedS),
    });
  }
}

// ---------------------------------------------------------------------------
// Helper compute device (Windows/Linux faster-whisper: cpu | cuda; macOS mlx: metal).
// Contract assumed by the side panel (backend implements it):
//   GET  /engine/device → { device: 'auto'|'cpu'|'cuda', active: 'cpu'|'cuda'|'apple-silicon', compute, cuda_available, applied: bool }
//   POST /engine/device { device } → { ok, device, restart_required: true }
// /health also carries `device` (active) and, once implemented, `device_pref`.
// Old helpers return 404 — callers treat that as "restart with DEVICE=… manually".
export const HELPER_DEVICE_OPTIONS = ['auto', 'cpu', 'cuda'];

export async function nativeGetDevice(url, timeoutMs = 2000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/engine/device`, { signal: ctrl.signal });
    if (r.status === 404) return { supported: false };
    if (!r.ok) throw new Error(`native /engine/device ${r.status}`);
    const j = await r.json();
    return { supported: true, ...j };
  } catch (e) {
    if (e?.name === 'AbortError') return { supported: false };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeSetDevice(url, device, timeoutMs = 3000) {
  if (!HELPER_DEVICE_OPTIONS.includes(device)) throw new Error(`device must be one of ${HELPER_DEVICE_OPTIONS.join(', ')}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(url)}/engine/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device }),
      signal: ctrl.signal,
    });
    if (r.status === 404) return { supported: false, device, restart_required: true };
    if (!r.ok) throw new Error(`native /engine/device ${r.status}: ${await r.text()}`);
    return { supported: true, ...(await r.json()) };
  } finally {
    clearTimeout(timer);
  }
}
