// Light and weather: the time of day (a slow loop of palettes), the sky dome,
// drifting clouds, storm cells, rain and lightning.
import * as THREE from 'three';
import { cloudMaterial, makeBlobTexture, rainMaterial, skyMaterial } from './materials';
import { clamp, damp, lerp, smoothstep } from './noise';
import { TUNE } from './tuning';

// One entry per moment of the day; the game loops through them.
const DAY = [
  { sun: [1.25, 1.0, 0.72], shade: [0.56, 0.58, 0.76], top: [0.42, 0.66, 0.9], fog: [0.98, 0.86, 0.68], glow: [1.0, 0.82, 0.5], lit: [1.0, 0.95, 0.85], dim: [0.78, 0.7, 0.78], water: [0.14, 0.42, 0.55], elev: 30 },
  { sun: [1.12, 1.08, 0.98], shade: [0.6, 0.65, 0.8], top: [0.3, 0.6, 0.93], fog: [0.84, 0.9, 0.93], glow: [1.0, 0.97, 0.85], lit: [1.0, 1.0, 1.0], dim: [0.72, 0.78, 0.9], water: [0.1, 0.4, 0.62], elev: 60 },
  { sun: [1.3, 0.82, 0.5], shade: [0.5, 0.42, 0.7], top: [0.38, 0.42, 0.75], fog: [1.0, 0.68, 0.5], glow: [1.0, 0.6, 0.3], lit: [1.0, 0.75, 0.6], dim: [0.6, 0.45, 0.65], water: [0.2, 0.3, 0.5], elev: 16 },
  { sun: [0.62, 0.7, 1.0], shade: [0.22, 0.27, 0.5], top: [0.08, 0.12, 0.32], fog: [0.3, 0.36, 0.58], glow: [0.5, 0.5, 0.75], lit: [0.5, 0.56, 0.8], dim: [0.2, 0.24, 0.42], water: [0.06, 0.14, 0.3], elev: 42 },
  { sun: [1.2, 0.85, 0.7], shade: [0.42, 0.42, 0.7], top: [0.4, 0.5, 0.8], fog: [0.98, 0.74, 0.68], glow: [1.0, 0.7, 0.55], lit: [1.0, 0.8, 0.75], dim: [0.6, 0.5, 0.7], water: [0.2, 0.32, 0.5], elev: 13 },
];
const STORM = { sun: [0.6, 0.64, 0.7], shade: [0.36, 0.4, 0.48], top: [0.28, 0.32, 0.38], fog: [0.5, 0.54, 0.58], glow: [0.56, 0.6, 0.64], lit: [0.62, 0.65, 0.7], dim: [0.3, 0.33, 0.4], water: [0.14, 0.24, 0.3] };
const PHASE = 52; // seconds per moment of the day
const KEYS = ['sun', 'shade', 'top', 'fog', 'glow', 'lit', 'dim', 'water'];

