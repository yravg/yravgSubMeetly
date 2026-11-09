// Copied from docs/design/submeetly-canvas/icons/colour-icons.mjs (board D02 icon source). Keep in sync by hand.
// Full-colour two-tone icons on a 24 grid, same approach as Solvarium (app/src/workspace/logic/p6Icons.js):
// hand-written shapes (fill + darker outline), one hue per feature group, shown on a light tinted tile.
// Own drawings. Nothing traced from another product. No emoji, no sparkle.
const c = { g: '#34B36B', gd: '#1E8A4B', b: '#3B8BEB', bd: '#1F5FBF', r: '#E5483D', rd: '#B42C22', y: '#F5BE3B', yd: '#C2860F', o: '#F08A2C', od: '#BF620E', t: '#1BA9AE', td: '#0E7C80', n: '#64748B', nl: '#CBD5E1', w: '#FFFFFF', bl: '#BBD8FA', gl: '#BDEBD0', yl: '#FDE9B0', rl: '#F9C9C4', tl: '#B6E8EA', ol: '#FBD9B5' };
const R = (x, y, w, h, f, s, rx = 1.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}"${s ? ` stroke="${s}" stroke-width="1"` : ''}/>`;
const C = (x, y, r, f, s) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}"${s ? ` stroke="${s}" stroke-width="1"` : ''}/>`;
const P = (d, f, s, sw = 1) => `<path d="${d}" fill="${f || 'none'}"${s ? ` stroke="${s}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`;
const L = (d, s, sw = 1.6) => P(d, null, s, sw);

// hue -> tile tint (bg) and ring
export const HUES = { g: { bg: '#E3F5EA', ring: '#9ED8B6' }, b: { bg: '#E3EFFD', ring: '#A5C9F4' }, o: { bg: '#FDEBD9', ring: '#F2BC87' }, t: { bg: '#DDF3F4', ring: '#8ED3D6' }, y: { bg: '#FDF1CC', ring: '#EBCB6E' }, r: { bg: '#FCE4E1', ring: '#F0A9A2' }, n: { bg: '#EAEEF3', ring: '#BAC4D1' } };

