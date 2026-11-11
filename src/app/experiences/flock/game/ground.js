// The shape and colour of the land, as pure functions of world position.
// The flock flies toward -z; x runs across the route. Heights are in world
// units (a bird's wingspan is 5). Water sits at y = 0.
//
// Scenery changes by position: the route is cut into zones with noise-warped
// borders. Add a region by adding a BIOME id, a case in `relief` and `tint`,
// its prop rules in world.js, and listing it in `zoneAt`.
import { clamp, fbm, hash2, hex, lerp, mix3, noise2, ramp, smoothstep } from './noise';

export const BIOME = { MEADOW: 0, FARM: 1, FOREST: 2, WATER: 3, TOWN: 4, HIGHLAND: 5, HILLS: 6, AIRPORT: 7, BASIN: 8 };
const ZONE = 960; // length of one zone along the route
// The run opens in the last of a meadow, with the first waterfall just ahead (see START_Z).
const OPENING = [BIOME.MEADOW, BIOME.BASIN, BIOME.FARM, BIOME.HILLS, BIOME.TOWN, BIOME.AIRPORT, BIOME.WATER, BIOME.FOREST, BIOME.HIGHLAND];
export const START_Z = -800;
const zones = new Map();

function zoneBiome(i) {
  if (i < OPENING.length) return OPENING[Math.max(0, i)];
  if (zones.has(i)) return zones.get(i);
  const prev = zoneBiome(i - 1);
  // Any region but the last one; airports and basins stay a few regions apart.
  const recent = [prev, zoneBiome(i - 2), zoneBiome(i - 3)];
  const rare = [BIOME.AIRPORT, BIOME.BASIN];
  const options = Object.values(BIOME).filter((b) => b !== prev && !(rare.includes(b) && recent.includes(b)));
  const b = options[Math.floor(hash2(i, 77) * options.length)];
  zones.set(i, b);
  return b;
}

// -> { biome, other, blend }: `blend` is how much of `other` to mix into heights.
export function zoneAt(x, z) {
  const q = (-z + (noise2(x * 0.003, z * 0.003) - 0.5) * 260) / ZONE;
  const i = Math.floor(q);
  const f = q - i;
  const biome = zoneBiome(i);
  if (f < 0.1) return { biome, other: zoneBiome(i - 1), blend: 0.5 - f * 5 };
  if (f > 0.9) return { biome, other: zoneBiome(i + 1), blend: (f - 0.9) * 5 };
  return { biome, other: biome, blend: 0 };
}

// An airport fills the middle of its zone. Everything is laid out from the
// zone's start: `d` below is distance along the route into the zone. The
// runway runs along the route, left of the flight path; the taxiway, apron
// and terminal sit to its right.
export const AIRFIELD = {
  y: 3.2, // the field is dead flat at this height
  runway: { x: -30, half: 13, from: 230, to: 730 },
  taxiway: { x: -4, half: 4.5, from: 250, to: 710, links: [262, 480, 698] },
  apron: { x0: 4, x1: 64, from: 330, to: 630 },
  pad: { x0: 64, x1: 100, from: 300, to: 660 },
  road: { x0: 100, d: 480, half: 5 },
};

const zoneOf = (z) => Math.floor(-z / ZONE);

// The airport whose zone holds z, as { i, near, far } (the runway's two ends), or null.
export function airportAt(z) {
  const i = zoneOf(z);
  if (i < 0 || zoneBiome(i) !== BIOME.AIRPORT) return null;
  return { i, start: -i * ZONE, near: -i * ZONE - AIRFIELD.runway.from, far: -i * ZONE - AIRFIELD.runway.to };
}

// The airport the flock is coming up to, flying over, or has only just left.
export function airportNear(z, ahead = 1300, behind = 900) {
  for (let i = Math.max(0, zoneOf(z + behind)); i <= zoneOf(z - ahead); i++) {
    if (zoneBiome(i) === BIOME.AIRPORT) return airportAt(-(i + 0.5) * ZONE);
  }
  return null;
}

