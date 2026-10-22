// A tiny software 3D engine that draws into SVG. Meshes are projected and shaded on the
// CPU every frame, then written into a handful of <path> `d` attributes; there is no WebGL
// and no library. Parts are drawn back to front (painter's algorithm) and, inside a part,
// back faces are culled, which is enough for the convex-ish blobs a cartoon is made of.
//
// Each part is painted as: an ink-coloured stroke of all its visible faces (its outline),
// then the faces filled in three flat tone bands (shadow / base / light), then "decals"
// (spots, eyes, plate seams) that sit on its surface and are hidden when they turn away.

const NS = 'http://www.w3.org/2000/svg';

export const CAMERA = { dist: 10, focal: 960, cx: 500, cy: 335 };
const LIGHT = (() => {
  const v = [-0.35, 0.7, 0.62];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();

const r1 = (n) => Math.round(n * 10) / 10;

// the flat blue of a hand-inked cast shadow
const SHADOW = '#41538f';

// Andrew's monotone chain: convex hull of 2D points as an SVG path
function hullPath(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list) => {
    const out = [];
    list.forEach((p) => {
      while (out.length > 1) {
        const a = out[out.length - 2];
        const b = out[out.length - 1];
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 0) out.pop();
        else break;
      }
      out.push(p);
    });
    out.pop();
    return out;
  };
  const h = [...half(pts), ...half(pts.slice().reverse())];
  let d = '';
  h.forEach((p, k) => {
    d += `${k ? 'L' : 'M'}${r1(p[0])},${r1(p[1])}`;
  });
  return `${d}Z`;
}

// shade thresholds (n . light) between the shadow / base / light tone bands
const CUTS = [-0.4, 0.05];

const pathOf = (poly) => {
  let d = '';
  for (let k = 0; k < poly.length; k++) d += `${k ? 'L' : 'M'}${r1(poly[k][0])},${r1(poly[k][1])}`;
  return `${d}Z`;
};

// Sutherland-Hodgman against one shade threshold; points are [x, y, shade].
const clip = (poly, cut, keepAbove) => {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const aIn = keepAbove ? a[2] >= cut : a[2] <= cut;
    const bIn = keepAbove ? b[2] >= cut : b[2] <= cut;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const u = (cut - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, cut]);
    }
  }
  return out;
};

// ---------------------------------------------------------------------- matrices
// A transform is { r: row-major 3x3, t: translation }.
const mul3 = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
export const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
export const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];

export const IDENTITY = () => ({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
// position + Euler rotation in Y-X-Z order (yaw applied last, like a camera rig)
export const xf = (t, [rx, ry, rz] = [0, 0, 0]) => ({ r: mul3(mul3(rotY(ry), rotX(rx)), rotZ(rz)), t });
// camera rig that orbits `pivot`: yaw about the vertical, then pitch
export const view = (pitch, yaw, pivot = [0, 0, 0]) => {
  const r = mul3(rotX(pitch), rotY(yaw));
  return {
    r,
    t: [
      -(r[0] * pivot[0] + r[1] * pivot[1] + r[2] * pivot[2]),
      -(r[3] * pivot[0] + r[4] * pivot[1] + r[5] * pivot[2]),
      -(r[6] * pivot[0] + r[7] * pivot[1] + r[8] * pivot[2]),
    ],
  };
};
export const apply = (M, p) => [
  M.r[0] * p[0] + M.r[1] * p[1] + M.r[2] * p[2] + M.t[0],
  M.r[3] * p[0] + M.r[4] * p[1] + M.r[5] * p[2] + M.t[1],
  M.r[6] * p[0] + M.r[7] * p[1] + M.r[8] * p[2] + M.t[2],
];
const turn = (M, n) => [
  M.r[0] * n[0] + M.r[1] * n[1] + M.r[2] * n[2],
  M.r[3] * n[0] + M.r[4] * n[1] + M.r[5] * n[2],
  M.r[6] * n[0] + M.r[7] * n[1] + M.r[8] * n[2],
];
export const compose = (A, B) => {
  const t = apply(A, B.t);
  return { r: mul3(A.r, B.r), t };
};

// ------------------------------------------------------------------------ meshes
// `rows` are parameter values (e.g. latitudes); `fn(row, phi)` returns a point. The grid
// wraps around `nLon` columns. `cls(rowIndex)` picks a colour slot for that band of faces.
export function gridMesh(rows, nLon, fn, origin = [0, 0, 0], cls = () => 0) {
  const v = [];
  rows.forEach((u) => {
    for (let j = 0; j < nLon; j++) v.push(fn(u, (j / nLon) * Math.PI * 2));
  });
  const f = [];
  const c = [];
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < nLon; j++) {
      const j2 = (j + 1) % nLon;
      f.push([i * nLon + j, i * nLon + j2, (i + 1) * nLon + j2, (i + 1) * nLon + j]);
      c.push(cls(i));
    }
  }
  return finishMesh(v, f, c, origin);
}

