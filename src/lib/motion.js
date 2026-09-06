/**
 * motion.js — the four Animate UI motion primitives, ported to vanilla.
 *
 * Animate UI ships React components on top of `motion/react`. What is actually
 * worth having here is the *spring constants* and the layout strategy, not the
 * runtime: this extension has no React, no Tailwind, and a hard interest in a
 * side panel that cold-opens instantly. So the constants are transcribed and the
 * ~34 KB gz runtime is replaced by the integrator below.
 *
 * Nothing in this file touches the DOM at import time, and every DOM helper is
 * guarded, so `spring`, `integrate` and `digitPositions` can be unit-tested in
 * plain node (see test/motion.test.mjs).
 *
 * Primitives:
 *   MP-01  slidingNumber   texts/sliding-number      odometer digits
 *   MP-02  springProgress  radix/progress            burst-tolerant progress bar
 *   MP-03  autoHeight      effects/auto-height       measured height transitions
 *   MP-04  highlight       effects/highlight         moving pill behind a tablist
 */

/** Spring constants transcribed from the Animate UI sources. */
export const SPRING = {
  number: { stiffness: 200, damping: 20, mass: 0.4 },
  progress: { stiffness: 100, damping: 30, mass: 1 },
  height: { stiffness: 300, damping: 30, mass: 1 },
  highlight: { stiffness: 350, damping: 35, mass: 1 },
};

/** Fixed integration step. Small enough to stay stable at stiffness 350. */
const STEP = 1 / 240;

/**
 * A stalled tab (backgrounded, GC pause) hands the next frame a huge delta.
 * Integrating that in one go throws the spring across the screen, so clamp it —
 * the animation lands slightly late rather than exploding.
 */
const MAX_FRAME = 0.064;

const noop = () => {};

const raf =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(() => fn(Date.now()), 16);

const caf =
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;

let reducedQuery = null;

/**
 * True when the user asked for reduced motion. minutes.css already kills every
 * transition under this query, so the primitives must agree with it rather than
 * animate underneath a stylesheet that thinks nothing is moving.
 */
export function prefersReducedMotion() {
  if (typeof matchMedia !== 'function') return false;
  if (!reducedQuery) reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  return reducedQuery.matches;
}

/**
 * One semi-implicit Euler step of a damped spring. Pure: returns a new state.
 * Semi-implicit (velocity updated before position) is what keeps it stable at
 * these stiffnesses where explicit Euler would gain energy and oscillate away.
 *
 * @param {{x: number, v: number}} state
 * @param {number} to           target value
 * @param {{stiffness: number, damping: number, mass?: number}} cfg
 * @param {number} dt           seconds
 * @returns {{x: number, v: number}}
 */
export function integrate(state, to, cfg, dt) {
  const { stiffness, damping } = cfg;
  const mass = cfg.mass || 1;
  let { x, v } = state;
  let remaining = Math.min(dt, MAX_FRAME);
  while (remaining > 0) {
    const h = Math.min(STEP, remaining);
    const a = (-stiffness * (x - to) - damping * v) / mass;
    v += a * h;
    x += v * h;
    remaining -= h;
  }
  return { x, v };
}

/**
 * Drive a single number from `from` to `to` on a spring.
 *
 * Returns a cancel function. Under reduced motion (or a zero-length move) the
 * target is delivered synchronously on the first call and nothing is scheduled.
 *
 * @param {number} from
 * @param {number} to
 * @param {{stiffness: number, damping: number, mass?: number,
 *          restDelta?: number, restSpeed?: number, velocity?: number}} cfg
 * @param {(value: number) => void} onUpdate
 * @param {() => void} [onDone]
 * @returns {() => void} cancel
 */
export function spring(from, to, cfg, onUpdate, onDone) {
  if (prefersReducedMotion() || from === to) {
    onUpdate(to);
    if (onDone) onDone();
    return noop;
  }

  const restDelta = cfg.restDelta == null ? 0.002 : cfg.restDelta;
  const restSpeed = cfg.restSpeed == null ? 0.02 : cfg.restSpeed;

  let state = { x: from, v: cfg.velocity || 0 };
  let last = null;
  let id = 0;
  let live = true;

  const tick = (now) => {
    if (!live) return;
    const dt = last == null ? STEP : Math.max(0, (now - last) / 1000);
    last = now;
    state = integrate(state, to, cfg, dt);

    if (Math.abs(to - state.x) < restDelta && Math.abs(state.v) < restSpeed) {
      live = false;
      onUpdate(to);
      if (onDone) onDone();
      return;
    }
    onUpdate(state.x);
    id = raf(tick);
  };

  id = raf(tick);
  return () => {
    if (!live) return;
    live = false;
    caf(id);
  };
}

