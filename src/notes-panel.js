/**
 * Renderer panel Notulen Rapat (frontend stub).
 * Dipakai harness test/notes-panel.html; nanti diintegrasikan ke Side Panel.
 */
import { loadNotesState, statusLabel, STUB_NOTE, STUB_TRANSCRIPT } from './lib/notes-stub.js';
import { serializeNote } from './lib/notes-export.js';
import { generateNotesFromTranscript } from './lib/notes-generate.js';
import { saveNote, listNotes } from './lib/notes-store.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decisionsHtml(note, state) {
  const decisions = note.decisions || [];
  if (!decisions.length) {
    return `<p class="notes-empty" id="notes-decisions-empty">${escapeHtml(state.emptyDecisionsMessage)}</p>`;
  }
  return `<ul id="notes-decisions-list">${decisions.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`;
}

function actionsHtml(note, state) {
  const actions = note.actions || [];
  if (!actions.length) {
    return `<p class="notes-empty" id="notes-actions-empty">${escapeHtml(state.emptyActionsMessage)}</p>`;
  }
  return `<ul class="notes-actions-list" id="notes-actions-list">${actions
    .map(
      (a) => `
        <li data-act-id="${escapeHtml(a.id)}">
          <div class="act-text">${escapeHtml(a.text)}</div>
          <span class="act-meta">${escapeHtml(a.owner || '—')}</span>
          <span class="act-meta">${escapeHtml(a.due || 'tanpa tenggat')} · ${a.status}</span>
        </li>`,
    )
    .join('')}</ul>`;
}

/**
 * @param {HTMLElement} root
 * @param {Awaited<ReturnType<typeof loadNotesState>>} state
 * @param {object} [handlers]
 */
export function renderNotesPanel(root, state, handlers = {}) {
  const note = state.note;
  const local = state.localStatus || note.status;

  root.innerHTML = `
    <div class="notes-panel" data-notes-root>
      <div class="notes-status-row">
        <span class="notes-pill ${escapeHtml(local)}" id="notes-local-status" data-status="${escapeHtml(local)}">
          <span aria-hidden="true">●</span>
          ${escapeHtml(statusLabel(local))}
        </span>
        <span class="notes-meta" id="notes-source-line">
          ${note.savedLocally ? '📦 Tersimpan di perangkat' : 'Draft lokal'} · ${escapeHtml(note.source)}
        </span>
      </div>

      <div class="notes-block">
        <h3 id="notes-title">${escapeHtml(note.title)}</h3>
        <p class="notes-meta">Dibuat ${escapeHtml(note.generatedAt || '—')}</p>
      </div>

      <div class="notes-toolbar">
        <button type="button" class="btn primary" id="btn-notes-generate">
          Buat Notulen dari contoh
        </button>
        <button type="button" class="btn ghost" id="btn-notes-clear-decisions" title="Demo pesan kosong">
          Kosongkan keputusan
        </button>
        <button type="button" class="btn" id="btn-notes-export">
          Ekspor…
        </button>
      </div>

      <div class="notes-block" id="notes-summary-block">
        <h3>Ringkasan</h3>
        <p id="notes-summary">${escapeHtml(note.summary)}</p>
        <details class="notes-transcript" id="notes-transcript-details">
          <summary>Transkrip contoh</summary>
          <pre id="notes-transcript-preview">${escapeHtml(note.transcriptPreview || '')}</pre>
        </details>
      </div>

      <div class="notes-block" id="notes-decisions-block">
        <h3>Poin Keputusan</h3>
        <div id="notes-decisions">${decisionsHtml(note, state)}</div>
      </div>

      <div class="notes-block" id="notes-actions-block">
        <h3>Tindak Lanjut</h3>
        <div id="notes-actions">${actionsHtml(note, state)}</div>
      </div>

      <div class="notes-block" id="notes-saved-block">
        <h3>Notulen tersimpan (lokal)</h3>
        <div class="notes-saved-list" id="notes-saved-list">
          ${(state.saved || [])
            .map(
              (n) => `
            <button type="button" class="notes-saved-item${n.id === note.id ? ' active' : ''}" data-note-id="${escapeHtml(n.id)}">
              <div>
                <div class="ns-title">${escapeHtml(n.title)}</div>
                <div class="ns-meta">${escapeHtml(n.source)} · ${escapeHtml(statusLabel(n.status))}</div>
              </div>
              <span class="notes-pill ${escapeHtml(n.status)}">${n.savedLocally ? 'lokal' : 'draft'}</span>
            </button>`,
            )
            .join('')}
        </div>
      </div>

      <dialog id="notes-export-dialog" class="notes-dialog">
        <form method="dialog" class="notes-dialog-body">
          <h3>Ekspor notulen</h3>
          <p class="notes-meta">Unduh sebagai teks polos atau Markdown (100% lokal).</p>
          <div class="notes-toolbar">
            <button type="submit" class="btn primary" value="txt" id="btn-export-txt">TXT</button>
            <button type="submit" class="btn primary" value="md" id="btn-export-md">Markdown</button>
            <button type="submit" class="btn ghost" value="cancel">Batal</button>
          </div>
        </form>
      </dialog>
    </div>
  `;

  root.querySelector('#btn-notes-generate')?.addEventListener('click', () => handlers.onGenerate?.());
  root.querySelector('#btn-notes-export')?.addEventListener('click', () => {
    handlers.onExport?.();
    root.querySelector('#notes-export-dialog')?.showModal();
  });
  root.querySelector('#btn-notes-clear-decisions')?.addEventListener('click', () => {
    handlers.onClearDecisions?.();
  });
  root.querySelectorAll('[data-note-id]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onSelectSaved?.(btn.getAttribute('data-note-id')));
  });
  root.querySelector('#notes-export-dialog')?.addEventListener('close', (ev) => {
    const val = /** @type {HTMLDialogElement} */ (ev.target).returnValue;
    if (val === 'txt' || val === 'md') handlers.onExportFormat?.(val);
  });
}