// What the airfield is made of at a point: '' off the field or on its grass.
export function paving(x, z) {
  const ap = airportAt(z);
  if (!ap) return '';
  const d = ap.start - z;
  const { runway, taxiway, apron, pad, road } = AIRFIELD;
  if (d > runway.from - 16 && d < runway.to + 16 && Math.abs(x - runway.x) < runway.half + 5) return 'runway';
  if (d > taxiway.from && d < taxiway.to && Math.abs(x - taxiway.x) < taxiway.half) return 'taxi';
  if (x > runway.x && x < taxiway.x && taxiway.links.some((l) => Math.abs(d - l) < taxiway.half)) return 'taxi';
  if (d > apron.from && d < apron.to && x >= apron.x0 - 2 && x < apron.x1) return 'apron';
  if (d > pad.from && d < pad.to && x >= pad.x0 && x < pad.x1) return 'pad';
  if (x >= road.x0 && Math.abs(d - road.d) < road.half) return 'road';
  return '';
}

// A basin is a stretch of country lying far below the rest. The land steps
// down a cliff into it and back up a cliff out of it, and the river goes over
// both as waterfalls. Flying on at the same height, the flock is suddenly very
// high. The water shader (materials.js) repeats this arithmetic: keep them in step.
export const BASIN = { drop: 80, fall: 26, from: 170, to: 790 };
const cliffWarp = (x) => 28 * Math.sin(x * 0.013 + 1.3) + 14 * Math.sin(x * 0.031 + 4);

// The basin whose zone holds z, as { start, in, out }: where the two cliffs stand before they are warped.
export function basinAt(z) {
  const i = zoneOf(z);
  if (i < 0 || zoneBiome(i) !== BIOME.BASIN) return null;
  return { i, start: -i * ZONE, in: -i * ZONE - BASIN.from, out: -i * ZONE - BASIN.to };
}
export function basinNear(z, ahead = 1700, behind = 900) {
  for (let i = Math.max(0, zoneOf(z + behind)); i <= zoneOf(z - ahead); i++) {
    if (zoneBiome(i) === BIOME.BASIN) return basinAt(-(i + 0.5) * ZONE);
  }
  return null;
}

// How far the land has dropped at a point: 0 up on the plateau, 1 on the basin floor.
export function sunk(x, z) {
  const b = basinAt(z);
  if (!b) return 0;
  const w = cliffWarp(x);
  return (1 - smoothstep(b.in - w - BASIN.fall, b.in - w, z)) * smoothstep(b.out - w, b.out - w + BASIN.fall, z);
}
// Where each waterfall goes over: [z, x] of the cliff top at the river.
export function fallsOf(b) {
  const at = (z0) => {
    let z = z0;
    for (let i = 0; i < 3; i++) z = z0 - cliffWarp(riverX(z));
    return [z, riverX(z)];
  };
  return [at(b.in), at(b.out)];
}

// The river wanders along the route; in the highlands it runs through the
// valley, and it swings wide to the left to pass an airport.
export function riverX(z) {
  const wander = 55 * Math.sin(z * 0.0045) + 25 * Math.sin(z * 0.0117 + 2);
  const i = zoneOf(z);
  if (i < 0 || zoneBiome(i) !== BIOME.AIRPORT) return wander;
  const f = -z / ZONE - i;
  return lerp(wander, -175, smoothstep(0, 0.2, f) * (1 - smoothstep(0.8, 1, f)));
}