// name -> [hue, inner svg]
export const ICONS = {
  captions: ['g', R(2.5, 5, 19, 14, c.gl, c.gd, 3) + L('M7 10.5h3.5M13 10.5h4M7 14.5h6', c.gd, 1.8)],
  notes: ['y', P('M6 3.5h8.5L19 8v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z', c.yl, c.yd) + P('M14.5 3.5V8H19', null, c.yd) + L('M8.5 12h7M8.5 15.5h7', c.yd, 1.5)],
  history: ['t', C(12, 12, 9, c.tl, c.td) + L('M12 7v5l3.2 2', c.td, 1.8)],
  helper: ['o', R(3, 4, 18, 7, c.ol, c.od, 2) + R(3, 13, 18, 7, c.ol, c.od, 2) + C(7, 7.5, 1.1, c.od) + C(7, 16.5, 1.1, c.g) + L('M11 7.5h6M11 16.5h6', c.od, 1.4)],
  settings: ['n', L('M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1', c.n, 2.2) + C(12, 12, 5.2, c.nl, c.n) + C(12, 12, 1.8, c.w, c.n)],
  source: ['g', R(9, 2.8, 6, 11, c.gl, c.gd, 3) + L('M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7', c.gd, 1.7)],
  languages: ['b', P('M3 5.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8l-3 2.5V12.5a2 2 0 0 1-2-2z', c.bl, c.bd) + P('M11 12.5V14a2 2 0 0 0 2 2h3l3 2.5V16a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-4', c.w, c.bd) + L('M6 7.5h5M8.5 6.5v1M7 10c1.2-.4 2.6-1.4 3-2.5', c.bd, 1.3)],
  engine: ['o', R(6, 6, 12, 12, c.ol, c.od, 2.5) + L('M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3', c.od, 1.5) + P('M12.8 8.5 9.8 12.8h2.5L11.5 16l3.2-4.5h-2.5z', c.y, c.yd, 0.8)],
  perf: ['t', R(3, 3, 18, 18, c.w, c.td, 3) + R(6.5, 12, 3, 6, c.t, c.td, 0.8) + R(10.5, 8, 3, 10, c.b, c.bd, 0.8) + R(14.5, 10.5, 3, 7.5, c.g, c.gd, 0.8)],
  export: ['b', P('M4 15h4.5l1.6 2.6h3.8L15.5 15H20v4.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', c.bl, c.bd) + L('M12 13V3.5M8.5 7 12 3.5 15.5 7', c.bd, 1.9)],
  interp: ['t', L('M3.5 8h13l-3.2-3.5M20.5 16h-13l3.2 3.5', c.td, 1.9) + C(19, 8, 1.6, c.tl, c.td) + C(5, 16, 1.6, c.tl, c.td)],
  flag: ['r', L('M5.5 21V4', c.rd, 1.9) + P('M5.5 4.5h12.5l-2.4 4 2.4 4H5.5z', c.rl, c.rd)],
  lock: ['n', R(5, 10.5, 14, 10, c.nl, c.n, 2.5) + L('M8 10.5V8a4 4 0 0 1 8 0v2.5', c.n, 1.9) + C(12, 15.5, 1.5, c.n)],
  warn: ['r', P('M12 3.5 21.5 20h-19z', c.rl, c.rd) + L('M12 10v5M12 17.6v.01', c.rd, 2)],
  mock: ['b', L('M4 7h16M4 12h16M4 17h16', c.bd, 1.4) + C(9, 7, 2.4, c.bl, c.bd) + C(15.5, 12, 2.4, c.bl, c.bd) + C(8, 17, 2.4, c.bl, c.bd)],
  pages: ['b', R(3.5, 3.5, 7.5, 7.5, c.bl, c.bd, 2) + R(13, 3.5, 7.5, 7.5, c.gl, c.gd, 2) + R(3.5, 13, 7.5, 7.5, c.yl, c.yd, 2) + R(13, 13, 7.5, 7.5, c.ol, c.od, 2)],
  docs: ['g', P('M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', c.gl, c.gd) + L('M5 17a3 3 0 0 1 3-3h11M9 8h6', c.gd, 1.4)],
  sample: ['g', C(12, 12, 9, c.gl, c.gd) + P('M10 8.3v7.4l6-3.7z', c.g, c.gd)],
  draft: ['y', P('M6 3.5h8.5L19 8v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z', c.w, c.yd) + L('M8.5 12h4', c.yd, 1.5) + P('M12.5 19.5l.8-3 5.4-5.4 2.2 2.2-5.4 5.4z', c.y, c.yd)],
  compare: ['b', R(2.8, 4, 8.4, 16, c.bl, c.bd, 2) + R(12.8, 4, 8.4, 16, c.gl, c.gd, 2) + L('M5.5 9h3M5.5 12.5h3M15.5 9h3M15.5 12.5h3', c.w, 1.5)],
  pick: ['g', C(12, 12, 9, c.gl, c.gd) + L('M7.8 12.4l3 3 5.6-6.4', c.gd, 2)],
  diff: ['r', R(3, 4, 18, 16, c.w, c.n, 3) + R(13, 5.5, 6.5, 6.5, c.gl, null, 1) + L('M7 9h5M9.5 6.5v5', c.gd, 1.8) + L('M14 15.5h5', c.rd, 1.8)],
  dropzone: ['b', P('M3.5 6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z', c.bl, c.bd) + L('M12 7.5v8M8.8 12.6 12 15.8l3.2-3.2', c.bd, 1.9)],
  model: ['t', P('M12 3 20 7.5v9L12 21l-8-4.5v-9z', c.tl, c.td) + L('M4 7.5 12 12l8-4.5M12 12v9', c.td, 1.2)],
  live: ['r', C(12, 12, 3.2, c.r, c.rd) + L('M6.5 6.5a7.8 7.8 0 0 0 0 11M17.5 6.5a7.8 7.8 0 0 1 0 11', c.rd, 1.8)],
  register: ['y', R(3, 4, 18, 16, c.w, c.yd, 3) + R(3, 4, 18, 4.5, c.y, c.yd, 3) + L('M3 12.5h18M3 16.5h18M9 8.5V20', c.yd, 1.1)],
  search: ['b', C(10.5, 10.5, 6.5, c.bl, c.bd) + L('M15.5 15.5 20.5 20.5', c.yd, 3)],
  tab: ['g', R(3, 6, 18, 12, c.gl, c.gd, 2.5) + L('M14.5 6V3.5M3 11h8', c.gd, 1.4)],
  trash: ['r', P('M5.5 7.5h13l-1 12.5a1 1 0 0 1-1 .9H7.5a1 1 0 0 1-1-.9z', c.rl, c.rd) + L('M4 7.5h16M9.5 7.5V5h5v2.5', c.rd, 1.5)],
  bolt: ['o', P('M13.5 2.8 5.5 14h5.5l-1.2 7.2L18.5 10H13z', c.y, c.od)],
  check: ['g', C(12, 12, 9, c.g, c.gd) + L('M7.8 12.4l3 3 5.6-6.4', c.w, 2)],
  mail: ['b', R(2.8, 5.5, 18.4, 13, c.bl, c.bd, 2.5) + L('M3.5 7.5 12 13.5l8.5-6', c.bd, 1.7)],
  calendar: ['o', R(3, 5, 18, 16, c.w, c.od, 3) + R(3, 5, 18, 5, c.o, c.od, 3) + L('M8 3v4M16 3v4', c.od, 1.8) + R(7, 13, 3, 3, c.ol, c.od, 0.8) + R(14, 13, 3, 3, c.ol, c.od, 0.8)],
  book: ['t', P('M5 4h10.5a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', c.tl, c.td) + L('M5 17a3 3 0 0 1 3-3h10.5M9 8h5M9 11h3', c.td, 1.4)],
};

/** Plain colour icon (no tile). */
export const icon = (name, size = 18) => `<svg class="ci" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name][1]}</svg>`;
/** Hue tile: rounded square tinted by the icon's hue, colour icon inside. */
export const tile = (name, size = 28, hue) => `<span class="ct h-${hue || ICONS[name][0]}" style="width:${size}px;height:${size}px">${icon(name, Math.round(size * 0.66))}</span>`;
