// The flock: a leader that follows the player's cursor, birds that trail it in
// a loose V, strays that can be picked up, and birds that have been knocked
// out of the sky. All drawn as one instanced mesh; wings flap in the shader.
import * as THREE from 'three';
import { BIOME, heightAt, levelAt, sampleGround } from './ground';
import { paintMaterial } from './materials';
import { clamp, damp, lerp } from './noise';
import { TUNE } from './tuning';

export const CRUISE = 60; // normal flying height
export const LOW_MIN = 7; // the low band the flock dives into
export const LOW_MAX = 24;
export const MAX_BIRDS = 15;
const CAP = 56;

const slotOf = (i) => {
  if (i === 0) return [0, 0, 0];
  const row = Math.ceil(i / 2);
  const side = i % 2 ? -1 : 1;
  const j = Math.sin(i * 12.9898) * 0.5;
  return [side * row * 5.6 + j * 1.2, j * 0.9, row * 4.2 + Math.cos(i * 4.1) * 0.7];
};

// What a low-flying bird stirs up from the ground beneath it, by region.
const PETALS = [[0.95, 0.84, 0.36], [0.94, 0.66, 0.72], [0.96, 0.95, 0.89], [0.78, 0.61, 0.88]];
const LEAVES = [[0.42, 0.62, 0.24], [0.85, 0.54, 0.18], [0.75, 0.34, 0.12], [0.89, 0.7, 0.23]];
const CHAFF = [[0.92, 0.82, 0.5], [0.85, 0.72, 0.4]];
const DUST = [[0.8, 0.76, 0.68]];
const STIRRED = { [BIOME.MEADOW]: PETALS, [BIOME.HILLS]: PETALS, [BIOME.FOREST]: LEAVES, [BIOME.BASIN]: LEAVES, [BIOME.FARM]: CHAFF };
const under = { h: 0, biome: 0, level: 0, rel: 0 };

