/**
 * Drag handle that lets the user resize a panel (height by default) and
 * remembers the size in chrome.storage.local so it survives reopening.
 * Pure DOM + pointer events; no dependencies. Double-click resets.
 */

export function clampSize(value, min, max) {
  if (value == null || value === '') return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, Math.round(v)));
}

async function readSaved(key) {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    const { [key]: v } = await chrome.storage.local.get(key);
    return v ?? null;
  } catch {
    return null;
  }
}

async function writeSaved(key, value) {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    if (value == null) await chrome.storage.local.remove(key);
    else await chrome.storage.local.set({ [key]: value });
  } catch {
    /* storage unavailable (harness) */
  }
}

/**
 * @param {HTMLElement} target   element whose size changes (gets overflow:auto)
 * @param {object} opts
 * @param {string} opts.storageKey  chrome.storage.local key for persistence
 * @param {number} [opts.min=160]
 * @param {number} [opts.max=1200]
 * @param {'height'|'width'} [opts.axis='height']
 * @param {string} [opts.label]  accessible label for the handle
 * @returns {Promise<{ handle: HTMLElement, set(px:number|null):void, reset():void, get():number|null }>}
 */
export async function makeResizable(target, opts) {
  const { storageKey, min = 160, max = 1200, axis = 'height', label = 'Resize panel' } = opts;
  const prop = axis === 'width' ? 'width' : 'height';
  const handle = document.createElement('div');
  handle.className = `resize-handle resize-${axis}`;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', axis === 'width' ? 'vertical' : 'horizontal');
  handle.setAttribute('aria-label', label);
  handle.title = `${label} — double-click to reset`;
  handle.tabIndex = 0;
  target.insertAdjacentElement('afterend', handle);
  target.classList.add('resizable-target');

  let current = null;
  const apply = (px) => {
    current = px == null ? null : clampSize(px, min, max);
    target.style[prop] = current == null ? '' : `${current}px`;
    target.classList.toggle('resized', current != null);
    handle.setAttribute('aria-valuenow', current == null ? '' : String(current));
  };

  apply(clampSize(await readSaved(storageKey), min, max));

  let startPos = 0;
  let startSize = 0;
  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    startPos = axis === 'width' ? ev.clientX : ev.clientY;
    startSize = target.getBoundingClientRect()[prop];
    handle.classList.add('dragging');
    document.body.classList.add('is-resizing');
  });
  handle.addEventListener('pointermove', (ev) => {
    if (!handle.classList.contains('dragging')) return;
    const pos = axis === 'width' ? ev.clientX : ev.clientY;
    apply(startSize + (pos - startPos));
  });
  const end = (ev) => {
    if (!handle.classList.contains('dragging')) return;
    handle.classList.remove('dragging');
    document.body.classList.remove('is-resizing');
    try {
      handle.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
    writeSaved(storageKey, current);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => {
    apply(null);
    writeSaved(storageKey, null);
  });
  handle.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 40 : 10;
    const grow = axis === 'width' ? 'ArrowRight' : 'ArrowDown';
    const shrink = axis === 'width' ? 'ArrowLeft' : 'ArrowUp';
    if (ev.key !== grow && ev.key !== shrink && ev.key !== 'Home') return;
    ev.preventDefault();
    if (ev.key === 'Home') apply(null);
    else apply((current ?? target.getBoundingClientRect()[prop]) + (ev.key === grow ? step : -step));
    writeSaved(storageKey, current);
  });

  return {
    handle,
    set: (px) => {
      apply(px);
      writeSaved(storageKey, current);
    },
    reset: () => {
      apply(null);
      writeSaved(storageKey, null);
    },
    get: () => current,
  };
}
