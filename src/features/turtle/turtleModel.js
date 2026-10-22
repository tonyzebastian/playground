import { IDENTITY, compose, ellipsoid, gridMesh, xf } from './svg3d';

// A cartoon sea turtle, after a flat vector sticker. The turtle swims toward -x, +y is up and
// +z is its right side. The head and neck are ONE lofted tube, the shell is a squared-off dome,
// and the flippers are leaf-shaped paddles rooted inside the body, so nothing reads as a
// separate blob. Every part is a mesh for svg3d plus "decals" (eyes, mouth, spots, seams).

const INK = '#231e16';
const SPOT = '#3f7a35';
// light / mid / dark tones per material, in the spirit of the colorfigures palettes: a bright
// lit side, a mid band, and a very dark shaded side. Stored as [dark, mid, light] bands.
const tones = (l, m, d) => [d, m, l];
const COLORS = {
  head: tones('#b5de6c', '#8fc450', '#2b4a24'),
  flipper: tones('#a9d565', '#82b84a', '#2a4524'),
  dome: tones('#6fae55', '#4d9244', '#1b3a28'),
  rim: tones('#4e9046', '#397a3b', '#16301f'),
  belly: tones('#fbf6dc', '#ecdfb1', '#a8a07a'),
  cheek: '#f3a6bb',
};

const len = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => v.map((c) => c / len(v));
const lerp = (a, b, k) => a + (b - a) * k;

// Direction -> point on an ellipsoid and its outward normal (used for the belly seams).
function onEllipsoid(radii, dir, lift = 1) {
  const d = unit(dir);
  const k = 1 / Math.sqrt((d[0] / radii[0]) ** 2 + (d[1] / radii[1]) ** 2 + (d[2] / radii[2]) ** 2);
  const p = d.map((c) => c * k * lift);
  return { p, n: unit([p[0] / radii[0] ** 2, p[1] / radii[1] ** 2, p[2] / radii[2] ** 2]) };
}

// ------------------------------------------------------------------ head + neck
// The side silhouette is traced from the reference: for each x, the top and bottom of the
// head/neck and its half-width. Cross-sections are ellipses, lofted into one smooth tube
// from the snout, over the cranium and down the neck, ending flush against the shell wall.
const HEAD_RINGS = [
  // x, top, bottom, half-width
  [-3.26, 0.9, 0.88, 0.02],
  [-3.2, 1.1, 0.68, 0.26],
  [-3.08, 1.38, 0.44, 0.46],
  [-2.9, 1.58, 0.28, 0.62],
  [-2.62, 1.71, 0.2, 0.72],
  [-2.3, 1.74, 0.16, 0.76],
  [-2.0, 1.64, 0.12, 0.72],
  [-1.76, 1.44, 0.08, 0.64],
  [-1.52, 1.2, 0.04, 0.58],
  [-1.36, 1.04, 0.03, 0.54],
  [-1.28, 0.98, 0.1, 0.46],
  [-1.22, 0.9, 0.3, 0.14],
];

const catmull = (p0, p1, p2, p3, t) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

function ringAt(t) {
  const n = HEAD_RINGS.length;
  const i = Math.min(n - 2, Math.floor(t));
  const f = t - i;
  const g = (k) => HEAD_RINGS[Math.max(0, Math.min(n - 1, k))];
  const [x, top, bot, zh] = [0, 1, 2, 3].map((c) => catmull(g(i - 1)[c], g(i)[c], g(i + 1)[c], g(i + 2)[c], f));
  return { x, yc: (top + bot) / 2, ry: Math.max(0.006, (top - bot) / 2), zh: Math.max(0.006, zh) };
}

const TABLE = Array.from({ length: 241 }, (_, i) => ringAt((i / 240) * (HEAD_RINGS.length - 1)));

function ringAtX(x) {
  if (x <= TABLE[0].x) return TABLE[0];
  if (x >= TABLE[240].x) return TABLE[240];
  let lo = 0;
  let hi = 240;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (TABLE[m].x <= x) lo = m;
    else hi = m;
  }
  const a = TABLE[lo];
  const b = TABLE[hi];
  const k = (x - a.x) / (b.x - a.x || 1);
  return { x, yc: lerp(a.yc, b.yc, k), ry: lerp(a.ry, b.ry, k), zh: lerp(a.zh, b.zh, k) };
}

function headMesh() {
  const rows = Array.from({ length: 48 }, (_, k) => (k / 47) * (HEAD_RINGS.length - 1));
  return gridMesh(
    rows,
    36,
    (t, ph) => {
      const r = ringAt(t);
      return [r.x, r.yc + r.ry * Math.cos(ph), r.zh * Math.sin(ph)];
    },
    [-2.0, 0.9, 0],
  );
}

