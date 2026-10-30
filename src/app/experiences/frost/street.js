// The street behind the glass, as seen from a café table: a road running away to the right,
// buildings and shopfronts on the far side, lamps, a traffic light, signs and a far-off city.
// Everything sits in a simple perspective: `d` is metres from the window along the road,
// `side` metres across it (negative = our side), `height` metres up.
//
// Each frame `update` fills `lights` with every light source (stage units, y up) and
// returns the buildings and lamp pools the scene shader draws.

// x, y, radius, intensity | r, g, b, kind + seed | motion x, motion y, reflection length, 0
// kind: 0 light, 1 road reflection. The seed (0..1) gives each light its own shape.
// Motion is how far the light travels while the "shutter" is open, in stage units.
export const LIGHT_STRIDE = 12;
export const MAX_LIGHTS = 420;
export const MAX_BUILDINGS = 16;
export const MAX_POOLS = 8;
export const MAX_GLARE = 2;
const MARKER = [1, 0.55, 0.12];

const NEAR = 6;
const FAR = 220;

const WHITE_LED = [0.86, 0.92, 1];
const HALOGEN = [1, 0.84, 0.6];
const TAIL = [1, 0.08, 0.04];
const BRAKE = [1, 0.06, 0.03];
const SODIUM = [1, 0.5, 0.16];
const SIGNAL = { green: [0.2, 1, 0.62], amber: [1, 0.6, 0.1], red: [1, 0.1, 0.07] };
const SIGN_COLORS = [[1, 0.2, 0.55], [0.2, 0.75, 1], [1, 0.62, 0.15], [0.35, 1, 0.55], [0.8, 0.35, 1]];

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Smooth 1D noise, 0..1, for flickers that never repeat on a beat.
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const noise = (t) => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
};

export function project(d, side, height, aspect) {
  const scale = NEAR / d;
  const s = 1 - scale;
  const vp = [aspect * 0.95, 0.43];
  const base = [-0.2, 0.09];
  return {
    x: base[0] + (vp[0] - base[0]) * s + side * 0.016 * scale,
    y: base[1] + (vp[1] - base[1]) * s + side * 0.028 * scale + height * 0.05 * scale,
    scale,
  };
}

// Light cycle in seconds.
const GREEN = 11;
const AMBER = 2.5;
const RED = 9;
const CYCLE = GREEN + AMBER + RED;
const SIGNAL_D = 19;