function relief(b, x, z, n, n2, valley) {
  switch (b) {
    case BIOME.FARM:
      return 2.4 + (n - 0.5) * 5 + (n2 - 0.5) * 0.6;
    case BIOME.FOREST:
      return 3.4 + (n - 0.5) * 20 + (n2 - 0.5) * 3;
    case BIOME.WATER:
      return -5 + (n - 0.5) * 30 + (n2 - 0.5) * 2;
    case BIOME.TOWN:
      return 2.6 + (n - 0.5) * 4;
    case BIOME.HIGHLAND: {
      const ridge = 1 - Math.abs(2 * noise2(x * 0.012 + 40, z * 0.012) - 1);
      return 3 + valley * (Math.max(0, n - 0.28) * 62 + ridge * 7) + (n2 - 0.5) * 2;
    }
    case BIOME.HILLS: {
      // Round, rolling hills: broad humps with smaller ones riding on them.
      const hump = smoothstep(0.18, 0.8, noise2(x * 0.0085 + 70, z * 0.0085 + 20));
      // The hills crowd the river more closely than the mountains do.
      const open = smoothstep(12, 70, Math.abs(x - riverX(z)));
      return 2.6 + open * (hump * 31 + noise2(x * 0.021 + 5, z * 0.021 + 90) * 6) + (n2 - 0.5) * 1.4;
    }
    case BIOME.BASIN:
      // Low, wet country: ponds wherever it dips.
      return 2.2 + (n - 0.5) * 17 + (n2 - 0.5) * 2;
    case BIOME.AIRPORT:
      // Flat across the field, gently rolling beyond it.
      return AIRFIELD.y + (n - 0.5) * 10 * smoothstep(115, 250, Math.abs(x - 20));
    default:
      return 3 + (n - 0.5) * 20 + (n2 - 0.5) * 2.5;
  }
}

// Height and biome at a point, written into `out`: h is the height, `level`
// the height of the water there (0, or far lower in a basin), and `rel` the
// height above that water, which is what colours and planting go by.
export function sampleGround(x, z, out) {
  const zone = zoneAt(x, z);
  const n = fbm(x * 0.0055, z * 0.0055, 4);
  const n2 = noise2(x * 0.021, z * 0.021);
  const rd = Math.abs(x - riverX(z));
  const valley = smoothstep(18, 150, rd);
  let h = relief(zone.biome, x, z, n, n2, valley);
  if (zone.blend > 0) h = lerp(h, relief(zone.other, x, z, n, n2, valley), zone.blend);
  // Carve the river, except across open water.
  const w = 8 + 6 * n2;
  const k = 1 - smoothstep(w, w + 16, rd);
  const lake = zone.biome === BIOME.WATER ? 1 - zone.blend : zone.other === BIOME.WATER ? zone.blend : 0;
  let rel = lerp(h, Math.min(h, -2.4), k * (1 - lake));
  const s = sunk(x, z);
  // On a cliff the river cuts deeper, so the falling water always clears its bed.
  if (s > 0.01 && s < 0.99) rel = lerp(rel, Math.min(rel, -10), k);
  out.level = -BASIN.drop * s;
  out.rel = rel;
  out.h = rel + out.level;
  out.biome = zone.biome;
  return out;
}

const scratch = { h: 0, biome: 0, level: 0, rel: 0 };
export const heightAt = (x, z) => sampleGround(x, z, scratch).h;
export const levelAt = (x, z) => -BASIN.drop * sunk(x, z);
// The top of whatever is there, land or water.
export const floorAt = (x, z) => Math.max(sampleGround(x, z, scratch).h, scratch.level);
// Height above the local water.
export const relAt = (x, z) => sampleGround(x, z, scratch).rel;
export const biomeAt = (z) => zoneAt(0, z).biome;

// --------------------------------------------------------------------- colour
const pal = (list) => list.map(hex);
const P = {
  meadow: pal(['#2f6b2e', '#4b8a34', '#74ab42', '#a3c754', '#c9d870']),
  flowers: pal(['#f2d75c', '#f0a9b8', '#f4f1e2', '#c79be0']),
  crops: pal(['#7fb044', '#9cc34c', '#c4cf5c', '#e2c860', '#ecd884', '#b08a5c', '#5f9a3c', '#d9b862', '#8f6f4c', '#a9c95a']),
  hedge: hex('#2f5f2c'),
  track: hex('#e3d6ae'),
  forest: pal(['#173f25', '#1f5530', '#2e6f36', '#4a8a40']),
  clearing: pal(['#5d9a3e', '#86b84c', '#b5cf62']),
  town: pal(['#6fa246', '#8cba50', '#a9cb5e']),
  road: hex('#d9cbac'),
  high: pal(['#5f9440', '#86a04e', '#9c8a66', '#8f8478', '#aaa398', '#d5cfc2']),
  sand: hex('#ecdcb2'),
  wetSand: hex('#c9b88f'),
  shallow: hex('#7fcdbb'),
  mid: hex('#3d98aa'),
  deep: hex('#1d5a82'),
  dune: pal(['#b9bf74', '#8fae56', '#6f9a45']),
  hills: pal(['#5a963c', '#78ac46', '#9cc154', '#bfce6a', '#d6d488']),
  vine: hex('#3f7034'),
  soil: hex('#b89c6c'),
  stone: hex('#cfcbc0'),
  asphalt: hex('#54585c'),
  taxi: hex('#73777a'),
  concrete: hex('#b3b2ac'),
  pad: hex('#c6c2b8'),
  mown: pal(['#79ad4a', '#8fbd54']),
  basin: pal(['#2f6f34', '#4c8a3a', '#6fa544', '#93bd52']),
  cliff: pal(['#6f675d', '#8a8073', '#a39a8a', '#7d7468', '#b3aa9a']),
};

