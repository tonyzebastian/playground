// Converts a handwriting/script font file into pen strokes in the browser,
// so any .ttf/.otf can be dropped into the tool. Each letter is filled into
// a bitmap, thinned to its one-pixel centre line, and traced into strokes in
// roughly the order a hand would write them.
//
// The same code runs as a Node script in the Motion repo
// (scripts/build-handwriting-from-font.mjs).

import opentype from "opentype.js";

const CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,'’!?-:;\"&()/";
const EM = 420; // bitmap size of one em, px
const PAD = 6;

// ─── Fill ──────────────────────────────────────────────────────────────
const flatten = (commands) => {
  const polys = [];
  let poly = [];
  let cx = 0;
  let cy = 0;
  for (const c of commands) {
    if (c.type === "M") {
      if (poly.length > 2) polys.push(poly);
      poly = [[c.x, c.y]];
    } else if (c.type === "L") {
      poly.push([c.x, c.y]);
    } else if (c.type === "Q") {
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const u = 1 - t;
        poly.push([u * u * cx + 2 * u * t * c.x1 + t * t * c.x, u * u * cy + 2 * u * t * c.y1 + t * t * c.y]);
      }
    } else if (c.type === "C") {
      for (let i = 1; i <= 14; i++) {
        const t = i / 14;
        const u = 1 - t;
        poly.push([
          u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        ]);
      }
    } else if (c.type === "Z") {
      if (poly.length > 2) polys.push(poly);
      poly = [];
      continue;
    }
    if (c.x !== undefined) {
      cx = c.x;
      cy = c.y;
    }
  }
  if (poly.length > 2) polys.push(poly);
  return polys;
};

// Non-zero fill of the outline into a bitmap.
const rasterize = (polys, x0, y0, W, H) => {
  const img = new Uint8Array(W * H);
  const edges = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      if (a[1] !== b[1]) edges.push([a[0] - x0, a[1] - y0, b[0] - x0, b[1] - y0]);
    }
  }
  for (let y = 0; y < H; y++) {
    const sy = y + 0.5;
    const hits = [];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
        hits.push({ x: ax + ((sy - ay) / (by - ay)) * (bx - ax), w: by > ay ? 1 : -1 });
      }
    }
    hits.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let i = 0; i < hits.length - 1; i++) {
      wind += hits[i].w;
      if (wind !== 0) {
        const from = Math.max(0, Math.ceil(hits[i].x - 0.5));
        const to = Math.min(W - 1, Math.floor(hits[i + 1].x - 0.5));
        for (let x = from; x <= to; x++) img[y * W + x] = 1;
      }
    }
  }
  return img;
};

// ─── Thin (Zhang–Suen) ─────────────────────────────────────────────────
const thin = (img, W, H) => {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : img[y * W + x]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      const kill = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!img[y * W + x]) continue;
          const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
          if (a !== 1) continue;
          if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
          kill.push(y * W + x);
        }
      }
      for (const i of kill) img[i] = 0;
      if (kill.length) changed = true;
    }
  }
  return img;
};

