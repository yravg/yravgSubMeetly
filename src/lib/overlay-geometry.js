// Pure geometry for the floating subtitle overlay: keep the WHOLE panel inside
// the viewport (not only its centre point) and shrink it when the window is
// smaller than the panel. Used by content.js; unit-tested in test/.

/** Largest size that fits the viewport while honouring the minimum size. */
export function fitSizeToViewport(size, { vw, vh, min, margin = 8 }) {
  const maxW = Math.max(min.w, vw - margin * 2);
  const maxH = Math.max(min.h, vh - margin * 2);
  return { w: Math.min(size.w, maxW), h: Math.min(size.h, maxH) };
}

/**
 * Clamp a position expressed as {xPct: centre-x %, yPct: bottom-offset %}.
 * `w`/`h` = rendered panel size in px. Returns a new position.
 */
export function clampOverlayPos(pos, { vw, vh, w, h, margin = 8 }) {
  if (!pos) return pos;
  const width = Math.min(w, vw);
  const height = Math.min(h, vh);
  const minX = ((width / 2 + margin) / vw) * 100;
  const maxX = 100 - minX;
  const minY = (margin / vh) * 100;
  const maxY = ((vh - height - margin) / vh) * 100;
  return {
    xPct: minX <= maxX ? Math.min(maxX, Math.max(minX, pos.xPct)) : 50,
    yPct: minY <= maxY ? Math.min(maxY, Math.max(minY, pos.yPct)) : minY,
  };
}

/** Pixel rectangle of a panel for a given clamped position (for tests / debugging). */
export function overlayRect(pos, { vw, vh, w, h }) {
  const cx = (pos.xPct / 100) * vw;
  const bottom = vh - (pos.yPct / 100) * vh;
  return { left: cx - w / 2, right: cx + w / 2, top: bottom - h, bottom };
}