export function createFlock(scene, U, kit, fx) {
  const geo = kit.bird.geometry;
  const flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  geo.setAttribute('aFlap', flapAttr);
  const mat = paintMaterial(U, { flap: { shoulder: 0.37, arm: 2.05 }, doubleSide: true, sharp: true });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const birds = [];
  const strays = [];
  const fallen = [];
  const ctrl = { x: 0, y: CRUISE, zoff: 0, z: 0, low: 0, high: 0, floor: 0, speed: 38, vy: 0 };
  const leader = new THREE.Vector3(0, CRUISE, 0);
  const tmp = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  let time = 0;
  let kick = 0;

  function makeBird(x, y, z) {
    return {
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      ph: Math.random() * 6.28,
      phase: Math.random() * 6.28,
      freq: 2.3 + Math.random() * 0.7,
      amp: 1,
      sweep: 0,
      flapping: Math.random() < 0.6,
      timer: 1 + Math.random() * 3,
      size: 0.92 + Math.random() * 0.16,
      kx: 0,
      ky: 0,
      kz: 0,
    };
  }

  function reset(count, z) {
    birds.length = strays.length = fallen.length = 0;
    Object.assign(ctrl, { x: 0, y: CRUISE, zoff: 0, z, low: 0, high: 0, floor: 0, vy: 0 });
    for (let i = 0; i < count; i++) {
      const s = slotOf(i);
      birds.push(makeBird(s[0], CRUISE + s[1], z + s[2]));
    }
  }

  // input: { nx, ny (-1..1, +y is up-screen), dive }, xr = how far the flock may roam sideways.
  function update(dt, input, xr, push = 0) {
    time += dt;
    ctrl.z -= ctrl.speed * dt;
    const up = clamp(input.ny * 0.5 + 0.5);
    // Hold to dive into the low band; the other hold climbs far above everything.
    // The low band hangs over the water below, so over a basin a dive goes much
    // deeper. It rises early for a cliff ahead.
    const under = Math.max(levelAt(ctrl.x, ctrl.z + ctrl.zoff), levelAt(ctrl.x, ctrl.z - 170));
    ctrl.floor += (under - ctrl.floor) * damp(under > ctrl.floor ? 5 : 2.2, dt);
    const ty = input.dive ? ctrl.floor + lerp(LOW_MIN + 1.5, LOW_MAX, up) : input.climb ? TUNE.flight.highAltitude + (up - 0.5) * 16 : CRUISE;
    const tx = clamp(input.nx, -1, 1) * xr;
    const level = 1 - Math.max(ctrl.low, input.climb ? 1 : 0);
    const tz = -input.ny * 17 * level - 6 * (1 - ctrl.low);
    ctrl.x += clamp((tx - ctrl.x) * TUNE.flight.steer, -70, 70) * dt + push * dt;
    ctrl.x = clamp(ctrl.x, -xr - 6, xr + 6);
    const vy = clamp((ty - ctrl.y) * (ty < ctrl.y ? 3.2 : 1.7), -60, TUNE.flight.climbRate);
    ctrl.vy += (vy - ctrl.vy) * damp(8, dt);
    ctrl.y += ctrl.vy * dt;
    ctrl.zoff += (tz - ctrl.zoff) * damp(3.5, dt);
    ctrl.low = clamp((CRUISE - ctrl.y) / (CRUISE - LOW_MAX));
    ctrl.high = clamp((ctrl.y - CRUISE) / (TUNE.flight.highAltitude - CRUISE));
    leader.set(ctrl.x, ctrl.y, ctrl.z + ctrl.zoff);
    kick *= Math.exp(-dt * 2.5);

    const spread = (1 - 0.22 * ctrl.low) * TUNE.flight.spacing;
    const diving = ctrl.vy < -9;
    const climbing = ctrl.vy > 6;
    birds.forEach((b, i) => {
      const s = slotOf(i);
      const row = Math.ceil(i / 2);
      tmp.set(
        leader.x + s[0] * spread + Math.sin(time * 0.45 + b.ph) * 0.6 + b.kx * kick,
        leader.y + s[1] + Math.cos(time * 0.6 + b.ph * 1.3) * 0.45 + b.ky * kick,
        leader.z + s[2] * (1 + 0.35 * ctrl.low) * TUNE.flight.spacing + b.kz * kick,
      );
      const before = b.pos.clone();
      b.pos.lerp(tmp, damp(8.5 / (1 + row * 0.42), dt));
      b.pos.z -= ctrl.speed * dt * (1 - damp(8.5 / (1 + row * 0.42), dt));
      b.vel.lerp(tmp.copy(b.pos).sub(before).divideScalar(Math.max(dt, 1e-4)), damp(10, dt));
      flap(b, dt, diving, climbing);
      wake(b, dt);
      fx.shadow('bird', b.pos.x, b.pos.y, b.pos.z, clamp(-b.vel.x * 0.012, -0.5, 0.5), b.size * TUNE.flight.birdSize, wingspan(b));
    });

    for (let i = strays.length - 1; i >= 0; i--) {
      const s = strays[i];
      s.pos.z -= ctrl.speed * 0.5 * dt;
      s.pos.x += Math.cos(time * 0.8 + s.ph) * 3 * dt;
      s.pos.y += Math.sin(time * 1.1 + s.ph) * 1.2 * dt;
      s.vel.set(0, 0, -ctrl.speed * 0.5);
      flap(s, dt, false, false);
      s.spark -= dt;
      if (s.spark < 0) {
        s.spark = 0.07;
        fx.spawn({ x: s.pos.x + (Math.random() - 0.5) * 5, y: s.pos.y + (Math.random() - 0.5) * 2, z: s.pos.z + 1, vz: 6, vy: 1.5, life: 0.9, size: 1.5, color: [1, 0.86, 0.45], alpha: 0.9 });
        fx.spawn({ x: s.pos.x, y: s.pos.y, z: s.pos.z, vz: -ctrl.speed * 0.5, life: 0.16, size: 15, color: [1, 0.85, 0.5], alpha: 0.22 });
      }
      fx.shadow('bird', s.pos.x, s.pos.y, s.pos.z, 0, s.size * TUNE.flight.birdSize, wingspan(s));
      if (s.pos.z > ctrl.z + 70) {
        strays.splice(i, 1);
        continue;
      }
      if (birds.length >= MAX_BIRDS) continue;
      for (const b of birds) {
        const dx = b.pos.x - s.pos.x;
        const dz = b.pos.z - s.pos.z;
        if (dx * dx + dz * dz < 81 && Math.abs(b.pos.y - s.pos.y) < 10) {
          strays.splice(i, 1);
          birds.push(s);
          fx.burst(14, { x: s.pos.x, y: s.pos.y, z: s.pos.z, vz: -ctrl.speed, life: 0.8, size: 1.8, color: [1, 0.9, 0.55], drag: 1.5 }, 3, 16);
          joined++;
          break;
        }
      }
    }

    for (let i = fallen.length - 1; i >= 0; i--) {
      const f = fallen[i];
      f.age += dt;
      f.vel.y -= 26 * dt;
      f.vel.multiplyScalar(Math.exp(-0.5 * dt));
      f.pos.addScaledVector(f.vel, dt);
      f.spin += dt * 7;
      if (f.age > 3 || f.pos.y < heightAt(f.pos.x, f.pos.z)) fallen.splice(i, 1);
    }
  }

  // The air a bird drags along behind it when it skims the ground: spray off
  // water, petals off a meadow, leaves, chaff or dust elsewhere, thrown out to
  // either side and wound upward. (After the wake in Petalwake, much simplified.)
  function wake(b, dt) {
    if (ctrl.low < 0.5 || Math.random() > dt * 10 * TUNE.flight.wake) return;
    sampleGround(b.pos.x, b.pos.z, under);
    const surface = Math.max(under.h, under.level);
    const alt = b.pos.y - surface;
    if (alt > 15) return;
    const near = 1 - alt / 15;
    const side = Math.random() < 0.5 ? -1 : 1;
    const at = { x: b.pos.x + side * (1 + Math.random() * 3), y: surface + 0.4, z: b.pos.z + 2 + Math.random() * 3 };
    if (under.rel < 0) {
      fx.spawn({ ...at, vx: side * (2 + Math.random() * 5), vy: (3 + Math.random() * 6) * near, vz: -ctrl.speed * 0.35, life: 0.8, size: 1.6 + near * 1.6, grow: 1.5, color: [1, 1, 1], alpha: 0.55 * near, gravity: 9, drag: 1.2 });
      return;
    }
    const set = STIRRED[under.biome] || DUST;
    const dust = set === DUST;
    fx.spawn({
      ...at,
      vx: side * (3 + Math.random() * 6),
      vy: (2 + Math.random() * 7) * near,
      vz: -ctrl.speed * (0.3 + Math.random() * 0.3),
      life: dust ? 1.2 : 1.6 + Math.random(),
      size: dust ? 5 : 0.9 + Math.random() * 0.7,
      grow: dust ? 2 : 0,
      color: set[Math.floor(Math.random() * set.length)],
      alpha: dust ? 0.16 * near : 0.9,
      gravity: dust ? 0 : 2.5,
      drag: dust ? 1.5 : 0.9,
    });
  }

  // How wide the wings look from above: narrower at the top and bottom of a stroke.
  const wingspan = (b) => 1 - 0.16 * b.amp * Math.abs(Math.sin(b.phase)) - 0.3 * b.sweep;

  function flap(b, dt, diving, climbing) {
    b.timer -= dt;
    if (b.timer <= 0) {
      b.flapping = !b.flapping;
      b.timer = b.flapping ? 1.4 + Math.random() * 2.4 : 0.9 + Math.random() * 2.2;
    }
    const amp = diving ? 0 : climbing || b.flapping ? 1 : 0.06;
    b.amp += (amp - b.amp) * damp(amp ? 5 : 2.6, dt);
    b.sweep += ((diving ? 1 : 0) - b.sweep) * damp(diving ? 5 : 2.2, dt);
    b.phase += dt * b.freq * 6.28 * TUNE.flight.flapRate * (climbing ? 1.35 : 1) * Math.min(1, b.amp * 1.5 + 0.1);
  }

  let joined = 0;
  const takeJoined = () => {
    const n = joined;
    joined = 0;
    return n;
  };

  function addStray(x, y, z) {
    const s = makeBird(x, y, z);
    s.spark = 0;
    strays.push(s);
  }

  // Knock a bird out of the flock. Returns how many are left.
  function lose(b, ix = 0, iy = 6, iz = 0) {
    const i = birds.indexOf(b);
    if (i < 0) return birds.length;
    birds.splice(i, 1);
    fallen.push({ pos: b.pos.clone(), vel: new THREE.Vector3(b.vel.x * 0.4 + ix, iy, b.vel.z * 0.6 + iz), spin: 0, age: 0, ph: b.ph, size: b.size });
    fx.burst(16, { x: b.pos.x, y: b.pos.y, z: b.pos.z, vz: b.vel.z * 0.7, life: 1.5, size: 1.5, color: [1, 1, 0.97], gravity: 5, drag: 1.4 }, 2, 16);
    for (const o of birds) {
      o.kx = (Math.random() - 0.5) * 9;
      o.ky = (Math.random() - 0.5) * 4;
      o.kz = (Math.random() - 0.5) * 7;
    }
    kick = 1;
    return birds.length;
  }

  function put(n, pos, pitch, yaw, roll, size, phase, amp, sweep, boost) {
    quat.setFromEuler(euler.set(pitch, yaw, roll));
    m4.compose(pos, quat, scl.setScalar(size * TUNE.flight.birdSize));
    mesh.setMatrixAt(n, m4);
    flapAttr.array.set([phase, amp, sweep, boost], n * 4);
  }

  function draw() {
    let n = 0;
    const live = (b, boost) => {
      const bob = tmp.copy(b.pos);
      bob.y -= Math.sin(b.phase) * 0.22 * b.amp;
      put(n++, bob, clamp((b.vel.y - 0) * 0.02, -0.75, 0.5), clamp(-b.vel.x * 0.012, -0.5, 0.5), clamp(-b.vel.x * 0.034, -0.85, 0.85), b.size, b.phase, b.amp, b.sweep, boost);
    };
    for (const b of birds) live(b, 0);
    for (const s of strays) live(s, 0.12 + 0.1 * Math.sin(time * 6 + s.ph));
    for (const f of fallen) put(n++, f.pos, f.spin * 0.7, f.spin * 0.4 + f.ph, f.spin, f.size, 0, 0.1, 0.6, -0.1);
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    flapAttr.needsUpdate = true;
  }

  function dispose() {
    mat.dispose();
  }

  return { birds, strays, ctrl, leader, reset, update, draw, lose, addStray, takeJoined, dispose };
}