// Computes face normals/centres and winds every face so it points away from `origin`.
function finishMesh(v, f, c, origin) {
  const n = [];
  const cen = [];
  let score = 0;
  f.forEach((face) => {
    const pts = face.map((i) => v[i]);
    let nx = 0;
    let ny = 0;
    let nz = 0;
    pts.forEach((p, k) => {
      const q = pts[(k + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const len = Math.hypot(nx, ny, nz) || 1;
    const normal = [nx / len, ny / len, nz / len];
    const centre = [0, 1, 2].map((a) => pts.reduce((s, p) => s + p[a], 0) / pts.length);
    score += normal[0] * (centre[0] - origin[0]) + normal[1] * (centre[1] - origin[1]) + normal[2] * (centre[2] - origin[2]);
    n.push(normal);
    cen.push(centre);
  });
  if (score < 0) {
    f.forEach((face) => face.reverse());
    n.forEach((m) => {
      m[0] = -m[0];
      m[1] = -m[1];
      m[2] = -m[2];
    });
  }
  // smooth vertex normals (welded by position so poles and seams shade evenly); they drive
  // the per-pixel-accurate band edges in render()
  const acc = new Map();
  const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
  f.forEach((face, i) => {
    face.forEach((vi) => {
      const k = key(v[vi]);
      const a = acc.get(k) || [0, 0, 0];
      a[0] += n[i][0];
      a[1] += n[i][1];
      a[2] += n[i][2];
      acc.set(k, a);
    });
  });
  const vn = v.map((p) => {
    const a = acc.get(key(p)) || [0, 1, 0];
    const l = Math.hypot(...a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  });
  return { v, f, c, n, cen, vn };
}

const range = (a, b, steps) => Array.from({ length: steps + 1 }, (_, i) => a + ((b - a) * i) / steps);

// Ellipsoid with its poles on +/-y.
export function ellipsoid(rx, ry, rz, nLat = 14, nLon = 28) {
  return gridMesh(range(0, Math.PI, nLat), nLon, (th, ph) => [
    rx * Math.sin(th) * Math.cos(ph),
    ry * Math.cos(th),
    rz * Math.sin(th) * Math.sin(ph),
  ]);
}

// ------------------------------------------------------------------------ colour
const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, k) => {
  const A = toRgb(a);
  const B = toRgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * k));
};
// shadow / base / light tones of one colour
export const ramp = (hex, shade = '#1d5a2e', amount = 0.3) => [mix(hex, shade, amount), hex, mix(hex, '#ffffff', 0.16)];

// ------------------------------------------------------------------------ scene
const el = (name, attrs, parent) => {
  const e = document.createElementNS(NS, name);
  Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
  if (parent) parent.appendChild(e);
  return e;
};

/**
 * parts: [{ mesh, ramps, anchor, world, decals?, ink? }]
 *   world   transform of the part (updated by the caller every frame)
 *   anchor  local point used to depth-sort the part against the others
 *   bias    added to the part's sort depth (positive = drawn earlier)
 *   tuck    limb that hides under the body when seen from above
 *   decals  [{ kind: 'poly', key, fill, pts, c, n } | { kind: 'line', key, stroke, width, runs: [[{ p, n }]] }]
 * ground: { y, kx, kz } casts a flat blue shadow onto the plane y = ground.y; the light pushes
 * it kx/kz sideways per unit of height. hand: wobble the whole drawing like a hand-inked figure.
 */
export function createSvgScene(svg, parts, { ink = '#231e16', inkWidth = 9, ground, hand = false } = {}) {
  const { dist: D, focal: F, cx: CX, cy: CY } = CAMERA;
  const root = el('g', {}, svg);

  // hand-drawn look: a slow wobble of every line plus a little paper grain (colorfigures' filter)
  if (hand) {
    const defs = el('defs', {}, svg);
    defs.innerHTML = `<filter id="svg3d-hand" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.036" numOctaves="2" seed="4" result="warp"/>
      <feDisplacementMap in="SourceGraphic" in2="warp" scale="3" xChannelSelector="R" yChannelSelector="G" result="wob"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" seed="11" result="n1"/>
      <feColorMatrix in="n1" type="matrix" values=".3 0 0 0 .84  .3 0 0 0 .84  .3 0 0 0 .84  0 0 0 0 1" result="grain"/>
      <feBlend in="wob" in2="grain" mode="multiply" result="g1"/>
      <feComposite in="g1" in2="wob" operator="in"/></filter>`;
    root.setAttribute('filter', 'url(#svg3d-hand)');
  }

  const shadow = ground ? el('path', { fill: SHADOW }, root) : null;

  const rig = parts.map((part) => {
    const group = el('g', {}, root);
    const inkPath = part.ink === false ? null : el('path', {
      fill: 'none', stroke: ink, 'stroke-width': inkWidth, 'stroke-linejoin': 'round',
    }, group);
    const fills = [];
    part.ramps.forEach((tones, slot) => {
      tones.forEach((color, band) => {
        fills[slot * 3 + band] = el('path', {
          fill: color, stroke: color, 'stroke-width': 1.4, 'stroke-linejoin': 'round',
        }, group);
      });
    });
    const decalPaths = new Map();
    (part.decals || []).forEach((d) => {
      if (decalPaths.has(d.key)) return;
      decalPaths.set(d.key, d.kind === 'poly'
        ? el('path', { fill: d.fill, stroke: d.fill, 'stroke-width': 1, 'stroke-linejoin': 'round' }, group)
        : el('path', { fill: 'none', stroke: d.stroke, 'stroke-width': d.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, group));
    });
    const n = part.mesh.v.length;
    return { part, group, inkPath, fills, decalPaths, nd: new Float64Array(n), sx: new Float64Array(n), sy: new Float64Array(n), cz: new Float64Array(n), depth: 0 };
  });

  let order = rig.map((_, i) => i);

  const facing = (p, n) => {
    const ex = -p[0];
    const ey = -p[1];
    const ez = D - p[2];
    return (n[0] * ex + n[1] * ey + n[2] * ez) / Math.hypot(ex, ey, ez);
  };
  const screen = (p, out) => {
    const s = F / (D - p[2]);
    out[0] = CX + p[0] * s;
    out[1] = CY - p[1] * s;
    return out;
  };
  const tmp = [0, 0];

  function render(V) {
    rig.forEach((item) => {
      const { part, sx, sy, cz } = item;
      const { mesh } = part;
      const M = compose(V, part.world);
      const { r, t } = M;

      for (let i = 0; i < mesh.v.length; i++) {
        const p = mesh.v[i];
        const x = r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + t[0];
        const y = r[3] * p[0] + r[4] * p[1] + r[5] * p[2] + t[1];
        const z = r[6] * p[0] + r[7] * p[1] + r[8] * p[2] + t[2];
        const s = F / (D - z);
        sx[i] = CX + x * s;
        sy[i] = CY - y * s;
        cz[i] = z;
      }

      // light direction in the part's own space, so each vertex's shade is one dot product
      const lx = r[0] * LIGHT[0] + r[3] * LIGHT[1] + r[6] * LIGHT[2];
      const ly = r[1] * LIGHT[0] + r[4] * LIGHT[1] + r[7] * LIGHT[2];
      const lz = r[2] * LIGHT[0] + r[5] * LIGHT[1] + r[8] * LIGHT[2];
      const { nd } = item;
      for (let i = 0; i < nd.length; i++) {
        const vn = mesh.vn[i];
        nd[i] = vn[0] * lx + vn[1] * ly + vn[2] * lz;
      }

      const buckets = item.fills.map(() => '');
      let outline = '';
      for (let i = 0; i < mesh.f.length; i++) {
        const n = turn(M, mesh.n[i]);
        const c = apply(M, mesh.cen[i]);
        if (n[0] * -c[0] + n[1] * -c[1] + n[2] * (D - c[2]) <= 0) continue;
        const face = mesh.f[i];
        const slot = mesh.c[i] * 3;
        let lo = 9;
        let hi = -9;
        const poly = face.map((vi) => {
          if (nd[vi] < lo) lo = nd[vi];
          if (nd[vi] > hi) hi = nd[vi];
          return [sx[vi], sy[vi], nd[vi]];
        });
        outline += pathOf(poly);
        // split the face along the shade thresholds so band edges are smooth curves
        for (let band = 0; band < 3; band++) {
          const from = band ? CUTS[band - 1] : -9;
          const to = band < 2 ? CUTS[band] : 9;
          if (hi < from || lo > to) continue;
          let piece = poly;
          if (lo < from) piece = clip(piece, from, true);
          if (hi > to) piece = clip(piece, to, false);
          if (piece.length > 2) buckets[slot + band] += pathOf(piece);
        }
      }
      buckets.forEach((d, i) => item.fills[i].setAttribute('d', d));
      if (item.inkPath) item.inkPath.setAttribute('d', outline);

      // decals
      const acc = new Map();
      (part.decals || []).forEach((dec) => {
        let d = acc.get(dec.key) || '';
        if (dec.kind === 'poly') {
          if (facing(apply(M, dec.c), turn(M, dec.n)) > 0.14) {
            dec.pts.forEach((p, k) => {
              const q = screen(apply(M, p), tmp);
              d += `${k ? 'L' : 'M'}${r1(q[0])},${r1(q[1])}`;
            });
            d += 'Z';
          }
        } else {
          dec.runs.forEach((run) => {
            let pen = false;
            run.forEach(({ p, n }) => {
              const P = apply(M, p);
              if (facing(P, turn(M, n)) > 0.08) {
                const q = screen(P, tmp);
                d += `${pen ? 'L' : 'M'}${r1(q[0])},${r1(q[1])}`;
                pen = true;
              } else {
                pen = false;
              }
            });
          });
        }
        acc.set(dec.key, d);
      });
      acc.forEach((d, key) => item.decalPaths.get(key).setAttribute('d', d));

      item.depth = D - apply(M, part.anchor)[2];
    });

    // Parts that interpenetrate (a neck sinking into a shell, a flipper rooted inside the body)
    // can't be ordered by depth alone. `bias` nudges a part's depth; `tuck` draws a limb
    // before the body whenever the camera is above, so the shell rim covers its root.
    const above = V.r[7] > -0.25;
    rig.forEach((item) => {
      const { bias = 0, tuck } = item.part;
      item.depth += bias + (tuck && above ? 100 : 0);
    });

    // painter's order: far parts first
    const next = rig.map((_, i) => i).sort((a, b) => rig[b].depth - rig[a].depth);
    if (next.some((v, i) => v !== order[i])) {
      next.forEach((i) => root.appendChild(rig[i].group));
      order = next;
    }

    if (shadow) {
      // every part's vertices pushed along the light onto the ground plane, then one flat hull
      const pts = [];
      rig.forEach(({ part }) => {
        const v = part.mesh.v;
        for (let i = 0; i < v.length; i += 7) {
          const w = apply(part.world, v[i]);
          const h = w[1] - ground.y;
          const q = screen(apply(V, [w[0] + h * ground.kx, ground.y, w[2] + h * ground.kz]), tmp);
          pts.push([q[0], q[1]]);
        }
      });
      shadow.setAttribute('d', hullPath(pts));
    }
  }

  return { render, destroy: () => root.remove() };
}