// Surface helpers: pin a 2D idea ("a point at x, y on the cheek") onto the head.
const F = (x, y, z) => {
  const r = ringAtX(x);
  return ((y - r.yc) / r.ry) ** 2 + (z / r.zh) ** 2;
};
const headNormal = ([x, y, z]) => {
  const e = 0.01;
  return unit([F(x + e, y, z) - F(x - e, y, z), F(x, y + e, z) - F(x, y - e, z), F(x, y, z + e) - F(x, y, z - e)]);
};
const onSide = (x, y, side, lift = 1.006) => {
  const r = ringAtX(x);
  const dy = Math.max(-0.97, Math.min(0.97, (y - r.yc) / r.ry));
  return [x, y, side * r.zh * Math.sqrt(1 - dy * dy) * lift];
};
const onTop = (x, z, lift = 1.006) => {
  const r = ringAtX(x);
  const dz = Math.max(-0.97, Math.min(0.97, z / r.zh));
  return [x, r.yc + r.ry * Math.sqrt(1 - dz * dz) * lift, z];
};
const onFront = (y, z, lift = 1.006) => {
  let x = -2.6;
  for (let s = -2.6; s >= -3.26; s -= 0.005) {
    if (F(s, y, z) <= 1) x = s;
    else break;
  }
  return [x * lift, y, z];
};
const centroid = (pts) => [0, 1, 2].map((a) => pts.reduce((s, p) => s + p[a], 0) / pts.length);
const decalPoly = (pts, fill, key) => {
  const c = centroid(pts);
  return { kind: 'poly', key, fill, pts, c, n: headNormal(c) };
};
const decalRun = (pts) => pts.map((p) => ({ p, n: headNormal(p) }));

function headDecals() {
  const decals = [];

  // dark spots on the crown, scattered to both sides so they read from any angle
  [
    [-2.9, 0.3, 0.075],
    [-2.62, 0.46, 0.06],
    [-2.4, 0.26, 0.08],
    [-2.15, 0.5, 0.055],
    [-2.75, 0.56, 0.05],
    [-2.5, 0.05, 0.05],
  ].forEach(([x, z, r]) => {
    [1, -1].forEach((side) => {
      const pts = Array.from({ length: 12 }, (_, k) => {
        const a = (k / 12) * Math.PI * 2;
        return onTop(x + Math.cos(a) * r * 1.2, side * z + Math.sin(a) * r, 1.004);
      });
      decals.push(decalPoly(pts, SPOT, 'spot'));
    });
  });

  const ellipse = (cx, cy, rx, ry, side, lift) => Array.from({ length: 14 }, (_, k) => {
    const a = (k / 14) * Math.PI * 2;
    return onSide(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, side, lift);
  });
  const arch = (cx, cy, rx, ry, from, to, side, lift = 1.012) => {
    const pts = [];
    for (let a = from; a <= to; a += 12) {
      const r = (a * Math.PI) / 180;
      pts.push(onSide(cx + Math.cos(r) * rx, cy + Math.sin(r) * ry, side, lift));
    }
    return decalRun(pts);
  };
  [1, -1].forEach((side) => {
    // closed mouth: one smile line that curls up into the cheek
    const lip = [[-3.2, 0.78], [-3.02, 0.7], [-2.78, 0.67], [-2.56, 0.73], [-2.43, 0.86], [-2.4, 0.95]].map(([x, y]) => onSide(x, y, side, 1.012));
    decals.push({ kind: 'line', key: 'lip', stroke: INK, width: 5, runs: [decalRun(lip)] });
    decals.push(decalPoly(ellipse(-2.68, 0.99, 0.17, 0.08, side, 1.004), COLORS.cheek, 'cheek'));

    // happy closed eye: a thick arch, a fan of lashes at the outer corner and a brow crease
    decals.push({ kind: 'line', key: 'eye', stroke: INK, width: 7, runs: [arch(-2.24, 1.12, 0.23, 0.15, 12, 168, side)] });
    const lashes = [[[-2.02, 1.15], [-1.92, 1.22]], [[-2.01, 1.12], [-1.9, 1.13]], [[-2.03, 1.09], [-1.94, 1.03]]];
    decals.push({
      kind: 'line',
      key: 'lash',
      stroke: INK,
      width: 3.4,
      runs: lashes.map((l) => decalRun(l.map(([x, y]) => onSide(x, y, side, 1.012)))),
    });
    decals.push({ kind: 'line', key: 'brow', stroke: INK, width: 3, runs: [arch(-2.26, 1.38, 0.2, 0.06, 20, 160, side)] });
  });

  // closed mouth seen head-on, with two small nostrils
  const smile = Array.from({ length: 9 }, (_, k) => {
    const z = -0.16 + k * 0.04;
    return onFront(0.66 + 2.5 * z * z, z, 1.012);
  });
  decals.push({ kind: 'line', key: 'lip', stroke: INK, width: 5, runs: [decalRun(smile)] });
  [-1, 1].forEach((side) => {
    const nostril = Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * Math.PI * 2;
      return onFront(0.88 + Math.sin(a) * 0.03, side * 0.07 + Math.cos(a) * 0.025, 1.004);
    });
    decals.push(decalPoly(nostril, INK, 'nostril'));
  });

  return decals;
}