// ─── Trace ─────────────────────────────────────────────────────────────
const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const trace = (sk, W, H, stemPx) => {
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && sk[y * W + x] === 1;
  // Neighbours, skipping a diagonal when a corner pixel already links them.
  const nbrs = (i) => {
    const x = i % W;
    const y = (i / W) | 0;
    const out = [];
    for (const [dx, dy] of N8) {
      if (!on(x + dx, y + dy)) continue;
      if (dx && dy && (on(x + dx, y) || on(x, y + dy))) continue;
      out.push((y + dy) * W + x + dx);
    }
    return out;
  };
  const pixels = [];
  for (let i = 0; i < W * H; i++) if (sk[i]) pixels.push(i);
  const deg = new Map(pixels.map((i) => [i, nbrs(i).length]));
  const isNode = (i) => deg.get(i) !== 2;

  const seen = new Set();
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  let segs = [];
  const walk = (start, next) => {
    const path = [start, next];
    seen.add(key(start, next));
    let prev = start;
    let cur = next;
    while (!isNode(cur)) {
      const n = nbrs(cur).find((k) => k !== prev && !seen.has(key(cur, k)));
      if (n === undefined) break;
      seen.add(key(cur, n));
      path.push(n);
      prev = cur;
      cur = n;
      if (cur === start) break;
    }
    return path;
  };
  for (const i of pixels) {
    if (!isNode(i)) continue;
    for (const n of nbrs(i)) if (!seen.has(key(i, n))) segs.push(walk(i, n));
  }
  // Closed loops with no ends (an "o" drawn alone).
  for (const i of pixels) {
    if (isNode(i)) continue;
    const n = nbrs(i).find((k) => !seen.has(key(i, k)));
    if (n !== undefined) segs.push(walk(i, n));
  }

  const xy = (i) => [i % W, (i / W) | 0];
  // Junctions are often a small clump of pixels; treat a clump as one node.
  const nodeOf = new Map();
  let nodes = 0;
  const nodePixels = pixels.filter(isNode);
  for (const p of nodePixels) {
    if (nodeOf.has(p)) continue;
    const id = nodes++;
    const stack = [p];
    nodeOf.set(p, id);
    while (stack.length) {
      const q = stack.pop();
      const [qx, qy] = xy(q);
      for (const r of nodePixels) {
        if (nodeOf.has(r) || deg.get(r) < 3) continue;
        const [rx, ry] = xy(r);
        if (Math.abs(rx - qx) <= 3 && Math.abs(ry - qy) <= 3 && deg.get(q) >= 3) {
          nodeOf.set(r, id);
          stack.push(r);
        }
      }
    }
  }
  const endNode = (i) => nodeOf.get(i) ?? `p${i}`;

  // Drop short spurs (end → junction) left by thinning at stroke ends.
  const segLen = (s) => s.length;
  for (let pass = 0; pass < 2; pass++) {
    const count = new Map();
    for (const s of segs) {
      for (const e of [s[0], s[s.length - 1]]) count.set(endNode(e), (count.get(endNode(e)) ?? 0) + 1);
    }
    segs = segs.filter((s) => {
      const a = count.get(endNode(s[0]));
      const b = count.get(endNode(s[s.length - 1]));
      const spur = (a === 1 && b >= 3) || (b === 1 && a >= 3);
      return !(spur && segLen(s) < stemPx * 1.3);
    });
    // Join chains that now pass straight through a two-way node.
  }

  // Chain segments into strokes: start at the leftmost free end, and at
  // each crossing carry on along the straightest way.
  const used = new Array(segs.length).fill(false);
  const ends = (s) => [endNode(s[0]), endNode(s[s.length - 1])];
  const dirFrom = (pts) => {
    const a = xy(pts[0]);
    const b = xy(pts[Math.min(pts.length - 1, 6)]);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const strokes = [];
  while (used.some((u) => !u)) {
    // Prefer an open end (a node touched by one unused segment).
    const touch = new Map();
    segs.forEach((s, i) => {
      if (used[i]) return;
      for (const e of ends(s)) touch.set(e, (touch.get(e) ?? 0) + 1);
    });
    let best = null;
    segs.forEach((s, i) => {
      if (used[i]) return;
      for (const [pt, rev] of [[s[0], false], [s[s.length - 1], true]]) {
        const open = touch.get(endNode(pt)) === 1;
        const [x, y] = xy(pt);
        const score = (open ? 0 : 10000) + x + y * 0.15;
        if (!best || score < best.score) best = { i, rev, score };
      }
    });
    let path = segs[best.i].slice();
    if (best.rev) path.reverse();
    used[best.i] = true;
    const stroke = [...path];
    for (;;) {
      const at = endNode(stroke[stroke.length - 1]);
      const tail = stroke.slice(-7).reverse();
      const heading = dirFrom(tail).map((v) => -v);
      let pick = null;
      segs.forEach((s, i) => {
        if (used[i]) return;
        const [a, b] = ends(s);
        for (const [match, rev] of [[a, false], [b, true]]) {
          if (match !== at) continue;
          const p = rev ? s.slice().reverse() : s;
          const d = dirFrom(p);
          const dot = d[0] * heading[0] + d[1] * heading[1];
          if (!pick || dot > pick.dot) pick = { i, p, dot };
        }
      });
      if (!pick || pick.dot < -0.2) break;
      used[pick.i] = true;
      stroke.push(...pick.p.slice(1));
    }
    if (stroke.length >= 3 || strokes.length === 0) strokes.push(stroke.map(xy));
  }
  return strokes;
};

// Smooth out pixel stairs, then drop points that add nothing.
const smoothLine = (pts) => {
  const r = 3;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(pts.length - 1, i + r); j++) {
      sx += pts[j][0];
      sy += pts[j][1];
      n++;
    }
    return [sx / n, sy / n];
  });
};
const simplify = (pts, eps) => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let max = 0;
  let idx = 0;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    // A closed loop: split it at the point farthest from its start.
    let far = 1;
    let best = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify(pts.slice(far), eps)];
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
};


