// Small timing helpers: keyframe interpolation, cubic-bezier easing and a
// seeded random number, so the animation is the same on every replay.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Map `value` through keyframes `input` → `output`, clamped at both ends.
// The last argument is an easing function, or `{ easing }`, shaping each
// segment.
export function interpolate(value, input, output, options) {
  const easing = typeof options === "function" ? options : options?.easing;
  if (value <= input[0]) return output[0];
  const last = input.length - 1;
  if (value >= input[last]) return output[last];
  let i = 0;
  while (i < last - 1 && value > input[i + 1]) i++;
  const span = input[i + 1] - input[i];
  let t = span > 0 ? (value - input[i]) / span : 1;
  if (easing) t = easing(t);
  return output[i] + (output[i + 1] - output[i]) * t;
}

// CSS-style cubic-bezier(x1, y1, x2, y2).
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = clamp01(x);
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      const d = slopeX(t);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      t = clamp01(t - err / d);
    }
    return sampleY(t);
  };
}

// A number in [0, 1) that is always the same for the same seed string.
export function random(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // mulberry32 finish
  h += 0x6d2b79f5;
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