// ------------------------------------------------------------------------ shell
// A rounded, organic dome: an ellipsoid whose front wall (where the neck comes out) is squared
// off a little, so the neck sinks into it while the sides and back stay softly round.
const SHELL = [1.5, 1.2, 1.15];
const FRONT_SQUARE = 0.9;
const RIM = 0.9; // normalised radius where the dark marginal band starts

// Dome height at a point of the normalised (x, z) disc. The superellipse exponent is 2
// (a plain ellipsoid) everywhere except the front, where it grows toward 2.9.
const domeY = (nx, nz) => {
  const r = Math.hypot(nx, nz);
  const e = 2 + FRONT_SQUARE * Math.pow(Math.max(0, -nx / (r || 1)), 1.5);
  return SHELL[1] * Math.pow(Math.max(0, 1 - Math.pow(r, e)), 1 / e);
};

function shellMesh() {
  const th = Math.asin(RIM);
  const rows = [...Array.from({ length: 15 }, (_, i) => (th * i) / 14), ...[1, 2, 3].map((k) => th + ((Math.PI / 2 - th) * k) / 3)];
  return gridMesh(
    rows,
    64,
    (t, ph) => {
      const nx = Math.sin(t) * Math.cos(ph);
      const nz = Math.sin(t) * Math.sin(ph);
      return [SHELL[0] * nx, domeY(nx, nz), SHELL[2] * nz];
    },
    [0, 0, 0],
    (i) => (i < 14 ? 0 : 1),
  );
}

// Normal of the dome from the slope of domeY (central differences).
const domeNormal = (nx, nz) => {
  const h = 0.002;
  const dx = (domeY(nx + h, nz) - domeY(nx - h, nz)) / (2 * h * SHELL[0]);
  const dz = (domeY(nx, nz + h) - domeY(nx, nz - h)) / (2 * h * SHELL[2]);
  return unit([-dx, 1, -dz]);
};

// Hex plate seams, laid out top-down in the shell's normalised (x, z) disc and lifted onto the dome.
function shellSeams() {
  const lift = (nx, nz) => {
    const y = domeY(nx, nz) * 1.004;
    return { p: [nx * SHELL[0], y, nz * SHELL[2]], n: domeNormal(nx, nz) };
  };
  const R = 1 / 3;
  const DX = 1.5 * R;
  const DZ = Math.sqrt(3) * R;
  const seen = new Set();
  const runs = [];
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      const cx = i * DX;
      const cz = j * DZ + (i & 1 ? DZ / 2 : 0);
      const corners = Array.from({ length: 6 }, (_, k) => [cx + R * Math.cos((k * Math.PI) / 3), cz + R * Math.sin((k * Math.PI) / 3)]);
      for (let k = 0; k < 6; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 6];
        const key = [a, b].map((q) => q.map((c) => c.toFixed(3)).join(',')).sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        let cur = [];
        for (let s = 0; s <= 24; s++) {
          const nx = a[0] + ((b[0] - a[0]) * s) / 24;
          const nz = a[1] + ((b[1] - a[1]) * s) / 24;
          if (Math.hypot(nx, nz) <= RIM) {
            cur.push(lift(nx, nz));
          } else {
            if (cur.length > 1) runs.push(cur);
            cur = [];
          }
        }
        if (cur.length > 1) runs.push(cur);
      }
    }
  }
  const ring = Array.from({ length: 97 }, (_, k) => lift(Math.cos((k / 96) * Math.PI * 2) * RIM, Math.sin((k / 96) * Math.PI * 2) * RIM));
  return [
    { kind: 'line', key: 'seam-ink', stroke: INK, width: 2.6, runs: [...runs, ring] },
  ];
}

// ------------------------------------------------------------------------ belly
const BELLY = [1.48, 0.22, 1.1];

// The plastron's dividing lines, seen as short slanted strokes on the strip under the shell rim.
function bellySeams() {
  const runs = [];
  [-0.55, 0.2, 0.9].forEach((xs) => {
    [1, -1].forEach((side) => {
      const sk = Math.sqrt(1 - (xs / BELLY[0]) ** 2);
      const run = [];
      for (let a = 4; a <= 72; a += 8) {
        const r = (a * Math.PI) / 180;
        const { p, n } = onEllipsoid(BELLY, [xs + a * 0.0035, -BELLY[1] * sk * Math.sin(r) * 1.0, side * BELLY[2] * sk * Math.cos(r)], 1.012);
        run.push({ p, n });
      }
      runs.push(run);
    });
  });
  return [{ kind: 'line', key: 'plastron', stroke: INK, width: 2.6, runs }];
}