// Farmland: fields of uneven size and shape. The grid they come from is bent
// by noise and some neighbours are worked as one field. Returns the distance
// to the nearest boundary (hedges and tracks run there), whether that boundary
// is a track, the field's id (0-1) and coordinates that follow its furrows.
export function farmEdge(x, z) {
  const wx = x + (fbm(x * 0.007 + 3, z * 0.007, 2) - 0.5) * 110;
  const wz = z + (fbm(x * 0.007, z * 0.007 + 17, 2) - 0.5) * 110;
  const u = wx * 0.878 - wz * 0.479;
  const v = wx * 0.479 + wz * 0.878;
  const cv = Math.floor(v / 74);
  const wide = 40 + hash2(cv, 9) * 34; // each strip of fields has its own width
  const uo = u + hash2(cv, 3) * wide;
  const cu = Math.floor(uo / wide);
  const fu = uo / wide - cu;
  const fv = v / 74 - cv;
  const joined = (c) => hash2(c, cv + 31) > 0.62; // no boundary on this cell's left side
  let edge = Math.min(fv, 1 - fv) * 74;
  if (!joined(cu)) edge = Math.min(edge, fu * wide);
  if (!joined(cu + 1)) edge = Math.min(edge, (1 - fu) * wide);
  let first = cu;
  while (joined(first) && cu - first < 3) first--;
  return { edge, track: hash2(first + 5, cv) > 0.62, id: hash2(first, cv), u: uo, v };
}

// Town: distance to the nearest road. The roads wind: they are a loose grid
// bent by noise, with stretches left out so no two blocks match.
export function townRoad(x, z) {
  const wx = x + (fbm(x * 0.006 + 11, z * 0.006, 2) - 0.5) * 170;
  const wz = z + (fbm(x * 0.006, z * 0.006 + 23, 2) - 0.5) * 170;
  const cx = Math.floor(wx / 62);
  const cz = Math.floor(wz / 76);
  const fx = wx / 62 - cx;
  const fz = wz / 76 - cz;
  let d = 1e9;
  if (hash2(cx, cz) > 0.22) d = Math.min(d, fx * 62);
  if (hash2(cx + 1, cz) > 0.22) d = Math.min(d, (1 - fx) * 62);
  if (hash2(cx + 7, cz + 3) > 0.3) d = Math.min(d, fz * 76);
  if (hash2(cx + 7, cz + 4) > 0.3) d = Math.min(d, (1 - fz) * 76);
  return d;
}

