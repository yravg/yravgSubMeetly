/* Kasi, the yravgSubMeetly tarsier. One parametric drawing for every pose.
   Kasi.svg(opts) returns an <svg> string; the head centre is the origin.
   Flat colours only, so it stays crisp from 16 px up and animates by
   re-rendering with new numbers (ears, lids, gaze, yaw). */
(function (root) {
  const C = {
    fur: '#C7864E', shade: '#A0653A', deep: '#7E4A26', earIn: '#E2AE7F', mask: '#FFF0D9',
    ink: '#1B120B', amber: '#F5A524', hi: '#FFFFFF', accent: '#FFD23F'
  };
  const f = (n) => Math.round(n * 100) / 100;
  const rad = (d) => d * Math.PI / 180;
  const rot = (x, y, cx, cy, d) => {
    const a = rad(d), dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  };

  // Spoon-shaped ear in local space: base at the origin, tip at (0,-L).
  function spoon(L, W, tip) {
    const w = W / 2;
    return `M${f(-w * 0.62)} 4 C${f(-w)} ${f(-L * 0.35)} ${f(-w * 1.04)} ${f(-L * 0.78)} ${f(-W * tip * 0.5)} ${f(-L * 0.97)} ` +
      `Q0 ${f(-L * 1.04)} ${f(W * tip * 0.5)} ${f(-L * 0.97)} C${f(w * 1.04)} ${f(-L * 0.78)} ${f(w)} ${f(-L * 0.35)} ${f(w * 0.62)} 4 Q0 ${f(W * 0.2)} ${f(-w * 0.62)} 4Z`;
  }

  function ear(side, o) {
    const s = side;
    const far = o.yaw * s < 0; // the ear on the side the head turns away from
    const yawAbs = Math.abs(o.yaw);
    const base = { x: (34 - (far ? 10 * yawAbs : -4 * yawAbs)) * s + o.yaw * 18, y: -42 };
    let ang = (o.earAngle + (s < 0 ? o.earL : o.earR)) + (far ? 20 * yawAbs : 0);
    const sc = (far ? 1 - 0.15 * yawAbs : 1);
    const L = o.earLen, W = 72;
    return `<g transform="translate(${f(base.x)} ${base.y}) rotate(${f(ang * s)}) scale(${f(sc)} ${f(sc * o.earSquash)})">` +
      `<g class="kasi-ear ${s < 0 ? 'kasi-ear-l' : 'kasi-ear-r'}">` +
      `<path d="${spoon(L, W, 0.65)}" fill="${C.fur}"/>` +
      `<path d="${spoon(L * 0.74, W * 0.6, 0.7)}" transform="translate(0 -8)" fill="${C.earIn}"/>` +
      `<path d="M${-W * 0.17} ${f(-L * 0.42)} Q0 ${f(-L * 0.5)} ${W * 0.17} ${f(-L * 0.42)} M${-W * 0.14} ${f(-L * 0.62)} Q0 ${f(-L * 0.69)} ${W * 0.14} ${f(-L * 0.62)}" fill="none" stroke="${C.shade}" stroke-width="3" stroke-linecap="round"/>` +
      `</g></g>`;
  }

  function eye(side, o) {
    const small = o.small;
    const R = small ? 32 : o.eyeR;
    const far = o.yaw * side < 0;
    const sx = 1 - (far ? 0.4 : 0.08) * Math.abs(o.yaw);
    const cx = o.eyeX * side + o.yaw * 18 - (far ? 0 : 0), cy = 2;
    const gx = o.gaze[0] * 3.4, gy = o.gaze[1] * 3.4;
    const id = `${o.uid}-e${side < 0 ? 'l' : 'r'}`;
    if (o.eyes === 'happy') return `<path d="M${cx - 15} ${cy + 6} Q${cx} ${cy - 15} ${cx + 15} ${cy + 6}" fill="none" stroke="${C.ink}" stroke-width="7" stroke-linecap="round"/>`;
    if (o.eyes === 'closed') return `<path d="M${cx - 16} ${cy - 1} Q${cx} ${cy + 12} ${cx + 16} ${cy - 1}" fill="none" stroke="${C.ink}" stroke-width="6" stroke-linecap="round"/>`;
    if (o.eyes === 'squeeze') {
      const d = side < 0 ? `M${cx - 13} ${cy - 10} L${cx + 9} ${cy} L${cx - 13} ${cy + 10}` : `M${cx + 13} ${cy - 10} L${cx - 9} ${cy} L${cx + 13} ${cy + 10}`;
      return `<path d="${d}" fill="none" stroke="${C.ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    // A fully shut eye is a lash line, not a fur disc (a disc reads as sunglasses).
    if (o.lids >= 0.9) return `<path d="M${f(cx - R * 0.62)} ${cy + 2} Q${f(cx)} ${f(cy + R * 0.42)} ${f(cx + R * 0.62)} ${cy + 2}" fill="none" stroke="${C.deep}" stroke-width="5" stroke-linecap="round"/>`;
    const rx = R * sx;
    const lid = Math.max(0, Math.min(1, o.lids));
    let g = `<g class="kasi-eye"><clipPath id="${id}"><ellipse cx="${f(cx)}" cy="${cy}" rx="${f(rx)}" ry="${R}"/></clipPath>`;
    g += small ? '' : `<ellipse cx="${f(cx)}" cy="${cy}" rx="${f(rx)}" ry="${R}" fill="${C.amber}"/>`;
    const pr = small ? R : R - 3;
    g += `<g clip-path="url(#${id})"><g class="kasi-look" style="transform:translate(${f(gx)}px,${f(gy)}px)">` +
      `<ellipse cx="${f(cx)}" cy="${cy}" rx="${f(pr * o.pupil * sx)}" ry="${f(pr * o.pupil)}" fill="${C.ink}"/>` +
      `<ellipse cx="${f(cx - R * 0.33 * sx)}" cy="${f(cy - R * 0.36)}" rx="${f(R * 0.27 * sx)}" ry="${f(R * 0.24)}" fill="${C.hi}"/>` +
      `<circle cx="${f(cx + R * 0.33 * sx)}" cy="${f(cy + R * 0.33)}" r="${f(R * 0.1)}" fill="${C.hi}" opacity=".85"/></g>`;
    if (lid > 0) {
      const top = cy - R - 2, y = top + lid * (2 * R + 4), sag = R * 0.3 * (1 - Math.abs(lid - 0.5));
      g += `<path d="M${f(cx - rx - 2)} ${top} H${f(cx + rx + 2)} V${f(y)} Q${f(cx)} ${f(y + sag)} ${f(cx - rx - 2)} ${f(y)}Z" fill="${C.fur}"/>` +
        `<path d="M${f(cx - rx - 2)} ${f(y)} Q${f(cx)} ${f(y + sag)} ${f(cx + rx + 2)} ${f(y)}" fill="none" stroke="${C.deep}" stroke-width="3.2"/>`;
    }
    return g + '</g></g>';
  }

  function head(o) {
    const yaw = o.yaw, sh = yaw * 18;
    let g = `<g class="kasi-head" transform="rotate(${f(o.tilt)})">`;
    if (o.back) {
      g += ear(-1, o) + ear(1, o) + `<ellipse cx="0" cy="0" rx="70" ry="61" fill="${C.fur}"/>`;
      g += `<path d="M-30 -44 Q0 -54 30 -44 M-20 -30 Q0 -36 20 -30" fill="none" stroke="${C.shade}" stroke-width="4" stroke-linecap="round"/>`;
      g += `<path d="M-6 -58 C-12 -84 4 -104 20 -92 C11 -93 3 -86 6 -74 C8 -66 7 -61 6 -58Z" fill="${C.fur}"/>`;
      return g + '</g>';
    }
    g += ear(-1, o) + ear(1, o);
    if (o.pencil) g += `<g transform="translate(${f(56 + sh * 0.3)} -50) rotate(62)"><rect x="-6" y="-44" width="12" height="74" rx="3" fill="${C.accent}"/><path d="M-6 30 L0 42 L6 30Z" fill="${C.mask}"/><path d="M-2 38 L0 42 L2 38Z" fill="${C.ink}"/><rect x="-6" y="-50" width="12" height="9" rx="3" fill="${C.deep}"/><path d="M-1.5 -40 V26" stroke="#E9B826" stroke-width="2"/></g>`;
    g += `<ellipse cx="${f(sh * 0.25)}" cy="0" rx="${f(70 - Math.abs(yaw) * 4)}" ry="61" fill="${C.fur}"/>`;
    // one tall curl on top: the silhouette's signature
    g += `<path class="kasi-curl" d="M-6 -58 C-12 -84 4 -104 20 -92 C11 -93 3 -86 6 -74 C8 -66 7 -61 6 -58Z" transform="translate(${f(sh * 0.4)} 0)" fill="${C.fur}"/>`;
    // face plate; its top edge is the brow line
    const b = o.brow; // {dip, bump, inner}
    const fp = `M-63 -2 C-64 -30 -44 ${b.bump} -24 ${b.bump + 6 + b.inner} Q0 ${b.dip} 24 ${b.bump + 6 + b.inner} C44 ${b.bump} 64 -30 63 -2 C62 30 36 50 0 50 C-36 50 -62 30 -63 -2Z`;
    g += `<path d="${fp}" transform="translate(${f(sh)} 0) scale(${f(1 - Math.abs(yaw) * 0.12)} 1)" fill="${C.mask}"/>`;
    g += eye(-1, o) + eye(1, o);
    const nx = sh * 1.15;
    g += `<path d="M${f(nx - 5)} 27 Q${f(nx)} 24 ${f(nx + 5)} 27 Q${f(nx + 3)} 32 ${f(nx)} 32.5 Q${f(nx - 3)} 32 ${f(nx - 5)} 27Z" fill="${C.ink}"/>`;
    if (o.mouth === 'small') g += `<path d="M${f(nx - 5)} 39 Q${f(nx)} 42.5 ${f(nx + 5)} 39" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/>`;
    if (o.mouth === 'open') g += `<ellipse cx="${f(nx)}" cy="41" rx="5.5" ry="6" fill="${C.ink}"/>`;
    if (o.mouth === 'o') g += `<circle cx="${f(nx)}" cy="41" r="3.6" fill="${C.ink}"/>`;
    if (o.mouth === 'grin') g += `<path d="M${f(nx - 9)} 37 Q${f(nx)} 48 ${f(nx + 9)} 37Z" fill="${C.ink}"/>`;
    return g + '</g>';
  }

  function hand(x, y, a, pads = true) {
    // palm + three short fingers with round pads, pointing along local -y, rotated by a
    let g = `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(a)})">`;
    [[-7, -12], [0, -15], [7, -12]].forEach(([fx, fy]) => {
      g += `<path d="M0 -2 L${fx} ${fy}" stroke="${C.fur}" stroke-width="6" stroke-linecap="round"/><circle cx="${f(fx * 1.06)}" cy="${f(fy * 1.06)}" r="6" fill="${C.fur}"/>`;
      if (pads) g += `<circle cx="${f(fx * 1.06)}" cy="${f(fy * 1.06 - 0.5)}" r="3.2" fill="${C.earIn}"/>`;
    });
    return g + `<circle r="8.5" fill="${C.fur}"/></g>`;
  }
  const curve = (d, w = 14, col) => `<path d="${d}" fill="none" stroke="${col || C.fur}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const tail = (d, tip) => curve(d, 5.5, C.shade) + `<path d="M0 0 C-7 -6 -8 -20 0 -30 C8 -20 7 -6 0 0Z" transform="translate(${tip[0]} ${tip[1]}) rotate(${tip[2]})" fill="${C.shade}"/>`;

  // Body hanging under the pill, in head space with the head at (0, 14).
  function hangBody(o) {
    let g = '';
    g += tail('M8 140 C 44 168, -14 196, 18 226 S 52 262, 22 292', [22, 292, 200]);
    // frog legs: one long, one tucked
    g += curve('M-28 112 L-62 150 L-40 192', 15) + `<ellipse cx="-36" cy="196" rx="22" ry="9" fill="${C.fur}"/>`;
    g += curve('M28 112 L60 138 L42 166', 15) + `<ellipse cx="40" cy="170" rx="22" ry="9" transform="rotate(-14 40 170)" fill="${C.fur}"/>`;
    g += `<path d="M-40 52 C-58 96 -48 142 0 148 C48 142 58 96 40 52Z" fill="${C.fur}"/>`;
    g += `<path d="M-23 92 C-29 112 -22 132 0 136 C22 132 29 112 23 92Z" fill="${C.mask}"/>`;
    return g;
  }

  const POSES = {
    head: { frame: 'head' },
    mark: { frame: 'head', small: true, mouth: 'none' },
    hang: { frame: 'hang', arms: 'both', earAngle: 34 },
    write: { frame: 'hang', arms: 'both', pencil: true, earAngle: 30, gaze: [-0.2, -1], mouth: 'small' },
    scribe: { frame: 'head', pencil: true, gaze: [-0.4, 0.9], mouth: 'small', earAngle: 32 },
    hush: { frame: 'sit', arms: 'ears', earAngle: 112, earSquash: 0.8, eyes: 'squeeze', mouth: 'small' },
    sit: { frame: 'sit', arms: 'down', earAngle: 34 },
    doze: { frame: 'head', lids: 0.62, earAngle: 40, earSquash: 0.6, mouth: 'none', brow: { dip: -18, bump: -34, inner: 2 } },
    listen: { frame: 'head', earAngle: 22, pupil: 1.06, mouth: 'o', brow: { dip: -30, bump: -45, inner: 0 } },
    happy: { frame: 'head', eyes: 'happy', mouth: 'grin', earAngle: 30 },
    think: { frame: 'head', gaze: [-0.8, -1], lids: 0.18, mouth: 'none', earAngle: 32, tilt: -8, brow: { dip: -18, bump: -40, inner: -2 } },
    worry: { frame: 'head', brow: { dip: -14, bump: -36, inner: 6 }, earAngle: 40, mouth: 'small' }
  };

  function svg(input = {}) {
    const preset = POSES[input.pose || 'head'] || {};
    const o = Object.assign({
      uid: 'k' + Math.random().toString(36).slice(2, 8), frame: 'head', small: false,
      eyeR: 30, eyeX: 33.5, earAngle: 36, earL: 0, earR: 0, earLen: 70, earSquash: 1,
      gaze: [0, 0], pupil: 1, lids: 0, eyes: 'open', mouth: 'small', yaw: 0, back: false, tilt: 0,
      brow: { dip: -22, bump: -38, inner: 0 }, arms: 'none', swing: 0, pill: false, title: 'Kasi'
    }, preset, input);
    if (input.brow) o.brow = Object.assign({ dip: -22, bump: -38, inner: 0 }, preset.brow || {}, input.brow);
    let vb = '-104 -118 208 190', body = '';
    if (o.frame === 'hang') {
      vb = '-150 -150 300 470';
      const top = -96;
      if (o.pill) body += `<rect x="-150" y="${top - 50}" width="300" height="50" rx="25" fill="${C.ink}"/>`;
      const grip = o.arms === 'write' ? [62, -92] : [0, -92];
      let fig = hangBody(o);
      if (o.arms === 'both') {
        fig += curve('M-44 40 Q-90 -14 -62 -92', 14) + curve('M44 40 Q90 -14 62 -92', 14);
      } else {
        fig += curve('M44 40 Q90 -14 62 -92', 14);
      }
      fig += `<g transform="translate(0 14)">${head(Object.assign({}, o, { tilt: o.tilt + (o.arms === 'both' ? 6 : -4) }))}</g>`;
      if (o.arms === 'both') fig += hand(-62, -92, 0) + hand(62, -92, 0);
      else fig += hand(62, -92, 0);
      body += `<g transform="rotate(${o.swing} ${grip[0]} ${grip[1]})">${fig}</g>`;
      if (o.arms === 'write') {
        const sh = rot(-44, 40, grip[0], grip[1], o.swing);
        const hx = -86, hy = top + 18;
        body += curve(`M${f(sh[0])} ${f(sh[1])} Q${f(sh[0] - 46)} ${f((sh[1] + hy) / 2)} ${hx} ${hy}`, 14);
        // the yellow underline it draws on the pill's underside
        body += `<path d="M-128 ${top + 5} H${hx - 4}" stroke="${C.accent}" stroke-width="5" stroke-linecap="round"/>`;
        body += `<g transform="translate(${hx - 4} ${top + 6}) rotate(28)"><rect x="-7" y="0" width="14" height="58" rx="3" fill="${C.accent}"/><path d="M-7 0 L0 -12 L7 0Z" fill="${C.mask}"/><path d="M-2.4 -7.8 L0 -12 L2.4 -7.8Z" fill="${C.ink}"/><rect x="-7" y="52" width="14" height="10" rx="3" fill="${C.deep}"/></g>`;
        body += hand(hx, hy + 6, -150);
      }
    } else if (o.frame === 'sit') {
      vb = '-140 -132 280 316';
      body += tail('M34 150 C 92 154, 116 112, 104 70', [104, 70, 8]);
      body += curve('M-30 120 L-66 136 L-44 162', 15) + curve('M30 120 L66 136 L44 162', 15);
      body += `<ellipse cx="-44" cy="166" rx="22" ry="9" fill="${C.fur}"/><ellipse cx="44" cy="166" rx="22" ry="9" fill="${C.fur}"/>`;
      body += `<path d="M-40 50 C-58 96 -48 152 0 156 C48 152 58 96 40 50Z" fill="${C.fur}"/><path d="M-23 92 C-29 116 -22 140 0 144 C22 140 29 116 23 92Z" fill="${C.mask}"/>`;
      body += head(o);
      if (o.arms === 'ears') {
        body += curve('M-40 84 Q-92 60 -76 -10', 14) + curve('M40 84 Q92 60 76 -10', 14);
        body += hand(-74, -22, 20) + hand(74, -22, -20);
      } else if (o.arms === 'down') {
        body += curve('M-38 84 Q-46 110 -26 130', 14) + curve('M38 84 Q46 110 26 130', 14);
        body += hand(-24, 134, 160) + hand(24, 134, 200);
      }
    } else {
      body += head(o);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${o.title}">${body}</svg>`;
  }

  // The app icon: Kasi's head on an ink squircle, two pads holding a subtitle-yellow bar.
  function icon(size = 1024) {
    const head = svg({ pose: 'mark', mouth: 'small' }).replace(/^<svg[^>]*>|<\/svg>$/g, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}" role="img" aria-label="yravgSubMeetly">` +
      `<path d="M512 0C860 0 1024 164 1024 512S860 1024 512 1024 0 860 0 512 164 0 512 0Z" fill="${C.ink}"/>` +
      `<g transform="translate(512 470) scale(3.55)">${head}</g>` +
      `<rect x="232" y="806" width="560" height="96" rx="48" fill="${C.accent}"/>` +
      `<g transform="translate(360 812) scale(3.2)">${hand(0, 0, 180).replace(/fill="#E2AE7F"/g, 'fill="#E2AE7F"')}</g>` +
      `<g transform="translate(664 812) scale(3.2)">${hand(0, 0, 180)}</g>` +
      `</svg>`;
  }

  root.Kasi = { svg, icon, colors: C, POSES };
})(typeof window !== 'undefined' ? window : globalThis);
