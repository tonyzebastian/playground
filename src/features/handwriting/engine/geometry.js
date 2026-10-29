import { random } from "./anim";
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// Round off the polyline corners a little (Chaikin), keeping the ends.
const soften = (pts, passes) => {
  let out = pts;
  for (let p = 0; p < passes; p++) {
    if (out.length < 3)
      return out;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
};
// Re-space points evenly every `step` px so width and wiggle can be
// computed along the stroke.
const resample = (pts, step) => {
  const out = [pts[0]];
  const at = [0];
  let dist = 0;
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let s = step - carry;
    while (s <= seg) {
      const t = s / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      at.push(dist + s);
      s += step;
    }
    carry = seg - (s - step);
    dist += seg;
  }
  const last = pts[pts.length - 1];
  if (dist - at[at.length - 1] > step * 0.2) {
    out.push(last);
    at.push(dist);
  }
  // A dot (zero-length stroke) still needs two points.
  if (out.length === 1) {
    out.push({ x: last.x + step * 0.5, y: last.y });
    at.push(step * 0.5);
    dist = step * 0.5;
  }
  return { pts: out, at, length: Math.max(dist, at[at.length - 1]) };
};
// Lay a line of words out left to right. Sizes are in px; `size` is the em.
export const layoutWords = (font, words, size, tracking, wordGap) => {
  const s = size / font.unitsPerEm;
  const step = Math.max(1, size * 0.012);
  const space = (font.glyphs[" "]?.adv ?? 300) * s * wordGap;
  let x = 0;
  const out = [];
  words.forEach((word, wi) => {
    const start = x;
    const strokes = [];
    word.split("").forEach((ch, ci) => {
      const g = font.glyphs[ch] ?? font.glyphs["?"];
      if (!g)
        return;
      // Space letters by their drawn width, not the font's advance (which is
      // uneven in these single-line fonts).
      let minX = Infinity;
      let maxX = -Infinity;
      for (const flat of g.strokes) {
        for (let i = 0; i < flat.length; i += 2) {
          minX = Math.min(minX, flat[i]);
          maxX = Math.max(maxX, flat[i]);
        }
      }
      if (!isFinite(minX) || font.spacing === "advance") {
        minX = 0;
        maxX = g.adv;
      }
      const ox = x - minX * s;
      for (const flat of g.strokes) {
        const pts = [];
        for (let i = 0; i < flat.length; i += 2) {
          pts.push({ x: ox + flat[i] * s, y: -flat[i + 1] * s });
        }
        strokes.push(resample(soften(pts, 2), step));
      }
      x += (maxX - minX) * s;
      if (ci < word.length - 1)
        x += tracking * size;
    });
    out.push({ strokes, x: start, width: x - start });
    if (wi < words.length - 1)
      x += space;
  });
  return { words: out, width: x };
};
// The visible piece of a stroke between distances `from` and `to`, as a
// filled outline whose width follows `widthAt(s)`.
export const ribbon = (stroke, from, to, widthAt, offsetAt) => {
  const a = Math.max(0, from);
  const b = Math.min(stroke.length, to);
  if (b - a <= 0.01)
    return "";
  const pick = [];
  const pointAt = (s) => {
    let i = 1;
    while (i < stroke.at.length - 1 && stroke.at[i] < s)
      i++;
    const s0 = stroke.at[i - 1];
    const s1 = stroke.at[i];
    const t = s1 > s0 ? clamp01((s - s0) / (s1 - s0)) : 0;
    const p0 = stroke.pts[i - 1];
    const p1 = stroke.pts[i];
    return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
  };
  pick.push({ p: pointAt(a), s: a });
  for (let i = 0; i < stroke.pts.length; i++) {
    if (stroke.at[i] > a && stroke.at[i] < b)
      pick.push({ p: stroke.pts[i], s: stroke.at[i] });
  }
  pick.push({ p: pointAt(b), s: b });
  const pts = pick.map(({ p, s }) => {
    const o = offsetAt(s);
    return { x: p.x + o.x, y: p.y + o.y, s };
  });
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const half = widthAt(pts[i].s) / 2;
    left.push(`${(pts[i].x - dy * half).toFixed(2)} ${(pts[i].y + dx * half).toFixed(2)}`);
    right.push(`${(pts[i].x + dy * half).toFixed(2)} ${(pts[i].y - dx * half).toFixed(2)}`);
  }
  return `M ${left.join(" L ")} L ${right.reverse().join(" L ")} Z`;
};
const cubic = (a, b, c, d, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    });
  }
  return out;
};
const unit = (x, y) => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};
const endDir = (pts) => {
  const a = pts[Math.max(0, pts.length - 4)];
  const b = pts[pts.length - 1];
  return unit(b.x - a.x, b.y - a.y);
};
const startDir = (pts) => {
  const a = pts[0];
  const b = pts[Math.min(pts.length - 1, 3)];
  return unit(b.x - a.x, b.y - a.y);
};
export const buildTrack = (words, size, opt) => {
  const step = Math.max(1, size * 0.012);
  const pts = [];
  const join = [];
  const marks = [];
  const push = (list, ink) => {
    for (let i = pts.length ? 1 : 0; i < list.length; i++) {
      pts.push(list[i]);
      join.push(ink);
    }
  };
  // A smooth connector from the pen's last point into the next stroke.
  const bridge = (to, ink) => {
    const a = pts[pts.length - 1];
    const b = to[0];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const ta = endDir(pts);
    const tb = startDir(to);
    const k = Math.min(d * 0.45, size * 0.35);
    const curve = cubic(a, { x: a.x + ta.x * k, y: a.y + ta.y * k }, { x: b.x - tb.x * k, y: b.y - tb.y * k }, b, Math.max(2, Math.ceil(d / step)));
    push(curve, ink);
  };
  const all = words.flatMap((w, wi) => w.strokes.map((s, si) => ({ s, wi, si, last: si === w.strokes.length - 1 })));
  if (all.length === 0) {
    return { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }], at: [0, 1], length: 1, join: [0, 0], wordStart: [], wordEnd: [], textEnd: 1, tailLength: 0, time: [0, 1], duration: 1 };
  }
  // Lead-in: a short line sweeping in from the left into the first stroke.
  const first = all[0].s.pts;
  if (opt.lead > 0) {
    const p = first[0];
    pts.push({ x: p.x - opt.lead * size, y: p.y + size * 0.08 });
    join.push(1);
    pts.push({ x: p.x - opt.lead * size * 0.98, y: p.y + size * 0.08 });
    join.push(1);
    bridge(first, 1);
  }
  let lifted = false;
  for (const item of all) {
    if (pts.length) {
      // Ink the join only when the pen carries on forward (into the next
      // letter or word). Jumps back for a dot or a crossbar are pen lifts.
      const a = pts[pts.length - 1];
      const b = item.s.pts[0];
      const forward = b.x - a.x > -size * 0.04 && Math.abs(b.y - a.y) < size * 0.45;
      // After a dot or crossbar the pen lifts again, back to the main line.
      const between = item.si === 0;
      const ink = forward && !lifted ? (between ? opt.wordConnect : opt.connect) : 0;
      bridge(item.s.pts, ink);
      lifted = ink === 0 && !between && opt.connect > 0;
    }
    if (item.si === 0)
      marks.push({ word: item.wi, kind: "start", index: pts.length ? pts.length - 1 : 0 });
    push(item.s.pts, 1);
    if (item.last)
      marks.push({ word: item.wi, kind: "end", index: pts.length - 1 });
  }
  const textEndIndex = pts.length - 1;
  // Flourish: carry on past the last letter, then curl away.
  if (opt.tail.length > 0) {
    const a = pts[pts.length - 1];
    const t = endDir(pts);
    const L = opt.tail.length * size;
    const end = { x: a.x + L, y: a.y + opt.tail.drop * size };
    const curve = cubic(a, { x: a.x + t.x * L * 0.3, y: a.y + t.y * L * 0.3 }, { x: end.x - L * 0.45, y: end.y - size * 0.05 }, end, Math.max(4, Math.ceil(L / step)));
    push(curve, 1);
  }
  // Distances along the line.
  const at = [0];
  for (let i = 1; i < pts.length; i++) {
    at.push(at[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  // Ease ink between letters and inked connectors. Pen lifts stay empty.
  const r = Math.max(1, Math.round((size * 0.05) / step));
  const soft = join.map((_, i) => {
    if (join[i] === 1 || join[i] === 0)
      return join[i];
    let sum = 0;
    let n = 0;
    for (let j = i - r; j <= i + r; j++) {
      if (j >= 0 && j < join.length) {
        sum += join[j];
        n++;
      }
    }
    return sum / n;
  });
  // Each inked run (a letter, or letters joined together) lands and lifts
  // off with a slight taper.
  const taper = size * 0.06;
  for (let i = 0; i < soft.length;) {
    if (soft[i] <= 0) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < soft.length && soft[j + 1] > 0)
      j++;
    // Short marks (dots, commas) taper less so they don't vanish.
    const runTaper = Math.min(taper, (at[j] - at[i]) * 0.25);
    for (let k = i; k <= j; k++) {
      const edge = Math.min(at[k] - at[i], at[j] - at[k]);
      soft[k] *= runTaper > 0 ? 0.45 + 0.55 * smoothstep(0, runTaper, edge) : 1;
    }
    i = j + 1;
  }
  // Pen time: inked travel counts in full, pen lifts are near-instant, so
  // the next letter starts as soon as the last one is finished.
  const time = [0];
  for (let i = 1; i < pts.length; i++) {
    const inked = join[i - 1] > 0 && join[i] > 0;
    time.push(time[i - 1] + (at[i] - at[i - 1]) * (inked ? 1 : 0.02));
  }
  const wordStart = [];
  const wordEnd = [];
  for (const m of marks)
    (m.kind === "start" ? wordStart : wordEnd)[m.word] = time[m.index];
  const length = at[at.length - 1];
  const duration = time[time.length - 1];
  return {
    pts,
    at,
    length,
    join: soft,
    wordStart,
    wordEnd,
    textEnd: time[textEndIndex],
    tailLength: length - at[textEndIndex],
    time,
    duration,
  };
};
// Distance along the line at a given pen time.
export const distanceAtTime = (track, t) => {
  const { time, at } = track;
  if (t <= 0)
    return 0;
  if (t >= track.duration)
    return track.length;
  let lo = 0;
  let hi = time.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] < t)
      lo = mid;
    else
      hi = mid;
  }
  const f = time[hi] > time[lo] ? (t - time[lo]) / (time[hi] - time[lo]) : 0;
  return at[lo] + (at[hi] - at[lo]) * f;
};
// Value of a per-point array at distance s.
export const sampleAt = (track, values, s) => {
  const at = track.at;
  if (s <= 0)
    return values[0];
  if (s >= track.length)
    return values[values.length - 1];
  let lo = 0;
  let hi = at.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] < s)
      lo = mid;
    else
      hi = mid;
  }
  const t = at[hi] > at[lo] ? (s - at[lo]) / (at[hi] - at[lo]) : 0;
  return values[lo] + (values[hi] - values[lo]) * t;
};
// A wobble that drifts slowly along the line and re-rolls every boil step,
// so it looks redrawn by hand a few times a second.
export const makeWobble = (seed, boil, period, amp) => {
  const k = `${seed}-${boil}`;
  const f1 = (Math.PI * 2) / (period * (0.7 + random(`${k}-f1`) * 0.6));
  const f2 = (Math.PI * 2) / (period * (0.4 + random(`${k}-f2`) * 0.4));
  const p1 = random(`${k}-p1`) * Math.PI * 2;
  const p2 = random(`${k}-p2`) * Math.PI * 2;
  const p3 = random(`${k}-p3`) * Math.PI * 2;
  return (s) => ({
    x: amp * (Math.sin(s * f1 + p1) * 0.7 + Math.sin(s * f2 + p3) * 0.3),
    y: amp * (Math.cos(s * f1 * 0.9 + p2) * 0.7 + Math.sin(s * f2 * 1.1 + p1) * 0.3),
  });
};