// --------------------------------------------------------------------- flippers
// A leaf: widest a little way out from the shoulder, tapering to a tip that sweeps back and
// curls down. Built along +z (or -z for the left side) so the pivot rotates it like an oar.
function flipper({ length, width, thick, side, spots }) {
  const shape = (xs, ys, zs) => {
    const t = ((zs + 1) / 2) ** 1.35;
    return [
      xs * width * (1 - 0.45 * t) + 0.2 * length * t * t,
      ys * thick * (1 - 0.4 * t) - 0.07 * length * t * t,
      side * t * length,
    ];
  };
  const mesh = gridMesh(
    Array.from({ length: 15 }, (_, i) => (i / 14) * Math.PI),
    18,
    (th, ph) => shape(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)),
    shape(0, 0, 0.1),
  );
  const decals = spots.map(([xs, zs, r]) => {
    const c = shape(xs, Math.sqrt(Math.max(0, 1 - xs * xs - zs * zs)) * 0.97, zs);
    const pts = Array.from({ length: 10 }, (_, k) => [c[0] + Math.cos((k / 10) * Math.PI * 2) * r, c[1], c[2] + Math.sin((k / 10) * Math.PI * 2) * r]);
    return { kind: 'poly', key: 'spot', fill: SPOT, pts, c, n: [0, 1, 0] };
  });
  return { mesh, decals };
}

// ------------------------------------------------------------------------ build
export function createTurtle() {
  const part = (mesh, colors, anchor, decals = [], extra = {}) => ({
    mesh, ramps: colors, anchor, decals, world: IDENTITY(), ...extra,
  });

  const shell = part(shellMesh(), [COLORS.dome, COLORS.rim], [0, 0.7, 0], shellSeams());
  const belly = part(ellipsoid(...BELLY, 10, 40), [COLORS.belly], [0, -0.25, 0], bellySeams());
  // bias: seen side-on the shell wall should cover the neck where it sinks in
  const headNeck = part(headMesh(), [COLORS.head], [-2.0, 0.9, 0], headDecals(), { bias: 1.2 });

  const frontSpots = [[0.1, -0.35, 0.07], [-0.3, 0.05, 0.06], [0.25, 0.3, 0.06], [-0.1, 0.6, 0.045]];
  const rearSpots = [[0.05, -0.2, 0.05], [-0.2, 0.3, 0.045]];
  const flippers = [1, -1].flatMap((side) => {
    const f = flipper({ length: 1.9, width: 0.62, thick: 0.12, side, spots: frontSpots });
    const r = flipper({ length: 1.5, width: 0.45, thick: 0.1, side, spots: rearSpots });
    return [
      { ...part(f.mesh, [COLORS.flipper], [0, 0, side * 0.9], f.decals, { tuck: true }), kind: 'front', side },
      { ...part(r.mesh, [COLORS.flipper], [0, 0, side * 0.7], r.decals, { tuck: true }), kind: 'rear', side },
    ];
  });

  const parts = [shell, belly, headNeck, ...flippers];

  const neckBase = [-1.3, 0.5, 0];
  const update = (t) => {
    const stroke = Math.sin(t * 2);
    const sweep = Math.cos(t * 2);
    const body = xf([0, Math.sin(t) * 0.07, 0], [0, 0, Math.sin(t + 0.6) * 0.03]);
    const at = (pos, rot) => compose(body, xf(pos, rot));

    shell.world = at([0, 0.1, 0]);
    belly.world = at([0, 0.02, 0]);
    // the head nods a little about the base of the neck
    headNeck.world = compose(at(neckBase, [0, 0, Math.sin(t - 0.4) * 0.04]), xf(neckBase.map((c) => -c)));
    flippers.forEach((f) => {
      const s = f.side;
      if (f.kind === 'front') {
        f.world = at([-1.2, 0.12, s * 0.7], [s * (0.55 + 0.35 * stroke), s * (0.8 + 0.15 * sweep), 0]);
      } else {
        f.world = at([1.1, 0.1, s * 0.65], [s * (0.25 + 0.2 * Math.sin(t * 2 - 1)), s * (1.1 + 0.1 * Math.cos(t * 2 - 1)), 0]);
      }
    });
  };
  update(0);

  return { parts, update, pivot: [-0.3, 0.1, 0], ground: { y: -1.25, kx: 0.2, kz: -0.12 } };
}