export function formatNoteExport(note, format) {
  return serializeNote(note, format === 'md' ? 'md' : 'txt');
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function mountNotesPanel(root) {
  let state = await loadNotesState();

  const redraw = () => {
    renderNotesPanel(root, state, {
      onGenerate: () => {
        state = {
          ...state,
          localStatus: 'generating',
          note: {
            ...state.note,
            status: 'generating',
            summary: 'Menyusun notulen dari transkrip contoh…',
            decisions: [],
            actions: [],
          },
        };
        redraw();
        setTimeout(async () => {
          const built = generateNotesFromTranscript(
            STUB_TRANSCRIPT.map((l) => ({ text: l.text, speaker: l.speaker, t0: l.t0, t1: l.t1 })),
            {
              title: 'Standup rilis Fase 1 — contoh',
              source: 'transkrip contoh (dibuat sekarang)',
            },
          );
          built.decisions = STUB_NOTE.decisions;
          built.actions = STUB_NOTE.actions;
          built.summary = STUB_NOTE.summary;
          built.status = 'saved';
          built.savedLocally = true;
          try {
            await saveNote(built);
            const saved = await listNotes();
            state = {
              ...state,
              localStatus: 'saved',
              note: built,
              activeNoteId: built.id,
              saved: saved.length ? saved : [built, ...state.saved],
            };
          } catch {
            state = {
              ...state,
              localStatus: 'saved',
              note: built,
              activeNoteId: built.id,
              saved: [built, ...state.saved.filter((n) => n.id !== built.id)],
            };
          }
          redraw();
        }, 600);
      },
      onClearDecisions: () => {
        state = {
          ...state,
          note: { ...state.note, decisions: [] },
        };
        redraw();
      },
      onSelectSaved: (id) => {
        const found = state.saved.find((n) => n.id === id);
        if (!found) return;
        state = {
          ...state,
          note: { ...found },
          activeNoteId: id,
          localStatus: found.status === 'saved' ? 'saved' : found.status,
        };
        redraw();
      },
      onExportFormat: (fmt) => {
        const safe = (state.note.title || 'notulen').replace(/[^\w\s.-]+/g, '_').slice(0, 60);
        const ext = fmt === 'md' ? 'md' : 'txt';
        downloadText(`${safe}.${ext}`, formatNoteExport(state.note, fmt));
      },
    });
  };

  redraw();
  return () => state;
}