/* ------------------------------------------------------------------ *
 * MP-01 — sliding number
 * ------------------------------------------------------------------ */

/**
 * Odometer position for each digit column.
 *
 * A column shows its own digit and rests on it — the naive `value / 10^p % 10`
 * looks right in motion but parks every higher column mid-glyph (at 351.2 the
 * hundreds column would sit permanently half-way between 3 and 4). So a column
 * only leaves its digit inside `roll` of a carry, and crosses in that window:
 * the tens column starts turning as the units column passes 9, which is what
 * makes the group read as one mechanical counter.
 *
 * The seam is hidden by rendering an extra 0 cell at index 10, so a column
 * arriving at 10 and snapping back to 0 lands on an identical glyph.
 *
 * @param {number} value
 * @param {number[]} powers  e.g. [2, 1, 0, -1] for `123.4`
 * @param {number} [roll]    share of a step spent carrying, 0..1
 * @returns {number[]} positions in [0, 10)
 */
export function digitPositions(value, powers, roll = 0.1) {
  const v = Math.max(0, value);
  const least = Math.min(...powers);
  return powers.map((p) => {
    let scaled = v / Math.pow(10, p);
    // 565.4 / 0.1 is 5653.999999999999, and flooring that shows a 3 where a 4
    // belongs. Snap values that are an integer to within float noise.
    const nearest = Math.round(scaled);
    if (Math.abs(scaled - nearest) < 1e-9 * Math.max(1, Math.abs(scaled))) {
      scaled = nearest;
    }
    const whole = Math.floor(scaled);
    const frac = scaled - whole;
    // Every column carries over the same slice of real value — the last `roll`
    // of the smallest displayed step — so a tens column only starts turning
    // once the units column is itself rolling off 9.
    const win = roll * Math.pow(10, least - p);
    const carry = frac > 1 - win ? (frac - (1 - win)) / win : 0;
    return (whole % 10) + carry;
  });
}

/** How many integer digits `value` needs (at least 1). */
export function integerDigits(value) {
  const v = Math.floor(Math.abs(value));
  return v < 1 ? 1 : Math.floor(Math.log10(v)) + 1;
}

/**
 * What a column stack spells out, as text.
 *
 * The clipped cells are all still in the DOM, so without an accessible name a
 * screen reader reads eleven digits per column. `slidingNumber` puts this on
 * the host as `role="img"` + `aria-label`, which makes it a leaf that announces
 * the figure instead.
 *
 * @param {number} value
 * @param {{decimals?: number, groupSeparator?: string,
 *          decimalSeparator?: string, unit?: string, signed?: boolean}} [opts]
 * @returns {string}
 */
export function formatNumber(value, opts = {}) {
  const decimals = opts.decimals || 0;
  const groupSep = opts.groupSeparator || '';
  const sep = opts.decimalSeparator || '.';
  const fixed = Math.abs(value).toFixed(decimals);
  const dot = fixed.indexOf('.');
  let int = dot === -1 ? fixed : fixed.slice(0, dot);
  const frac = dot === -1 ? '' : fixed.slice(dot + 1);
  if (groupSep) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
  // A minus is never optional; the plus is, and only for a signed mount. Plain
  // ASCII, because that is what fmtNum/fmtMeasure print everywhere else.
  const sign = value < 0 ? '-' : opts.signed ? '+' : '';
  return sign + int + (frac ? sep + frac : '') + (opts.unit || '');
}

/**
 * Mount an odometer inside `el`.
 *
 * The columns are pure `transform`, so a dozen of these running during a
 * parallel model download stay off the layout thread.
 *
 * @param {HTMLElement} el
 * @param {{decimals?: number, intDigits?: number, unit?: string,
 *          signed?: boolean, pad?: boolean, lineHeight?: number,
 *          decimalSeparator?: string, groupSeparator?: string,
 *          cfg?: object, display?: string}} [opts]
 * @returns {{to: (n: number) => void, set: (n: number) => void,
 *            value: () => number, destroy: () => void}}
 */