function tint(b, x, z, h) {
  const n = fbm(x * 0.02, z * 0.02, 2);
  switch (b) {
    case BIOME.FARM: {
      const f = farmEdge(x, z);
      if (f.edge < 1.7) return f.track ? P.track : mix3(P.hedge, P.forest[2], n);
      const c = P.crops[Math.floor(f.id * P.crops.length)];
      const furrow = Math.sin((f.id > 0.5 ? f.u : f.v) * 1.3) * 0.045 + (n - 0.5) * 0.12;
      return [c[0] * (1 + furrow), c[1] * (1 + furrow), c[2] * (1 + furrow)];
    }
    case BIOME.FOREST: {
      const clear = noise2(x * 0.012 + 9, z * 0.012);
      if (clear > 0.66) return ramp(P.clearing, n);
      return ramp(P.forest, n * 0.8 + clear * 0.3);
    }
    case BIOME.WATER:
      return ramp(P.dune, clamp((h - 1) / 5) * 0.7 + n * 0.3);
    case BIOME.TOWN: {
      // Lanes of packed earth, ragged at the edges.
      if (townRoad(x, z) < 2.1 + (n - 0.5) * 1.6) return mix3(P.road, P.track, n);
      return ramp(P.town, n);
    }
    case BIOME.BASIN:
      return ramp(P.basin, n * 0.7 + clamp(h / 12) * 0.3);
    case BIOME.HIGHLAND:
      return ramp(P.high, clamp((h - 1) / 26) * 0.85 + (n - 0.5) * 0.3);
    case BIOME.HILLS: {
      const c = ramp(P.hills, clamp((h - 2) / 27) * 0.7 + n * 0.3);
      // Dry-stone walls divide the pasture into big uneven fields.
      const wx = x + (noise2(x * 0.011, z * 0.011 + 3) - 0.5) * 70;
      const wz = z + (noise2(x * 0.011 + 8, z * 0.011) - 0.5) * 70;
      const ex = Math.abs(((wx % 96) + 96) % 96 - 48);
      const ez = Math.abs(((wz % 124) + 124) % 124 - 62);
      if (Math.min(48 - ex, 62 - ez) < 0.9) return mix3(P.stone, c, n * 0.3);
      // Vineyards: rows that follow the slope like contour lines.
      if (noise2(x * 0.008 + 31, z * 0.008 + 7) > 0.6 && h > 6 && h < 25) return Math.sin(h * 2.6) > 0.1 ? mix3(P.vine, c, 0.25) : mix3(P.soil, c, 0.35);
      return c;
    }
    case BIOME.AIRPORT: {
      const what = paving(x, z);
      const k = 0.94 + n * 0.12;
      if (what === 'runway') return P.asphalt.map((v) => v * k);
      if (what === 'taxi') return P.taxi.map((v) => v * k);
      if (what === 'apron') return P.concrete.map((v) => v * (k + (Math.abs(x % 12) < 0.5 || Math.abs(z % 12) < 0.5 ? -0.07 : 0)));
      if (what === 'pad') return P.pad.map((v) => v * k);
      if (what === 'road') return mix3(P.road, P.track, n);
      // Mown grass, in the long stripes a mower leaves.
      return ramp(P.mown, n * 0.6 + (Math.sin(x * 0.42) > 0 ? 0.4 : 0));
    }
    default: {
      const c = ramp(P.meadow, n * 0.65 + clamp(h / 14) * 0.35);
      // Flowers: soft dabs of colour inside drifting patches.
      const patch = smoothstep(0.6, 0.72, noise2(x * 0.03, z * 0.03 + 11));
      const dab = smoothstep(0.56, 0.7, noise2(x * 0.19, z * 0.19));
      if (patch * dab > 0.01) return mix3(c, P.flowers[Math.floor(noise2(x * 0.011, z * 0.011) * 3.99)], patch * dab * 0.8);
      return c;
    }
  }
}

// Colour of the ground at a point, 0-255 per channel. `h` is the height above the local water.
export function colourAt(x, z, h, biome) {
  const s = sunk(x, z);
  if (s > 0.04 && s < 0.96 && h > -6) {
    // Cliff face: bands of rock, with ledges of grass near the top.
    const strata = noise2(x * 0.05, s * 9) * 0.6 + noise2(x * 0.3, z * 0.3) * 0.4;
    const rock = ramp(P.cliff, strata);
    return s < 0.12 ? mix3(P.basin[2], rock, s / 0.12) : rock;
  }
  if (h < 0) {
    const d = clamp(-h / 7);
    const c = d < 0.35 ? mix3(P.wetSand, P.shallow, d / 0.35) : mix3(P.shallow, P.deep, clamp((d - 0.35) / 0.65));
    return c;
  }
  let c = tint(biome, x, z, h);
  if (h < 1.5) c = mix3(mix3(P.wetSand, P.sand, clamp(h / 0.5)), c, smoothstep(0.5, 1.5, h));
  const grain = 0.94 + noise2(x * 0.31, z * 0.31) * 0.12;
  return [c[0] * grain, c[1] * grain, c[2] * grain];
}
