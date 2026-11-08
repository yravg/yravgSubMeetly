// Peta fitur board D02: 10 grup, tiap grup melompat ke tab (atau ke Performance / modal Interpreter).
// Daftar ini mengikuti docs/design/submeetly-canvas/ix-boards.mjs (MAP) dan inventory-D02-D03-T03.md.
import { tile } from './colour-icons.js';

export const FEATURE_MAP = [
  ['source', 'Source', 'g', 'captions', ['Offline / Realtime', 'Current page tag', 'Go to tab', 'Offline dropzone', 'CC0 samples (lab)', 'Pick tab or window']],
  ['languages', 'Task and languages', 'b', 'captions', ['Transcribe / + Translate', 'Refine', 'Dual line', 'From / To', 'Model download', 'Start steps']],
  ['live', 'Live and results', 'r', 'captions', ['Original / Translation', 'Start / End', 'Error box', 'SRT / VTT / TXT', 'Export folder hint', 'Result lines']],
  ['interp', 'Interpreter', 't', 'interp', ['Consecutive A to B', 'Simultaneous', 'Languages', 'Turn on / Cancel']],
  ['perf', 'Performance', 't', 'perf', ['Charts / Table', 'Stage, pair, source filters', 'ASR p50, MT p50, RTF, N', 'Export, import, bench, clear']],
  ['notes', 'Notes capture', 'y', 'notes', ['Meeting switch + new', 'Project type', 'End and draft', 'Flag this moment', 'Summary', 'Decisions', 'Actions']],
  ['register', 'Register and paste', 'y', 'notes', ['Open register', 'TXT / Markdown / Sync', 'Start next', 'Saved meetings', 'Paste a Teams transcript']],
  ['history', 'History and export', 't', 'history', ['Search', 'Open / TXT / SRT / VTT / Delete', 'CRLF, BOM, language suffix', 'Save to OS default']],
  ['helper', 'Native helper', 'o', 'helper', ['Status and engine', 'Large-file job', 'Disconnect banner', 'Install guide per OS', 'Diagnostics', 'Troubleshooting']],
  ['settings', 'Settings', 'n', 'settings', ['Theme, language, reskin', 'Engine and device', 'Mirror, speed, models', 'Folder, refine, font size', 'About, licences']],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Isi `host` dengan 10 kartu grup; `onJump(tab)` dipanggil saat kartu diklik. */
export function renderFeatureMap(host, onJump) {
  host.innerHTML = FEATURE_MAP.map(
    ([ic, name, hue, tab, chips]) =>
      `<button type="button" class="mc" data-tab="${tab}" data-group="${ic}"><span class="mch">${tile(ic === 'live' ? 'live' : ic, 28, hue)}<b>${esc(name)}</b><span class="mcn">${chips.length}</span></span><span class="mcc">${chips.map((c) => `<i>${esc(c)}</i>`).join('')}</span></button>`,
  ).join('');
  host.querySelectorAll('.mc').forEach((b) => b.addEventListener('click', () => onJump(b.dataset.tab)));
}