export function slidingNumber(el, opts = {}) {
  const decimals = opts.decimals || 0;
  const unit = opts.unit || '';
  const signed = !!opts.signed;
  const pad = !!opts.pad;
  const lineHeight = opts.lineHeight || 1.1;
  const sep = opts.decimalSeparator || '.';
  const groupSep = opts.groupSeparator || '';
  const cfg = opts.cfg || SPRING.number;

  let intDigits = Math.max(1, opts.intDigits || 1);
  let cells = [];
  let groups = [];
  let signEl = null;
  let current = 0;
  let cancel = noop;
  let lastVisible = -1;

  const format = (value) =>
    formatNumber(value, {
      decimals,
      groupSeparator: groupSep,
      decimalSeparator: sep,
      unit,
      signed,
    });

  function label(value) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', format(value));
  }

  function build() {
    el.textContent = '';
    cells = [];
    groups = [];
    signEl = null;

    // The digit cells are sized in em, so the host has to stop inheriting a
    // line-height that would push them off the surrounding text baseline.
    el.style.display = opts.display || 'inline-flex';
    el.style.alignItems = 'baseline';
    el.style.lineHeight = String(lineHeight);

    // Always present: a mount that is not declared `signed` can still be handed
    // a negative value, and dropping the minus would misreport the figure.
    signEl = document.createElement('span');
    signEl.className = 'mo-sign';
    signEl.textContent = signed ? '+' : '';
    el.appendChild(signEl);

    for (let i = 0; i < intDigits + decimals; i++) {
      const power = intDigits - 1 - i;
      if (power === -1) {
        const dot = document.createElement('span');
        dot.className = 'mo-sep';
        dot.textContent = sep;
        el.appendChild(dot);
      }
      const wrap = document.createElement('span');
      wrap.className = 'mo-digit';
      wrap.style.cssText =
        'display:inline-block;overflow:hidden;height:' + lineHeight + 'em;';
      const col = document.createElement('span');
      col.className = 'mo-col';
      col.style.cssText = 'display:flex;flex-direction:column;will-change:transform;';
      // 0..9 plus a repeated 0, so the wrap seam is invisible.
      for (let d = 0; d <= 10; d++) {
        const cell = document.createElement('span');
        cell.style.cssText = 'display:block;height:' + lineHeight + 'em;';
        cell.textContent = String(d % 10);
        col.appendChild(cell);
      }
      wrap.appendChild(col);
      el.appendChild(wrap);
      cells.push({ wrap, col, power });

      // Thousands separator after this column, e.g. 35|,|000.
      if (groupSep && power > 0 && power % 3 === 0) {
        const g = document.createElement('span');
        g.className = 'mo-group';
        g.textContent = groupSep;
        el.appendChild(g);
        groups.push({ el: g, power });
      }
    }

    if (unit) {
      const u = document.createElement('span');
      u.className = 'mo-unit';
      u.textContent = unit;
      el.appendChild(u);
    }
    lastVisible = -1;
  }

  /** Grow the column count when a value outruns it (80 MB -> 2700 MB). */
  function ensureWidth(value) {
    const needed = integerDigits(value);
    if (needed <= intDigits) return;
    intDigits = needed;
    build();
  }

  function render(value) {
    // The columns carry the magnitude; the sign cell carries the sign. Without
    // the abs a negative variance would roll every column down to zero.
    const positions = digitPositions(Math.abs(value), cells.map((c) => c.power));
    for (let i = 0; i < cells.length; i++) {
      cells[i].col.style.transform =
        'translateY(' + -(positions[i] * lineHeight) + 'em)';
    }
    if (signEl) signEl.textContent = value < 0 ? '-' : signed ? '+' : '';

    if (pad) return;
    // Hide leading zeros, but only when the count changes — toggling display
    // every frame would thrash layout for no visible gain.
    const visible = integerDigits(value);
    if (visible === lastVisible) return;
    lastVisible = visible;
    for (const c of cells) {
      if (c.power < 0) continue;
      c.wrap.style.display = c.power >= visible ? 'none' : 'inline-block';
    }
    // A separator only earns its place while a digit still sits to its left.
    for (const g of groups) {
      g.el.style.display = g.power >= visible ? 'none' : 'inline';
    }
  }

  build();
  label(0);
  render(0);

  return {
    to(value) {
      cancel();
      ensureWidth(value);
      // Label the destination, not each frame: a screen reader should hear the
      // figure once, not a stream of intermediate values.
      label(value);
      cancel = spring(
        current,
        value,
        cfg,
        (v) => {
          current = v;
          render(v);
        },
        () => {
          current = value;
          render(value);
        },
      );
    },
    set(value) {
      cancel();
      cancel = noop;
      ensureWidth(value);
      label(value);
      current = value;
      render(value);
    },
    value: () => current,
    text: format,
    destroy() {
      cancel();
      cancel = noop;
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      el.textContent = '';
    },
  };
}

