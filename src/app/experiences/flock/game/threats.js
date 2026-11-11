// Everything that can knock a bird out of the flock, and the director that
// decides what to send next. Threats in the air (planes, balloons, hawks,
// storms) are dodged sideways or by diving; threats near the ground (hunters,
// power lines, turbines, and the land itself) only reach a flock flying low.
import * as THREE from 'three';
import { AIRFIELD, BIOME, airportNear, biomeAt, floorAt, heightAt, relAt } from './ground';
import { CRUISE, MAX_BIRDS } from './flock';
import { paintMaterial } from './materials';
import { clamp, damp, lerp } from './noise';
import { TUNE } from './tuning';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function createThreats(G) {
  const { scene, U, kit, fx, flock, sky, audio } = G;
  const mat = paintMaterial(U, { doubleSide: true });
  const airMat = paintMaterial(U, { doubleSide: true, sharp: true }); // flyers stay out of the motion blur
  const wireMat = new THREE.LineBasicMaterial({ color: 0x2f353b, transparent: true, opacity: 0.85 });
  const items = [];
  const shots = [];
  // Things on the ground cast into the sun shadow map; flyers drop their own
  // shadow through fx.shadow, so they stay out of it.
  const mk = (name, parent = scene, cast = true) => {
    const mesh = new THREE.Mesh(kit[name].geometry, cast ? mat : airMat);
    mesh.frustumCulled = false;
    if (cast) mesh.layers.enable(1);
    parent.add(mesh);
    return mesh;
  };

  // Hawks flap, so they share the birds' instanced, shader-animated path.
  const HAWKS = 4;
  const hawkFlap = new THREE.InstancedBufferAttribute(new Float32Array(HAWKS * 4), 4);
  kit.hawk.geometry.setAttribute('aFlap', hawkFlap);
  const hawkMat = paintMaterial(U, { flap: { shoulder: 0.37, arm: 1.2 }, doubleSide: true, sharp: true });
  const hawkMesh = new THREE.InstancedMesh(kit.hawk.geometry, hawkMat, HAWKS);
  hawkMesh.frustumCulled = false;
  hawkMesh.count = 0;
  scene.add(hawkMesh);
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const v3 = new THREE.Vector3();

  const near = (b, x, y, z, r) => {
    const dx = b.pos.x - x;
    const dy = b.pos.y - y;
    const dz = b.pos.z - z;
    return dx * dx + dy * dy + dz * dz < r * r;
  };

  // ---------------------------------------------------------------- aircraft
  const SHAPES = {
    airliner: [
      ...[-15, -9.5, -4, 1.5, 7, 12.5, 17].map((z) => [0, 0, z, 2.5]),
      ...[4, 8, 12, 16].flatMap((d) => [-1, 1].map((s) => [s * d, -0.8, -0.5 + (d - 1.2) * 0.42, 1.8])),
      [0, 4.5, 16.5, 2.2],
    ],
    biplane: [[0, 0.2, -3, 1.4], [0, 0.4, 0, 1.4], [0, 0.4, 3.4, 1.2], ...[2.4, 4.8, 7].flatMap((d) => [-1, 1].map((s) => [s * d, 0.6, -1.3, 1.6]))],
  };

  function plane(kind, x, y, z, vx, vz) {
    const big = kind === 'airliner';
    const mesh = mk(kind, scene, false);
    let prop = null;
    if (!big) {
      prop = mk('biplane_prop', mesh, false);
      prop.position.copy(kit.biplane_prop.offset);
    }
    const ph = Math.random() * 6.28;
    const yaw = Math.atan2(-vx, -vz);
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    let t = 0;
    let heard = false;
    const it = {
      big, kind: 'plane', warn: 'plane', x, y, z, hits: 0, max: big ? 2 : 1, reach: 60, behind: vz < 0, dead: false,
      update(dt) {
        if (it.dead) return false;
        t += dt;
        const weave = big ? 0 : Math.cos(t * 1.25 + ph) * 9;
        it.x += (vx + weave) * dt;
        it.z += vz * dt;
        it.y = y + Math.sin(t * 0.8 + ph) * (big ? 0.6 : 1.6);
        mesh.position.set(it.x, it.y, it.z);
        mesh.rotation.set(0, yaw, big ? 0 : -weave * 0.035, 'YXZ');
        if (prop) prop.rotation.z += dt * 38;
        fx.shadow(kind, it.x, it.y, it.z, yaw);
        if (!heard && Math.abs(it.z - flock.ctrl.z) < 240 && Math.abs(it.x) < 150) {
          heard = true;
          audio.engine(big, (it.x - flock.ctrl.x) / 60);
        }
        return it.z < flock.ctrl.z + 320 && it.z > flock.ctrl.z - 900 && Math.abs(it.x) < 460;
      },
      test(b) {
        for (const s of SHAPES[kind]) {
          if (near(b, it.x + s[0] * cs + s[2] * sn, it.y + s[1], it.z - s[0] * sn + s[2] * cs, s[3] + 0.9)) return true;
        }
        return false;
      },
      remove: () => scene.remove(mesh),
    };
    return it;
  }

  // Airport traffic: an aircraft taking off from, or landing on, the runway of
  // the airport `ap`. `dir` is +1 for one heading toward the flock, -1 for one
  // going the flock's way. Either can cross the flock's height on its way.
  const rest = {};
  for (const name of ['airliner', 'biplane']) {
    kit[name].geometry.computeBoundingBox();
    rest[name] = AIRFIELD.y + 0.3 - kit[name].geometry.boundingBox.min.y;
  }
  function flight(kind, ap, landing, dir) {
    const big = kind === 'airliner';
    const mesh = mk(kind, scene, false);
    let prop = null;
    if (!big) {
      prop = mk('biplane_prop', mesh, false);
      prop.position.copy(kit.biplane_prop.offset);
    }
    const ground = rest[kind];
    const yaw = dir < 0 ? 0 : Math.PI;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const cruise = big ? 76 : 50;
    const glide = 0.086; // slope of the approach
    const climb = big ? 0.21 : 0.25;
    const touch = (dir > 0 ? ap.far : ap.near) + dir * 70;
    const drift = rand(-3, 9);
    let x = AIRFIELD.runway.x;
    let z = landing ? touch - dir * 820 : (dir > 0 ? ap.far : ap.near) + dir * 16;
    let y = ground;
    let v = landing ? cruise * 0.86 : 0;
    let pitch = 0;
    let heard = false;
    let puff = 0;
    const it = {
      big, kind: 'plane', warn: null, x, y, z, hits: 0, max: big ? 2 : 1, reach: 60, behind: dir < 0 && z > flock.ctrl.z, dead: false,
      update(dt) {
        const c = flock.ctrl;
        let aim = 0;
        if (landing) {
          const left = (touch - z) * dir; // distance still to fly before the wheels touch
          if (left > 0) {
            y = ground + left * glide;
            aim = left < 60 ? 0.07 : -0.03; // nose up for the flare
          } else {
            y = ground;
            if (v > 9) {
              v = Math.max(9, v - (big ? 10 : 7) * dt);
              puff -= dt;
              if (left > -30 && puff < 0) {
                puff = 0.05;
                fx.spawn({ x, y: AIRFIELD.y + 0.6, z, vy: 2, life: 0.9, size: 5, grow: 2, color: [0.9, 0.9, 0.9], alpha: 0.4, drag: 1 });
              }
            } else {
              // Slow enough: turn off onto the taxiway.
              x += (AIRFIELD.taxiway.x - x) * damp(0.5, dt);
            }
          }
        } else {
          v = Math.min(cruise, v + (big ? 13 : 9) * dt);
          if (v > cruise * 0.76) {
            aim = climb;
            y += v * Math.sin(pitch) * dt;
            if (y > ground + 6) x += drift * dt;
          }
        }
        pitch += (aim - pitch) * damp(1.6, dt);
        z += dir * v * Math.cos(pitch) * dt;
        it.x = x;
        it.y = y;
        it.z = z;
        it.warn = y > 26 ? 'plane' : null;
        mesh.position.set(x, y, z);
        mesh.rotation.set(pitch, yaw, 0, 'YXZ');
        if (prop) prop.rotation.z += dt * (8 + v * 0.6);
        fx.shadow(kind, x, y, z, yaw);
        if (!heard && Math.abs(z - c.z) < 220) {
          heard = true;
          audio.engine(big, (x - c.x) / 60);
        }
        return z < c.z + 420 && z > c.z - 1900 && y < 240;
      },
      test(b) {
        for (const s of SHAPES[kind]) {
          if (near(b, x + s[0] * cs + s[2] * sn, y + s[1], z - s[0] * sn + s[2] * cs, s[3] + 0.9)) return true;
        }
        return false;
      },
      remove: () => scene.remove(mesh),
    };
    return it;
  }

  function balloon(x, y, z) {
    const mesh = mk('balloon', scene, false);
    const ph = Math.random() * 6.28;
    mesh.rotation.y = ph;
    // Each balloon rides the wind its own way: a slow drift across the route, a little along it, and a lazy sway.
    const drift = rand(-3.5, 3.5);
    const along = rand(-2, 3);
    let t = 0;
    const it = {
      kind: 'balloon', warn: 'balloon', x, y, z, hits: 0, max: 1, reach: 30,
      update(dt) {
        t += dt;
        it.y = y + Math.sin(t * 0.5 + ph) * 2.6;
        it.x = x + drift * t + Math.sin(t * 0.27 + ph) * 7;
        it.z = z + along * t;
        mesh.rotation.y = ph + t * 0.12;
        mesh.position.set(it.x, it.y - 13.5, it.z);
        fx.shadow('balloon', it.x, it.y, it.z, ph);
        return it.z < flock.ctrl.z + 130;
      },
      test: (b) => near(b, it.x, it.y, it.z, 9.3) || near(b, it.x, it.y - 12.3, it.z, 3),
      remove: () => scene.remove(mesh),
    };
    return it;
  }

  // Very rarely two aircraft meet in mid-air. The blast takes every bird near it,
  // so the only answer is distance: swerve wide or dive well below.
  const BLAST = 44;
  function crash() {
    const c = flock.ctrl;
    const T = 7.5;
    const px = rand(-16, 16);
    const py = CRUISE + rand(0, 4);
    const pz = c.z - c.speed * T - rand(10, 40);
    const side = Math.random() < 0.5 ? -1 : 1;
    const a = plane('airliner', px, py, pz - 30 * T, 0, 30);
    const b = plane('airliner', px + side * 38 * T, py, pz - 7 * T, -side * 38, 7);
    items.push(a, b);
    const it = {
      kind: 'crash', warn: 'crash', x: px, y: py, z: pz, hits: 0, max: 99, reach: 0, t: T,
      update(dt) {
        it.t -= dt;
        if (it.t > 0) return true;
        a.dead = b.dead = true;
        const at = { x: (a.x + b.x) / 2, y: py, z: (a.z + b.z) / 2 };
        fx.burst(50, { ...at, vy: 6, life: 4.5, size: 24, grow: 2.4, color: [0.16, 0.15, 0.15], alpha: 0.6, drag: 1.1 }, 18, 46);
        fx.burst(46, { ...at, life: 1.5, size: 20, grow: 1.6, color: [1, 0.62, 0.2], alpha: 0.95, drag: 1.6 }, 14, 70);
        fx.burst(30, { ...at, life: 0.7, size: 30, grow: 1, color: [1, 0.95, 0.75], alpha: 1, drag: 3 }, 8, 40);
        fx.burst(40, { ...at, vz: 20, life: 3.2, size: 2.6, color: [1, 0.75, 0.3], alpha: 1, gravity: 24, drag: 0.3 }, 6, 90);
        U.uFlash.value = 1;
        G.shake = 2.4;
        audio.explosion();
        for (const bird of [...flock.birds]) {
          if (near(bird, at.x, at.y, at.z, BLAST)) G.hit(bird, 'crash', it, true);
        }
        return false;
      },
      test: () => false,
      remove() {},
    };
    return it;
  }

  // --------------------------------------------------------------------- hawk
  function hawk(side, delay) {
    const c = flock.ctrl;
    const pos = new THREE.Vector3(side * rand(55, 90), CRUISE + rand(30, 42), c.z - 300 - delay * 60);
    const dir = new THREE.Vector3(-side * 0.2, -0.1, 1).normalize();
    let state = 'stoop';
    let victim = null;
    let phase = 0;
    let age = 0;
    const it = {
      kind: 'hawk', warn: 'hawk', x: pos.x, y: pos.y, z: pos.z, hits: 0, max: 1, reach: 40, pos, dir, phase: 0, amp: 0.2,
      update(dt) {
        age += dt;
        const speed = state === 'stoop' ? 58 : 50;
        if (state === 'stoop') {
          if (!victim || !flock.birds.includes(victim)) victim = pick(flock.birds);
          if (!victim || c.y < 33 || pos.z > flock.leader.z + 6 || it.hits) state = 'leave';
          else {
            const tt = pos.distanceTo(victim.pos) / (speed + c.speed);
            v3.copy(victim.pos).addScaledVector(victim.vel, tt * 0.8).sub(pos).normalize();
            dir.lerp(v3, damp(2.4, dt)).normalize();
          }
        } else {
          dir.lerp(v3.set(side * 0.55, 0.45, 0.7).normalize(), damp(1.6, dt)).normalize();
        }
        pos.addScaledVector(dir, speed * dt);
        it.amp += ((state === 'stoop' && pos.y > c.y + 6 ? 0.12 : 1) - it.amp) * damp(4, dt);
        phase += dt * 15 * Math.max(0.2, it.amp);
        it.phase = phase;
        it.x = pos.x;
        it.y = pos.y;
        it.z = pos.z;
        fx.shadow('hawk', pos.x, pos.y, pos.z, Math.atan2(-dir.x, -dir.z), 1.3);
        return age < 14 && pos.z < c.z + 160;
      },
      test: (b) => state === 'stoop' && near(b, pos.x, pos.y, pos.z, 3.3),
      remove() {},
    };
    return it;
  }

  // -------------------------------------------------------------------- storm
  function storm(nearZ, length) {
    sky.addStorm(nearZ, length);
    const pending = [];
    let timer = 1.2;
    const it = {
      kind: 'storm', warn: 'storm', x: 0, y: CRUISE, z: nearZ, hits: 0, max: 99, reach: 1e6, far: nearZ - length,
      update(dt) {
        const c = flock.ctrl;
        const inside = c.z < nearZ - 20 && c.z > it.far + 40;
        it.warn = c.z > nearZ ? 'storm' : null;
        if (inside) {
          timer -= dt;
          if (timer <= 0) {
            timer = rand(1.5, 2.9) / (1 + G.level * 0.07);
            const lead = 1.0;
            const p = { x: flock.leader.x + (Math.random() < 0.6 ? rand(-4, 4) : rand(-30, 30)), z: flock.leader.z - c.speed * lead, t: lead };
            pending.push(p);
            sky.telegraph(p.x, p.z, lead);
          }
        }
        for (let i = pending.length - 1; i >= 0; i--) {
          const p = pending[i];
          p.t -= dt;
          if (p.t > 0) continue;
          pending.splice(i, 1);
          sky.strike(p.x, p.z, G.camera.position);
          audio.thunder();
          G.shake = Math.max(G.shake, 0.5);
          fx.burst(10, { x: p.x, y: Math.max(1, heightAt(p.x, p.z)) + 1, z: p.z, life: 0.5, size: 9, color: [1, 0.96, 0.8], alpha: 0.7 }, 8, 20);
          let n = 0;
          for (const b of [...flock.birds]) {
            if (n < 2 && b.pos.y > 33 && b.pos.y < 108 && Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < 13) {
              G.hit(b, 'lightning', it, true);
              n++;
            }
          }
        }
        return it.far < c.z + 250 || pending.length > 0;
      },
      test: () => false,
      remove() {},
    };
    return it;
  }

  // ------------------------------------------------------------------- hunter
  function hunter(x, z) {
    const mesh = mk('hunter');
    const y = heightAt(x, z);
    mesh.position.set(x, y - 0.15, z);
    mesh.rotation.y = Math.PI;
    let cool = rand(0.2, 0.9);
    let aim = 0;
    const it = {
      kind: 'hunter', warn: null, x, y, z, hits: 0, max: 99, reach: 0,
      update(dt) {
        const c = flock.ctrl;
        const ahead = c.z - z;
        const inRange = ahead > 12 && ahead < 150 && c.y < 36 && Math.abs(x - c.x) < 100 && flock.birds.length > 0;
        if (inRange) mesh.rotation.y = Math.atan2(x - flock.leader.x, z - flock.leader.z);
        const tip = v3.set(0.05, 5.4, -2.8).applyAxisAngle(THREE.Object3D.DEFAULT_UP, mesh.rotation.y).add(mesh.position);
        cool -= dt;
        if (aim > 0) {
          aim -= dt;
          if (Math.random() < 0.5) fx.spawn({ x: tip.x, y: tip.y, z: tip.z, life: 0.12, size: 2.6, color: [1, 0.95, 0.7], alpha: 0.9 });
          if (aim <= 0 && inRange) {
            const target = pick(flock.birds);
            const from = tip.clone();
            let tt = from.distanceTo(target.pos) / 95;
            const to = new THREE.Vector3();
            for (let i = 0; i < 2; i++) {
              to.copy(target.pos).addScaledVector(target.vel, tt);
              tt = from.distanceTo(to) / 95;
            }
            to.x += rand(-1.6, 1.6);
            to.y += rand(-1.2, 1.2);
            shots.push({ pos: from, vel: to.sub(from).normalize().multiplyScalar(95), life: 0, owner: it });
            fx.burst(8, { x: from.x, y: from.y, z: from.z, vy: 3, life: 1.1, size: 3, grow: 2, color: [0.92, 0.9, 0.86], alpha: 0.5, drag: 2 }, 0.6, 5);
            audio.shot(clamp(1 - ahead / 200));
            cool = rand(1.5, 2.4) / (1 + G.level * 0.05);
          }
        } else if (inRange && cool <= 0) {
          aim = 0.55;
        }
        return z < c.z + 120;
      },
      test: () => false,
      remove: () => scene.remove(mesh),
    };
    return it;
  }

  // ------------------------------------------------------------- power lines
  function pylons(z0, slope) {
    const SP = 80;
    const towers = [];
    const norm = Math.hypot(1, slope);
    const az = 1 / norm; // how far an arm reaches along z
    const ax = -slope / norm;
    for (let i = 0; i < 7; i++) {
      const x = -240 + i * SP;
      const z = z0 + x * slope;
      const base = floorAt(x, z) + 0.4;
      const mesh = mk('pylon');
      mesh.position.set(x, base - 0.3, z);
      mesh.rotation.y = Math.atan2(-az, ax);
      towers.push({ x, z, base, mesh });
    }
    const LEVELS = [[16, 6.2], [20, 4.8]];
    const pts = [];
    for (let i = 0; i < towers.length - 1; i++) {
      const a = towers[i];
      const b = towers[i + 1];
      for (const [h, w] of LEVELS) {
        for (const s of [-1, 1]) {
          for (let q = 0; q < 10; q++) {
            for (const k of [q / 10, (q + 1) / 10]) {
              pts.push(lerp(a.x, b.x, k) + ax * w * s, lerp(a.base, b.base, k) + h - 7.2 * k * (1 - k), lerp(a.z, b.z, k) + az * w * s);
            }
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const wires = new THREE.LineSegments(geo, wireMat);
    wires.frustumCulled = false;
    scene.add(wires);
    const it = {
      kind: 'wires', warn: null, x: 0, y: 18, z: z0, hits: 0, max: 99, reach: 110,
      update: () => z0 - Math.abs(slope) * 240 < flock.ctrl.z + 160,
      test(b) {
        const f = (b.pos.x + 240) / SP;
        const i = Math.floor(f);
        if (i < 0 || i >= towers.length - 1) return false;
        const k = f - i;
        const a = towers[i];
        const c = towers[i + 1];
        const base = lerp(a.base, c.base, k);
        const zw = lerp(a.z, c.z, k);
        for (const [h, w] of LEVELS) {
          if (Math.abs(b.pos.y - (base + h - 7.2 * k * (1 - k))) > 1.2) continue;
          if (Math.abs(Math.abs(b.pos.z - zw) - w * az) < 1.1) return true;
        }
        for (const t of [a, c]) {
          if (b.pos.y < t.base + 25 && Math.hypot(b.pos.x - t.x, b.pos.z - t.z) < 3.2) return true;
        }
        return false;
      },
      remove() {
        towers.forEach((t) => scene.remove(t.mesh));
        scene.remove(wires);
        geo.dispose();
      },
    };
    return it;
  }

  function turbine(x, z) {
    const base = floorAt(x, z) + 0.4;
    const mesh = mk('turbine_tower');
    mesh.position.set(x, base - 0.3, z);
    mesh.rotation.y = Math.PI;
    const rotor = mk('turbine_rotor', mesh);
    rotor.position.copy(kit.turbine_rotor.offset);
    rotor.rotation.z = Math.random() * 6;
    const hub = base + 31.1;
    const it = {
      kind: 'turbine', warn: null, x, y: hub, z, hits: 0, max: 99, reach: 30,
      update(dt) {
        rotor.rotation.z += dt * 1.5;
        return z < flock.ctrl.z + 120;
      },
      test(b) {
        const dx = b.pos.x - x;
        const dz = b.pos.z - z;
        if (b.pos.y < hub && dx * dx + dz * dz < 6.5) return true;
        return Math.abs(dz - 1.3) < 2.2 && Math.hypot(dx, b.pos.y - hub) < 12.9;
      },
      remove: () => scene.remove(mesh),
    };
    return it;
  }

  // ----------------------------------------------------------------- director
  const D = { air: 0, ground: 0, stray: 0, traffic: 0, moves: 0 };
  // How close each kind may pass and still count as a near miss.
  const NEAR = { plane: 12, airliner: 22, balloon: 13 };
  const AIRCRAFT = ['biplane', 'crosser', 'airliner', 'behind'];
  const add = (it) => it && items.push(it);
  const dry = (x, z) => relAt(x, z) > 1.2;

  function airEvent(z, xr) {
    const lv = G.level;
    const c = flock.ctrl;
    const options = ['balloons', 'biplane', 'biplane'];
    if (lv >= 1) options.push('airliner', 'hawk', 'crosser', 'behind');
    if (lv >= 2) options.push('storm', 'hawk', 'behind');
    if (lv >= 3) options.push('storm', 'airliner');
    let what = G.dist < 500 ? 'balloons' : pick(options);
    // Away from an airport the sky is mostly empty of aircraft.
    if (AIRCRAFT.includes(what) && Math.random() > TUNE.threats.aircraftElsewhere) what = pick(lv >= 2 ? ['balloons', 'hawk', 'hawk', 'storm'] : lv >= 1 ? ['balloons', 'hawk'] : ['balloons']);
    if (lv >= 2 && Math.random() < 0.045) what = 'crash';
    let gap = lerp(430, 200, clamp(lv / 11)) * rand(0.8, 1.25);
    const lane = (spread) => clamp(c.x + rand(-spread, spread), -xr, xr);
    // Jets cruise high: a flock that has climbed out of the way of everything else meets them there.
    const jetLevel = () => (c.high > 0.5 ? c.y : CRUISE);
    switch (what) {
      case 'balloons': {
        // Strung out along the route and across more than its width, never in a tight knot.
        const n = 3 + Math.min(2, Math.floor(lv / 3));
        for (let i = 0; i < n; i++) add(balloon(lerp(-xr * 1.25, xr * 1.25, (i + rand(0.2, 0.8)) / n), CRUISE + rand(-6, 9), z - i * rand(70, 110) - rand(0, 40)));
        gap += n * 60;
        break;
      }
      // Aircraft always come one at a time.
      case 'biplane':
        add(plane('biplane', lane(14), CRUISE + rand(-3, 3), z - 60, 0, 40));
        break;
      case 'crosser': {
        const side = Math.random() < 0.5 ? -1 : 1;
        add(plane('biplane', side * 250, CRUISE + rand(-2, 3), c.z - 250 * (c.speed / 40) - 60 - rand(0, 30), -side * 40, 9));
        break;
      }
      case 'airliner':
        add(plane('airliner', lane(12), jetLevel() + rand(-2, 3), z - 80, 0, 30));
        break;
      case 'behind': {
        // Overtaking from behind: heard and flagged at the bottom edge before it is seen.
        const big = Math.random() < 0.5;
        add(plane(big ? 'airliner' : 'biplane', lane(10), (big ? jetLevel() : CRUISE) + rand(-2, 3), c.z + 250, 0, -(c.speed + (big ? 34 : 28))));
        break;
      }
      case 'crash':
        add(crash());
        gap += 200;
        break;
      case 'hawk':
        add(hawk(Math.random() < 0.5 ? -1 : 1, 0));
        if (lv >= 6) add(hawk(Math.random() < 0.5 ? -1 : 1, 1.6));
        audio.screech();
        break;
      default: {
        const length = Math.min(900, 520 + lv * 40);
        add(storm(z + 150, length));
        gap = length + 260;
      }
    }
    return gap;
  }

  function groundEvent(z) {
    const lv = G.level;
    const options = { [BIOME.FARM]: ['hunters', 'pylons', 'turbines'], [BIOME.TOWN]: ['pylons'], [BIOME.MEADOW]: ['turbines', 'hunters'], [BIOME.FOREST]: ['hunters'], [BIOME.HILLS]: ['hunters', 'turbines'], [BIOME.BASIN]: ['hunters'] }[biomeAt(z)];
    if (!options) return;
    const what = pick(options);
    if (what === 'hunters') {
      const n = Math.min(4, 1 + Math.floor(lv / 3) + (Math.random() < 0.5 ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const x = rand(-55, 55);
        const hz = z - i * rand(35, 70);
        if (dry(x, hz)) add(hunter(x, hz));
      }
    } else if (what === 'pylons') {
      add(pylons(z, rand(-0.3, 0.3)));
    } else {
      const n = 3 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const x = -52 + (i * 104) / (n - 1) + rand(-8, 8);
        const tz = z + rand(-30, 30);
        if (dry(x, tz)) add(turbine(x, tz));
      }
    }
  }

  // Around an airport the traffic is steady: landings and take-offs by turns,
  // all using the runway in the same direction.
  function traffic(ap, dt) {
    D.traffic -= dt;
    if (D.traffic > 0) return;
    D.traffic = rand(0.75, 1.25) * TUNE.threats.airportInterval / (1 + G.level * 0.04);
    const dir = ap.i % 2 ? 1 : -1;
    add(flight(Math.random() < 0.65 ? 'airliner' : 'biplane', ap, D.moves++ % 2 === 0, dir));
  }

  function direct(xr, dt) {
    const c = flock.ctrl;
    const dist = G.dist;
    const z = c.z - 560;
    const ap = airportNear(c.z, 1250, 950);
    if (ap) traffic(ap, dt);
    if (dist > D.air) {
      // Nothing else shares the air over the field itself.
      const field = ap && z < ap.near + 250 && z > ap.far - 250;
      D.air = sky.inStorm(z) || field ? dist + 120 : dist + airEvent(z, xr) * TUNE.threats.gap;
    }
    if (dist > D.ground) {
      groundEvent(z + 60);
      D.ground = dist + rand(250, 420) * (sky.inStorm(z) ? 0.55 : 1) * lerp(1, 0.7, clamp(G.level / 10));
    }
    if (dist > D.stray) {
      D.stray = dist + 330 + flock.birds.length * 40 + rand(0, 160);
      if (flock.birds.length + flock.strays.length < MAX_BIRDS) {
        const n = flock.birds.length <= 3 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const low = Math.random() < 0.45 || sky.inStorm(c.z - 150);
          const x = rand(-xr * 0.8, xr * 0.8);
          const sz = c.z - 150 - i * 12;
          flock.addStray(x, low ? Math.max(13, heightAt(x, sz - 60) + 9) : CRUISE + rand(-3, 3), sz);
        }
      }
    }
  }

  // ------------------------------------------------------------------- update
  function update(dt, xr, playing) {
    if (playing) direct(xr, dt);
    const c = flock.ctrl;
    let hn = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (!it.update(dt)) {
        it.remove();
        items.splice(i, 1);
        continue;
      }
      if (it.kind === 'hawk' && hn < HAWKS) {
        quat.setFromEuler(euler.set(Math.asin(clamp(it.dir.y, -1, 1)), Math.atan2(-it.dir.x, -it.dir.z), 0));
        m4.compose(it.pos, quat, v3.set(1.3, 1.3, 1.3));
        hawkMesh.setMatrixAt(hn, m4);
        hawkFlap.array.set([it.phase, it.amp, 1 - it.amp, 0], hn * 4);
        hn++;
      }
      // A near miss: something that went past within a wing's reach without touching a bird.
      const close = NEAR[it.big ? 'airliner' : it.kind];
      if (playing && close && !it.passed) {
        const ahead = c.z - it.z;
        if (it.side === undefined) it.side = Math.sign(ahead) || 1;
        if (Math.abs(ahead) < 30) {
          for (const b of flock.birds) it.closest = Math.min(it.closest ?? 1e9, Math.hypot(b.pos.x - it.x, b.pos.y - it.y, b.pos.z - it.z));
        }
        if (ahead * it.side < -8) {
          it.passed = true;
          if (it.hits === 0 && it.closest < close) G.moment('near');
        }
        // A jet close by shakes the air.
        if (it.big) G.shake = Math.max(G.shake, 0.45 * (1 - clamp(Math.hypot(it.x - c.x, it.y - c.y, it.z - c.z) / 60)));
      }
      if (!playing || it.hits >= it.max || Math.abs(it.z - c.z) > it.reach + 40) continue;
      for (const b of [...flock.birds]) {
        if (it.hits < it.max && it.test(b)) G.hit(b, it.kind, it);
      }
    }
    hawkMesh.count = hn;
    hawkMesh.instanceMatrix.needsUpdate = true;
    hawkFlap.needsUpdate = true;

    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.life += dt;
      s.pos.addScaledVector(s.vel, dt);
      fx.spawn({ x: s.pos.x, y: s.pos.y, z: s.pos.z, life: 0.28, size: 1.5, color: [1, 0.93, 0.7], alpha: 0.95 });
      let done = s.life > 1.6;
      if (playing && !done) {
        for (const b of flock.birds) {
          if (near(b, s.pos.x, s.pos.y, s.pos.z, 2.1)) {
            G.hit(b, 'hunter', s.owner);
            done = true;
            break;
          }
        }
      }
      if (done) shots.splice(i, 1);
    }

    if (playing) {
      for (const b of [...flock.birds]) {
        const what = G.world.hit(b.pos.x, b.pos.y, b.pos.z);
        if (what) G.hit(b, what, null);
      }
    }
  }

  // Things worth pointing at from the edge of the screen.
  function warnings(out) {
    out.length = 0;
    const c = flock.ctrl;
    for (const it of items) {
      if (!it.warn) continue;
      const ahead = c.z - it.z;
      if (it.behind) {
        // Coming up from behind: flagged at the bottom edge, at its lane.
        if (ahead < -12) out.push({ kind: it.warn, x: it.x, y: c.y, z: c.z - 4, ahead: 0, bottom: true });
      } else if (it.kind === 'crash') {
        out.push({ kind: 'crash', x: it.x, y: it.y, z: it.z, ahead: 0, always: true });
      } else if (ahead > 25 && ahead < 560) out.push({ kind: it.warn, x: it.x, y: it.y, z: it.z, ahead });
    }
    for (const s of flock.strays) {
      const ahead = c.z - s.pos.z;
      if (ahead > 25) out.push({ kind: 'stray', x: s.pos.x, y: s.pos.y, z: s.pos.z, ahead });
    }
    return out;
  }

  function reset() {
    for (const it of items) it.remove();
    items.length = shots.length = 0;
    D.air = 330;
    D.ground = 220;
    D.stray = 260;
    D.traffic = 0;
  }

  function dispose() {
    reset();
    mat.dispose();
    airMat.dispose();
    hawkMat.dispose();
    wireMat.dispose();
  }

  return { update, warnings, reset, dispose, items, materials: [mat, airMat], spawn: { add, plane, flight, balloon, hawk, storm, hunter, pylons, turbine, crash } };
}