// ─── Build ─────────────────────────────────────────────────────────────
export function fontToStrokes(buffer, fallbackName = "Uploaded font") {
  const font = opentype.parse(buffer);
  const upm = font.unitsPerEm;
  const toUnits = upm / EM;
  const glyphs = {};
  let inkArea = 0;
  let inkLength = 0;
  for (const ch of CHARS) {
    const g = font.charToGlyph(ch);
    if (!g || g.index === 0) continue;
    const path = g.getPath(0, 0, EM);
    const bb = path.getBoundingBox();
    const adv = g.advanceWidth;
    if (!isFinite(bb.x1) || bb.x2 - bb.x1 < 1) {
      glyphs[ch] = { adv, strokes: [] };
      continue;
    }
    const x0 = Math.floor(bb.x1) - PAD;
    const y0 = Math.floor(bb.y1) - PAD;
    const W = Math.ceil(bb.x2) - x0 + PAD;
    const H = Math.ceil(bb.y2) - y0 + PAD;
    const img = rasterize(flatten(path.commands), x0, y0, W, H);
    const area = img.reduce((s, v) => s + v, 0);
    const sk = thin(img, W, H);
    const skLen = sk.reduce((s, v) => s + v, 0);
    if (/[a-z]/.test(ch)) {
      inkArea += area;
      inkLength += skLen;
    }
    // Pen width: the font's average once lowercase letters are measured
    // (they come first); a single dot's own estimate is meaningless.
    const own = skLen ? area / skLen : 4;
    const stemPx = inkLength > 0 ? Math.min(own, (inkArea / inkLength) * 1.5) : own;
    const strokes = trace(sk, W, H, stemPx)
      .map((s) => simplify(smoothLine(s), 0.6))
      .map((s) => {
        // A dot thins to almost nothing; give it a short pen dab instead.
        let len = 0;
        for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
        if (len >= stemPx * 1.2) return s;
        const cx = s.reduce((t, p) => t + p[0], 0) / s.length;
        const cy = s.reduce((t, p) => t + p[1], 0) / s.length;
        const h = stemPx * 0.55;
        return [[cx - h, cy + h * 0.35], [cx + h, cy - h * 0.35]];
      })
      .filter((s) => s.length >= 2)
      .map((s) => s.flatMap(([x, y]) => [
        Math.round((x + x0 + 0.5) * toUnits * 10) / 10,
        Math.round(-(y + y0 + 0.5) * toUnits * 10) / 10,
      ]));
    glyphs[ch] = { adv, strokes };
  }
  glyphs[" "] = { adv: font.charToGlyph(" ").advanceWidth || upm * 0.25, strokes: [] };
  glyphs["’"] ??= glyphs["'"];

  const xBox = font.charToGlyph("x").getBoundingBox();
  const out = {
    name: font.names.fullName?.en ?? fallbackName,
    license: "See the font's own licence",
    unitsPerEm: upm,
    xHeight: Math.round(xBox.y2),
    // Average pen width, as a fraction of the em.
    stem: Math.round((inkArea / Math.max(1, inkLength) / EM) * 1000) / 1000,
    spacing: "advance",
    glyphs,
  };
  return out;
}
