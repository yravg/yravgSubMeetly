/**
 * Klien API notulen di Native Helper (127.0.0.1:17865).
 */
function base(url) {
  return (url || 'http://127.0.0.1:17865').replace(/\/$/, '');
}

export async function notesGenerate(url, { lines, title, source }) {
  const r = await fetch(`${base(url)}/notes/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines, title, source }),
  });
  if (!r.ok) throw new Error(`notes/generate ${r.status}`);
  return (await r.json()).note;
}

export async function notesList(url) {
  const r = await fetch(`${base(url)}/notes`);
  if (!r.ok) throw new Error(`notes ${r.status}`);
  return (await r.json()).notes || [];
}

export async function notesSave(url, note) {
  const r = await fetch(`${base(url)}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  if (!r.ok) throw new Error(`notes save ${r.status}`);
  return (await r.json()).note;
}

export async function startTranscribeFileJob(url, body, { filename, language, task } = {}) {
  const q = new URLSearchParams({
    filename: filename || 'input.bin',
    language: language || 'auto',
    task: task || 'transcribe',
  });
  const r = await fetch(`${base(url)}/transcribe_file_job?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': filename || 'input.bin' },
    body,
  });
  if (!r.ok && r.status !== 202) throw new Error(`transcribe_file_job ${r.status}`);
  return r.json();
}

export async function getJob(url, jobId) {
  const r = await fetch(`${base(url)}/jobs/${jobId}`);
  if (!r.ok) throw new Error(`job ${r.status}`);
  return r.json();
}

export async function cancelJob(url, jobId) {
  const r = await fetch(`${base(url)}/jobs/${jobId}/cancel`, { method: 'POST' });
  if (!r.ok) throw new Error(`cancel ${r.status}`);
  return r.json();
}