export function createStreet() {
  const lights = new Float32Array(MAX_LIGHTS * LIGHT_STRIDE);
  const buildingData = new Float32Array(MAX_BUILDINGS * 12);
  const poolData = new Float32Array(MAX_POOLS * 8);
  let count = 0;
  let key = '';
  let rand = Math.random;
  let fixed = [];
  let buildings = [];
  let pools = [];
  let glare = [];
  const glareData = new Float32Array(MAX_GLARE * 8);
  let cars = [];
  let lanes = [];
  let clock = 0;
  let aspect = 0.8;

  let shutter = 0;

  const add = (x, y, r, intensity, c, kind = 0, seed = 0, mx = 0, my = 0, len = 0) => {
    if (count >= MAX_LIGHTS || intensity <= 0.002) return;
    if (x < -0.3 || x > aspect + 0.3 || y < -0.3 || y > 1.3) return;
    lights.set([x, y, r, intensity, c[0], c[1], c[2], kind + seed * 0.98, mx, my, len, 0], count * LIGHT_STRIDE);
    count++;
  };

  // A light standing over the wet road also gets a long reflection under it.
  // `speed` is metres per second along the road; it smears the light while the shutter is open.
  const addWithReflection = (d, side, height, r, intensity, c, wet = 0.45, seed = 0, speed = 0) => {
    const p = project(d, side, height, aspect);
    const moved = speed ? project(d + speed * shutter, side, height, aspect) : p;
    // Distant lights are dimmer; every out-of-focus light is a similar size, a little larger up close.
    const fade = Math.min(1, 0.04 + p.scale * p.scale * 6);
    const radius = r * (0.82 + 0.3 * p.scale);
    add(p.x, p.y, radius, intensity * fade, c, 0, seed, moved.x - p.x, moved.y - p.y);
    if (wet > 0) {
      const q = project(d, side, -height * 0.85, aspect);
      const qm = speed ? project(d + speed * shutter, side, -height * 0.85, aspect) : q;
      // Higher lights throw longer streaks; the wet road breaks each one up differently.
      const rs = (seed * 7.31) % 1;
      const len = Math.min(13, (2.2 + height * 0.85) * (0.5 + rs * 1.1));
      add(q.x, q.y, radius, intensity * fade * wet, c, 1, rs, qm.x - q.x, qm.y - q.y, len);
    }
  };

  const layout = (seed) => {
    rand = mulberry32(seed * 7919);
    const r = rand;

    // Buildings along the far side, each with its own floor height, window rhythm and lights.
    buildings = [];
    let d = 7 + r() * 3;
    while (d < FAR && buildings.length < MAX_BUILDINGS) {
      const len = 7 + r() * 16;
      buildings.push({
        d0: d,
        d1: d + len,
        side: 9.5 + r() * 2.5,
        height: 7 + r() * 20 * (r() < 0.25 ? 1.6 : 1),
        floorH: 2.9 + r() * 0.9,
        colW: 1.8 + r() * 2.2,
        lit: 0.18 + r() ** 1.3 * 0.55,
        warmth: r(),
        shop: r() < 0.65 ? 1 + Math.floor(r() * 4) : 0,
        tone: 0.6 + r() * 0.8,
        seed: r() * 100,
      });
      d += len + (r() < 0.3 ? 2 + r() * 8 : 0.3);
    }
    buildings.reverse(); // far first, so nearer ones draw over them

    fixed = [];
    // Street lamps on both kerbs, some sodium orange, some white LED.
    const lampDs = [10, 24, 40, 55, 72, 95, 120, 150, 190];
    lampDs.forEach((ld, i) => {
      fixed.push({ kind: 'lamp', d: ld + (r() - 0.5) * 4, side: 6.2, height: 6.5, color: r() < 0.82 ? SODIUM : WHITE_LED, flicker: i === 2 ? 1 : 0 });
    });
    [16, 52].forEach((ld) => fixed.push({ kind: 'lamp', d: ld, side: -6.5, height: 6.5, color: SODIUM, flicker: 0 }));
    fixed.push({ kind: 'signal', d: SIGNAL_D, side: 6, height: 4.2 });
    fixed.push({ kind: 'signal', d: SIGNAL_D + 1, side: -5.8, height: 4.2 });

    // Signs on some shopfronts: steady, slowly breathing, or a tired neon that stutters.
    for (const b of buildings) {
      if (!b.shop || r() < 0.2) continue;
      const sd = b.d0 + (b.d1 - b.d0) * (0.2 + r() * 0.6);
      fixed.push({ kind: 'sign', d: sd, side: b.side - 0.4, height: 3.4 + r() * 1.5, color: SIGN_COLORS[Math.floor(r() * SIGN_COLORS.length)], mode: Math.floor(r() * 3), phase: r() * 50, size: 0.8 + r() * 0.6 });
    }

    // The city beyond: lots of small lights near the vanishing point.
    for (let i = 0; i < 45; i++) {
      const t = r();
      fixed.push({
        kind: 'city',
        d: 150 + r() * 600,
        side: (r() - 0.35) * 160,
        height: r() ** 2 * 60,
        color: t < 0.4 ? [1, 0.55 + r() * 0.3, 0.25] : t < 0.55 ? WHITE_LED : t < 0.78 ? [1, 0.18, 0.12] : SIGN_COLORS[Math.floor(r() * SIGN_COLORS.length)],
        power: 0.05 + r() ** 2 * 0.3,
        phase: r() * 100,
      });
    }

    // Faint reflections of the café behind us on the glass.
    fixed.push({ kind: 'room', x: 0.12, y: 0.82, r: 0.16, power: 0.05 });
    fixed.push({ kind: 'room', x: 0.62, y: 0.9, r: 0.12, power: 0.035 });
    fixed.push({ kind: 'room', x: 0.7, y: 0.2, r: 0.18, power: 0.03 });

    fixed.forEach((f) => { f.seed = r(); });

    lanes = [
      { dir: -1, side: -1.9, start: FAR, stop: SIGNAL_D + 4, timer: 1 },
      { dir: 1, side: 1.9, start: 2.5, stop: SIGNAL_D - 4, timer: 3 },
    ];
    cars = [];
  };

  const signal = () => {
    const t = clock % CYCLE;
    return t < GREEN ? 'green' : t < GREEN + AMBER ? 'amber' : 'red';
  };

  const spawn = (lane) => {
    const t = rand();
    const kind = t < 0.07 ? 'bus' : t < 0.13 ? 'truck' : t < 0.2 ? 'bike' : 'car';
    const big = kind === 'bus' || kind === 'truck';
    const vmax = (big ? 8 + rand() * 2 : 10 + rand() * 7) * (0.85 + rand() * 0.3);
    // How the driver uses the headlights: dipped, full beam (dipped again close by), or a flash.
    const b = rand();
    const beamMode = b < 0.2 ? 'high' : b < 0.34 ? 'flash' : 'low';
    cars.push({
      lane, kind, d: lane.start, v: vmax * 0.9, vmax,
      len: big ? 12 : 4.4,
      beamMode,
      beam: beamMode === 'high' ? 1 : 0,
      dipAt: 14 + rand() * 18,
      flashAt: 18 + rand() * 45,
      flashClock: -1,
      head: rand() < 0.6 ? WHITE_LED : HALOGEN,
      power: 0.8 + rand() * 0.5,
      braking: 0,
      seed: rand(),
    });
  };

  const stepTraffic = (dt, traffic) => {
    const state = signal();
    for (const lane of lanes) {
      lane.timer -= dt * traffic;
      const room = !cars.some((c) => c.lane === lane && Math.abs(c.d - lane.start) < 14);
      if (lane.timer <= 0 && room && traffic > 0) {
        spawn(lane);
        // Traffic comes in loose bunches: short gaps, then long quiet ones.
        lane.timer = rand() < 0.55 ? 1.2 + rand() * 2 : 5 + rand() * 12;
      }
    }
    for (const car of cars) {
      const { lane } = car;
      let target = car.vmax;
      const toLine = (lane.stop - car.d) * lane.dir;
      if (state !== 'green' && toLine > 0.5 && toLine < 45) target = Math.min(target, Math.max(0, (toLine - 1) * 0.55));
      for (const other of cars) {
        if (other === car || other.lane !== lane) continue;
        const gap = (other.d - car.d) * lane.dir - (other.len + car.len) / 2;
        if (gap > -1 && gap < 30) target = Math.min(target, Math.max(0, (gap - 2.5) * 0.6));
      }
      const accel = target > car.v ? 2.2 : 6;
      car.v += Math.sign(target - car.v) * Math.min(Math.abs(target - car.v), accel * dt);
      car.braking += ((target < car.v - 0.3 || car.v < 0.5 ? 1 : 0) - car.braking) * Math.min(1, dt * 5);
      car.d += lane.dir * car.v * dt;

      if (lane.dir < 0) {
        let target = 0;
        if (car.beamMode === 'high') target = car.d > car.dipAt ? 1 : 0;
        if (car.beamMode === 'flash') {
          if (car.flashClock < 0 && car.d < car.flashAt) car.flashClock = 0;
          if (car.flashClock >= 0) {
            car.flashClock += dt;
            // Two quick flashes, then dipped again.
            const f = car.flashClock;
            target = (f < 0.22) || (f > 0.42 && f < 0.64) ? 1 : 0;
          }
        }
        car.beam += (target - car.beam) * Math.min(1, dt * 22);
      }
    }
    cars = cars.filter((c) => c.d > 2 && c.d < FAR + 5);
    return state;
  };

  const update = (dt, values, nextAspect, mood, nextShutter = 0) => {
    shutter = nextShutter;
    aspect = nextAspect;
    const nextKey = `${values.seed}|${aspect.toFixed(2)}`;
    if (nextKey !== key) {
      key = nextKey;
      layout(values.seed);
    }
    clock += dt;
    const state = stepTraffic(dt, values.traffic);
    const R = 0.05 * values.lightSize;
    const B = values.brightness;
    count = 0;
    pools = [];
    glare = [];

    for (const f of fixed) {
      if (f.kind === 'lamp') {
        let k = 1;
        if (f.flicker) {
          const n = noise(clock * 0.35 + 7);
          k = n > 0.78 ? (noise(clock * 18) > 0.45 ? 1 : 0.15) : 1;
        }
        const color = f.color === SODIUM ? mood.lamp : f.color;
        addWithReflection(f.d, f.side, f.height, R * 1.15, 2.2 * k * B, color, 0.3, f.seed);
        if (pools.length < MAX_POOLS) pools.push({ ...project(f.d, f.side - 1, 0, aspect), color, k });
      } else if (f.kind === 'signal') {
        addWithReflection(f.d, f.side, f.height, R * 0.9, 2.4 * B, SIGNAL[state], 0.4, f.seed);
      } else if (f.kind === 'sign') {
        let k = 1;
        if (f.mode === 1) k = 0.55 + 0.45 * noise(clock * 0.25 + f.phase);
        if (f.mode === 2) k = noise(clock * 0.4 + f.phase) > 0.7 ? (noise(clock * 14 + f.phase) > 0.5 ? 1 : 0.1) : 1;
        addWithReflection(f.d, f.side, f.height, R * f.size, 2.2 * k * B, f.color, 0.3, f.seed);
      } else if (f.kind === 'city') {
        const p = project(f.d, f.side, f.height, aspect);
        add(p.x, p.y, R * (0.35 + f.power * 0.35), f.power * (0.7 + 0.3 * noise(clock * 0.3 + f.phase)) * B, f.color, 0, f.seed);
      } else if (f.kind === 'room') {
        add(f.x * aspect / 0.8, f.y, f.r, f.power, mood.window, 0, f.seed);
      }
    }

    for (const car of cars) {
      const coming = car.lane.dir < 0;
      const speed = car.v * car.lane.dir;
      const s1 = car.seed;
      const s2 = (car.seed + 0.37) % 1;
      const big = car.kind === 'bus' || car.kind === 'truck';
      const halfW = car.kind === 'bike' ? 0 : big ? 1.1 : 0.78;
      if (coming) {
        const h = big ? 1.1 : 0.7;
        const p = 3.2 * car.power * B * (big ? 1.35 : 1) * (1 + 1.6 * car.beam);
        const rr = R * (big ? 1.2 : 1) * (1 + 0.25 * car.beam);
        addWithReflection(car.d, car.lane.side - halfW, h, rr, p, car.head, 0.55, s1, speed);
        if (halfW) addWithReflection(car.d, car.lane.side + halfW, h, rr, p, car.head, 0.55, s2, speed);
        // A truck's amber marker lights along the top of the cab.
        if (car.kind === 'truck') {
          for (let i = -1; i <= 1; i++) addWithReflection(car.d, car.lane.side + i * 0.6, 3.3, R * 0.45, 0.9 * B, MARKER, 0.12, (s1 + 0.2 * (i + 2)) % 1, speed);
        }
        // Headlights aimed at the window light up the fog on the glass.
        const at = project(car.d, car.lane.side, h, aspect);
        const near = Math.max(0, Math.min(1, (at.scale - 0.08) / 0.4));
        const strength = (0.12 + 1.1 * car.beam) * near * (big ? 1.5 : 1) * car.power * B * 0.35;
        if (strength > 0.02) glare.push({ x: at.x, y: at.y, r: 0.22 + 0.3 * near + 0.12 * car.beam, strength, color: car.head });
      } else {
        const h = 0.95;
        const p = (1.1 + 1.8 * car.braking) * car.power * B;
        const c = car.braking > 0.5 ? BRAKE : TAIL;
        addWithReflection(car.d, car.lane.side - halfW, h, R * 0.9, p, c, 0.5, s1, speed);
        if (halfW) addWithReflection(car.d, car.lane.side + halfW, h, R * 0.9, p, c, 0.5, s2, speed);
      }
      // A bus is a row of warm windows too.
      if (car.kind === 'bus') {
        for (let i = 1; i < 6; i++) {
          const dd = car.d - car.lane.dir * i * 2;
          addWithReflection(dd, car.lane.side + 1.3, 2.1, R * 0.8, 0.5 * B, mood.window, 0.15, (s1 + i * 0.13) % 1, speed);
        }
      }
    }

    // Pack the buildings and lamp pools for the scene shader.
    buildingData.fill(0);
    buildings.forEach((b, i) => {
      const a = project(b.d0, b.side, 0, aspect);
      const c = project(b.d1, b.side, 0, aspect);
      const at = project(b.d0, b.side, b.height, aspect);
      const ct = project(b.d1, b.side, b.height, aspect);
      buildingData.set([
        a.x, c.x, a.y, c.y,
        at.y, ct.y, Math.max(1, Math.round(b.height / b.floorH)), Math.max(1, Math.round((b.d1 - b.d0) / b.colW)),
        b.lit, b.warmth, b.shop, b.tone,
      ], i * 12);
    });
    poolData.fill(0);
    pools.forEach((p, i) => poolData.set([p.x, p.y, 0.1 * p.scale + 0.03, p.k, ...p.color, 0], i * 8));

    // The strongest glare sources this frame.
    glare.sort((a, b) => b.strength - a.strength);
    glareData.fill(0);
    glare.slice(0, MAX_GLARE).forEach((g, i) => glareData.set([g.x, g.y, g.r, g.strength, ...g.color, 0], i * 8));

    return { lightCount: count, buildingCount: buildings.length, poolCount: pools.length };
  };

  return { lights, buildingData, poolData, glareData, update, project: (d, s, h) => project(d, s, h, aspect) };
}