export function createSky(scene, U, { lite }) {
  const targets = { sun: U.uSunCol, shade: U.uShadeCol, top: U.uSkyTop, fog: U.uFogCol, glow: U.uFogSun, lit: U.uCloudLit, dim: U.uCloudShade, water: U.uWaterCol };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), skyMaterial(U));
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  // --------------------------------------------------------------------- clouds
  const CAP = lite ? 150 : 300;
  const cloudGeo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  cloudGeo.setAttribute('position', quad.attributes.position);
  cloudGeo.setAttribute('uv', quad.attributes.uv);
  cloudGeo.setIndex(quad.index);
  const posAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  const shapeAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  cloudGeo.setAttribute('aPos', posAttr);
  cloudGeo.setAttribute('aShape', shapeAttr);
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMaterial(U));
  cloudMesh.frustumCulled = false;
  cloudMesh.renderOrder = 3;
  scene.add(cloudMesh);

  const rand = (a, b) => a + Math.random() * (b - a);
  const clouds = [];
  const deco = (high, z) => {
    const w = high ? rand(170, 330) : rand(46, 100);
    return { x: high ? rand(-750, 750) : rand(-340, 340), y: high ? rand(175, 270) : rand(26, 43), z, w, h: w * rand(0.42, 0.6), flip: Math.random() < 0.5 ? -1 : 1, dark: 0, deco: true, high };
  };
  for (let i = 0; i < (lite ? 12 : 24); i++) clouds.push(deco(false, rand(-1300, 150)));
  for (let i = 0; i < (lite ? 12 : 22); i++) clouds.push(deco(true, rand(-1500, 100)));

  const storms = []; // { near, far } along z (near > far)
  function addStorm(near, length) {
    storms.push({ near, far: near - length });
    const n = Math.round((length / 9) * (lite ? 0.5 : 1));
    for (let i = 0; i < n && clouds.length < CAP; i++) {
      const w = rand(80, 170);
      clouds.push({ x: rand(-330, 330), y: rand(47, 86), z: near - rand(0, length), w, h: w * rand(0.5, 0.7), flip: Math.random() < 0.5 ? -1 : 1, dark: rand(0.55, 1), deco: false });
    }
  }
  const stormAt = (z) => {
    let k = 0;
    for (const s of storms) k = Math.max(k, smoothstep(s.near + 120, s.near - 40, z) * smoothstep(s.far - 120, s.far + 40, z));
    return k;
  };
  const inStorm = (z) => storms.some((s) => z < s.near && z > s.far);

  // ----------------------------------------------------------------------- rain
  const DROPS = lite ? 700 : 1600;
  const rp = new Float32Array(DROPS * 6);
  const re = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i++) {
    const x = Math.random() * 170;
    const y = Math.random() * 130;
    const z = Math.random() * 170;
    rp.set([x, y, z, x, y, z], i * 6);
    re[i * 2 + 1] = 1;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
  const rainMat = rainMaterial(U);
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 5;
  scene.add(rain);

  // ------------------------------------------------------------------ lightning
  const glowMat = () => new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  // Where the next bolt will land: the air there starts to glow in an uneven,
  // flickering patch, and thin leaders of light feel their way down from the cloud.
  const blob = makeBlobTexture();
  const patchGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const LEADER = 12;
  const columns = Array.from({ length: 3 }, () => {
    const material = glowMat();
    material.depthTest = false;
    material.map = blob;
    const line = glowMat();
    line.depthTest = false;
    line.color.set(0xffffff);
    const mesh = new THREE.Group();
    const patches = [new THREE.Mesh(patchGeo, material), new THREE.Mesh(patchGeo, material), new THREE.Mesh(patchGeo, material)];
    const leaders = [0, 1, 2].map(() => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LEADER * 2 * 3), 3));
      const index = [];
      for (let i = 0; i < LEADER - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      geo.setIndex(index);
      const m = new THREE.Mesh(geo, line);
      m.frustumCulled = false;
      return m;
    });
    mesh.add(...patches, ...leaders);
    mesh.children.forEach((m) => (m.renderOrder = 6));
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, material, line, patches, leaders, t: 0, dur: 1, crackle: 0 };
  });
  // A jagged ribbon from (0, y0, 0) wandering down to y1, facing the camera.
  function jag(geo, n, y0, y1, wander, width, side) {
    const P = geo.attributes.position.array;
    let ox = 0;
    let oz = 0;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      if (i) {
        ox += rand(-wander, wander);
        oz += rand(-wander, wander);
      }
      const w = width * (1 - k * 0.7);
      P.set([ox - side.x * w, lerp(y0, y1, k), oz - side.z * w, ox + side.x * w, lerp(y0, y1, k), oz + side.z * w], i * 6);
    }
    geo.attributes.position.needsUpdate = true;
  }
  const sideways = new THREE.Vector3();
  const BOLT = 16;
  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT * 2 * 3), 3));
  const boltIndex = [];
  for (let i = 0; i < BOLT - 1; i++) boltIndex.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  boltGeo.setIndex(boltIndex);
  const bolt = new THREE.Mesh(boltGeo, glowMat());
  bolt.material.color.set(0xffffff);
  bolt.frustumCulled = false;
  bolt.visible = false;
  bolt.renderOrder = 7;
  scene.add(bolt);
  let boltLife = 0;

  // A glowing column marks where the next bolt will land.
  function telegraph(x, z, dur) {
    const c = columns.find((q) => !q.mesh.visible) || columns[0];
    c.mesh.position.set(x, 62, z);
    c.mesh.visible = true;
    c.t = 0;
    c.dur = dur;
    c.crackle = 0;
    // Three overlapping smears of different shapes, so the glow is never a neat circle.
    c.patches.forEach((p, i) => {
      p.position.set(rand(-5, 5), i * 0.4, rand(-5, 5));
      p.rotation.y = rand(0, 6.28);
      p.userData.size = [rand(20, 34), rand(11, 20)];
    });
  }
  function strike(x, z, cam) {
    const P = boltGeo.attributes.position.array;
    const side = new THREE.Vector3(cam.x - x, 0, cam.z - z).cross(new THREE.Vector3(0, 1, 0)).normalize();
    let ox = 0;
    let oz = 0;
    for (let i = 0; i < BOLT; i++) {
      const k = i / (BOLT - 1);
      const y = 92 - k * 92;
      if (i && i < BOLT - 1) {
        ox += rand(-4, 4);
        oz += rand(-4, 4);
      }
      const wdt = 0.5 + (1 - k) * 0.9;
      P.set([x + ox - side.x * wdt, y, z + oz - side.z * wdt, x + ox + side.x * wdt, y, z + oz + side.z * wdt], i * 6);
    }
    boltGeo.attributes.position.needsUpdate = true;
    bolt.visible = true;
    boltLife = 0.22;
    U.uFlash.value = 1;
  }

  // ----------------------------------------------------------------------- update
  let clock = 0;
  let storm = 0;
  let rainK = 0;
  let drizzle = 0;
  const col = [0, 0, 0];

  function update(dt, z, cam, speed) {
    clock += (dt * PHASE) / TUNE.day.secondsPerPhase;
    const target = stormAt(z);
    storm += (target - storm) * damp(0.9, dt);
    rainK += (Math.max(target, drizzle) - rainK) * damp(0.7, dt);

    const f = TUNE.day.time === 'cycle' ? (clock / PHASE) % DAY.length : Number(TUNE.day.time);
    const a = DAY[Math.floor(f)];
    const b = DAY[(Math.floor(f) + 1) % DAY.length];
    const k = smoothstep(0.35, 1, f - Math.floor(f));
    for (const key of KEYS) {
      for (let i = 0; i < 3; i++) col[i] = lerp(lerp(a[key][i], b[key][i], k), STORM[key][i] * (0.55 + 0.45 * lerp(a.sun[1], b.sun[1], k)), storm * 0.85);
      targets[key].value.setRGB(col[0], col[1], col[2]);
    }
    const el = (lerp(a.elev, b.elev, k) * Math.PI) / 180;
    U.uSun.value.set(Math.cos(el) * 0.5, Math.sin(el), -Math.cos(el) * 0.866).normalize();
    U.uFogDensity.value = (lite ? 0.0021 : 0.0016) * (1 + storm * 1.1 + rainK * 0.5) * TUNE.light.fog;
    U.uWet.value = rainK;
    U.uStorm.value = storm;
    U.uFlash.value *= Math.exp(-dt * 7);

    // Clouds: recycle the decorative ones ahead, drop storm clouds behind.
    let n = 0;
    for (let i = clouds.length - 1; i >= 0; i--) {
      const c = clouds[i];
      if (c.z > z + (c.high ? 500 : 190)) {
        if (c.deco) Object.assign(c, deco(c.high, c.z - (c.high ? 2000 : 1450)));
        else clouds.splice(i, 1);
      }
    }
    for (const c of clouds) {
      if (n >= CAP) break;
      posAttr.array.set([c.x, c.y, c.z], n * 3);
      shapeAttr.array.set([c.w, c.h, c.flip, c.dark], n * 4);
      n++;
    }
    cloudGeo.instanceCount = n;
    posAttr.needsUpdate = true;
    shapeAttr.needsUpdate = true;
    for (let i = storms.length - 1; i >= 0; i--) if (storms[i].far > z + 300) storms.splice(i, 1);

    rainMat.uniforms.uRain.value = rainK;
    rainMat.uniforms.uCenter.value.copy(cam);
    rainMat.uniforms.uDrift.value.set(9, -78, speed * 0.9);
    rain.visible = rainK > 0.02;

    for (const c of columns) {
      if (!c.mesh.visible) continue;
      c.t += dt;
      const q = c.t / c.dur;
      // The glow gathers and tightens; the leaders crackle, reaching lower each time.
      const flick = 0.75 + 0.25 * Math.sin(c.t * 47) * Math.sin(c.t * 31);
      c.material.opacity = (0.42 + 0.55 * q * q) * flick;
      c.patches.forEach((p, i) => {
        const breathe = 1.25 - 0.45 * q + 0.08 * Math.sin(c.t * (9 + i * 4) + i);
        p.scale.set(p.userData.size[0] * breathe, 1, p.userData.size[1] * breathe);
      });
      c.crackle -= dt;
      if (c.crackle <= 0) {
        c.crackle = rand(0.04, 0.1);
        sideways.set(cam.x - c.mesh.position.x, 0, cam.z - c.mesh.position.z).cross(dome.up).normalize();
        c.leaders.forEach((l, i) => {
          l.visible = i === 0 || Math.random() < 0.6;
          l.position.set(i ? rand(-7, 7) : 0, 0, i ? rand(-7, 7) : 0);
          jag(l.geometry, LEADER, 18, lerp(8, i ? -2 : -10, q) + rand(0, 4), 2.4, i ? 0.2 : 0.34, sideways);
        });
        c.line.opacity = (0.4 + 0.6 * q) * rand(0.6, 1);
      }
      if (q >= 1) c.mesh.visible = false;
    }
    if (bolt.visible) {
      boltLife -= dt;
      bolt.material.opacity = clamp(boltLife / 0.22) * (Math.random() < 0.8 ? 1 : 0.3);
      if (boltLife <= 0) bolt.visible = false;
    }
  }

  function reset() {
    storms.length = 0;
    for (let i = clouds.length - 1; i >= 0; i--) if (!clouds[i].deco) clouds.splice(i, 1);
    drizzle = 0;
    for (const c of columns) c.mesh.visible = false;
  }

  function dispose() {
    dome.geometry.dispose();
    dome.material.dispose();
    cloudGeo.dispose();
    cloudMesh.material.dispose();
    rainGeo.dispose();
    rainMat.dispose();
    patchGeo.dispose();
    blob.dispose();
    columns.forEach((c) => {
      c.material.dispose();
      c.line.dispose();
      c.leaders.forEach((l) => l.geometry.dispose());
    });
    boltGeo.dispose();
    bolt.material.dispose();
  }

  return {
    update, addStorm, stormAt, inStorm, telegraph, strike, reset, dispose,
    setDrizzle: (v) => (drizzle = v),
    setClock: (v) => (clock = v),
    get storm() { return storm; },
    get rain() { return rainK; },
  };
}