/* ------------------------------------------------------------------ *
 * MP-02 — spring progress
 * ------------------------------------------------------------------ */

/**
 * Spring-driven progress fill.
 *
 * @huggingface/transformers reports sharded downloads in irregular bursts. A
 * fixed `transition: width .3s` restarts its ease on every burst, so the bar
 * visibly stalls and jerks — worst when several models download at once, which
 * is exactly the flow the model manager is for. A spring carries velocity
 * across bursts instead of restarting, so the same event stream reads smooth.
 *
 * The caller keeps ownership of the percentage label via `onValue`.
 *
 * @param {HTMLElement} fill  the element whose width is driven
 * @param {{onValue?: (pct: number) => void, cfg?: object,
 *          precision?: number}} [opts]
 * @returns {{to: (pct: number) => void, set: (pct: number) => void,
 *            value: () => number, destroy: () => void}}
 */
export function springProgress(fill, opts = {}) {
  const cfg = opts.cfg || SPRING.progress;
  const precision = opts.precision == null ? 2 : opts.precision;
  const onValue = opts.onValue || noop;
  let current = 0;
  let cancel = noop;

  const clamp = (n) => Math.min(100, Math.max(0, n));

  function paint(v) {
    current = v;
    if (fill) fill.style.width = v.toFixed(precision) + '%';
    onValue(v);
  }

  paint(0);

  return {
    to(pct) {
      const target = clamp(pct);
      cancel();
      cancel = spring(current, target, cfg, paint, () => paint(target));
    },
    set(pct) {
      cancel();
      cancel = noop;
      paint(clamp(pct));
    },
    value: () => current,
    destroy() {
      cancel();
      cancel = noop;
    },
  };
}

/* ------------------------------------------------------------------ *
 * MP-03 — auto height
 * ------------------------------------------------------------------ */

/**
 * Animate a collapsible panel between 0 and its measured content height.
 *
 * The ResizeObserver is the point: it keeps the open height correct when the
 * content changes *while* open — a download line appearing under a warning
 * banner, or a language name that wraps to two lines in zh. Without it the
 * panel clips the moment the content grows.
 *
 * `panel` must be the clipping wrapper; its first element child (or `opts.inner`)
 * is what gets measured.
 *
 * @param {HTMLElement} panel
 * @param {{inner?: HTMLElement, open?: boolean, cfg?: object,
 *          onChange?: (open: boolean) => void,
 *          onSettled?: (open: boolean) => void}} [opts]
 * @returns {{open: (a?: boolean) => void, close: (a?: boolean) => void,
 *            toggle: () => void, isOpen: () => boolean,
 *            remeasure: () => void, destroy: () => void}}
 */
export function autoHeight(panel, opts = {}) {
  const inner = opts.inner || panel.firstElementChild;
  const cfg = opts.cfg || SPRING.height;
  const onChange = opts.onChange || noop;
  const onSettled = opts.onSettled || noop;
  let open = opts.open !== false;
  let measured = 0;
  let cancel = noop;
  let animating = false;
  let observer = null;

  panel.style.overflow = 'hidden';

  function measure() {
    if (!inner) return 0;
    // scrollHeight rather than getBoundingClientRect: the panel may currently be
    // clipped to 0, and scrollHeight reports the content regardless. Its own
    // margins sit inside the clipping wrapper, so they count toward the height
    // the panel has to open to — otherwise a panel whose content carries a
    // margin-top opens short and clips its last line.
    let margins = 0;
    if (typeof getComputedStyle === 'function') {
      const cs = getComputedStyle(inner);
      const m = parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      if (Number.isFinite(m)) margins = m;
    }
    return inner.scrollHeight + margins;
  }

  function apply(h) {
    panel.style.height = h + 'px';
  }

  function settle() {
    measured = measure();
    if (open && !animating) apply(measured);
  }

  if (typeof ResizeObserver === 'function' && inner) {
    observer = new ResizeObserver(settle);
    observer.observe(inner);
  }

  measured = measure();
  apply(open ? measured : 0);

  function set(next, animated) {
    if (next === open) return;
    open = next;
    onChange(open);
    measured = measure();
    const target = open ? measured : 0;
    cancel();
    if (animated === false) {
      animating = false;
      apply(target);
      onSettled(open);
      return;
    }
    const from = parseFloat(panel.style.height) || 0;
    animating = true;
    cancel = spring(
      from,
      target,
      cfg,
      apply,
      () => {
        animating = false;
        cancel = noop;
        // Re-measure on landing: the content may have grown mid-animation, and
        // from here the ResizeObserver keeps the open height honest.
        apply(open ? measure() : 0);
        // Callers clear or hide the collapsed content here — doing it when the
        // close is *requested* would blank the panel before it has shut.
        onSettled(open);
      },
    );
  }

  return {
    open: (animated) => set(true, animated),
    close: (animated) => set(false, animated),
    toggle: () => set(!open, true),
    isOpen: () => open,
    remeasure: settle,
    destroy() {
      cancel();
      cancel = noop;
      if (observer) observer.disconnect();
      panel.style.height = '';
      panel.style.overflow = '';
    },
  };
}

/* ------------------------------------------------------------------ *
 * MP-04 — highlight
 * ------------------------------------------------------------------ */

/**
 * A pill that travels behind the selected item of a segmented control.
 *
 * Two springs — one on translateX, one on width — so the pill stretches as it
 * moves between labels of different lengths. That stretch is the whole reason
 * this reads better than a CSS `left` transition, where a wide target snaps its
 * width at the start and the pill arrives already the wrong shape.
 *
 * Geometry comes from offsetLeft/offsetWidth at select time, so there is no
 * layout bookkeeping to keep in sync and an i18n language swap re-measures for
 * free on the next `remeasure()`.
 *
 * `aria`/`activeClass` cover the two conventions in this codebase: a real
 * tablist marks selection with aria-selected, while the side panel's `.seg`
 * groups are plain buttons that carry an `.active` class.
 *
 * @param {HTMLElement} container  must be positioned (relative/absolute)
 * @param {{pill?: HTMLElement, items?: HTMLElement[], selector?: string,
 *          cfg?: object, onChange?: (el: HTMLElement, i: number) => void,
 *          bind?: boolean, aria?: boolean, activeClass?: string}} [opts]
 * @returns {{select: (target: HTMLElement|number, animated?: boolean) => void,
 *            selected: () => HTMLElement|null, remeasure: () => void,
 *            destroy: () => void}}
 */
export function highlight(container, opts = {}) {
  const cfg = opts.cfg || SPRING.highlight;
  const onChange = opts.onChange || noop;
  const aria = opts.aria !== false;
  const activeClass = opts.activeClass || '';
  const selector = opts.selector || '[role="tab"], button';
  const pill = opts.pill || container.querySelector('.mo-pill');
  const items = opts.items || Array.from(container.querySelectorAll(selector))
    .filter((el) => el !== pill);

  let x = 0;
  let w = 0;
  let cancelX = noop;
  let cancelW = noop;
  let active = null;

  function paintX(v) {
    x = v;
    if (pill) pill.style.transform = 'translateX(' + v + 'px)';
  }
  function paintW(v) {
    w = v;
    if (pill) pill.style.width = v + 'px';
  }

  function place(el, animated) {
    if (!el) return;
    const tx = el.offsetLeft;
    const tw = el.offsetWidth;
    cancelX();
    cancelW();
    if (animated === false) {
      cancelX = noop;
      cancelW = noop;
      paintX(tx);
      paintW(tw);
      return;
    }
    cancelX = spring(x, tx, cfg, paintX);
    cancelW = spring(w, tw, cfg, paintW);
  }

  function select(target, animated) {
    const el = typeof target === 'number' ? items[target] : target;
    if (!el) return;
    active = el;
    for (const item of items) {
      if (aria) item.setAttribute('aria-selected', String(item === el));
      if (activeClass) item.classList.toggle(activeClass, item === el);
    }
    place(el, animated);
    onChange(el, items.indexOf(el));
  }

  const listeners = [];
  if (opts.bind !== false) {
    for (const item of items) {
      const fn = () => select(item, true);
      item.addEventListener('click', fn);
      listeners.push([item, fn]);
    }
  }

  const initial =
    items.find((el) =>
      activeClass
        ? el.classList.contains(activeClass)
        : el.getAttribute('aria-selected') === 'true',
    ) || items[0];
  if (initial) {
    active = initial;
    place(initial, false);
  }

  function remeasure() {
    place(active, false);
  }

  return {
    select,
    selected: () => active,
    remeasure,
    destroy() {
      cancelX();
      cancelW();
      cancelX = noop;
      cancelW = noop;
      for (const [el, fn] of listeners) el.removeEventListener('click', fn);
      listeners.length = 0;
    },
  };
}
