// Small shared effects: soft particles (feathers, sparkles, smoke) and the
// shadows that birds and aircraft drop on the ground.
import * as THREE from 'three';
import { floorAt } from './ground';
import { particleMaterial, silhouetteMaterial } from './materials';
import { TUNE } from './tuning';

const COLS = 4;
const ROWS = 2;
const TILE = 256;
const FLYERS = ['bird', 'hawk', 'airliner', 'biplane', 'balloon'];

// Draws each flyer from straight above into a tile of one canvas.
// Returns the texture and, per flyer, its tile and the ground size the tile covers.
function bakeSilhouettes(kit) {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  const tiles = {};
  FLYERS.forEach((name, n) => {
    const geo = kit[name] && kit[name].geometry;
    if (!geo) return;
    const P = geo.attributes.position;
    const I = geo.index;
    let reach = 0;
    for (let i = 0; i < P.count; i++) reach = Math.max(reach, Math.abs(P.getX(i)), Math.abs(P.getZ(i)));
    const size = reach * 2 * 1.5; // a wide margin, so even a very soft edge stays inside the tile
    const col = n % COLS;
    const row = Math.floor(n / COLS);
    const px = (i) => (col + 0.5 + P.getX(i) / size) * TILE;
    const py = (i) => (row + 0.5 + P.getZ(i) / size) * TILE;
    g.beginPath();
    const count = I ? I.count : P.count;
    for (let t = 0; t < count; t += 3) {
      let a = I ? I.getX(t) : t;
      let b = I ? I.getX(t + 1) : t + 1;
      const c = I ? I.getX(t + 2) : t + 2;
      // One winding for every triangle, so overlapping ones never cancel out.
      if ((px(b) - px(a)) * (py(c) - py(a)) - (py(b) - py(a)) * (px(c) - px(a)) < 0) [a, b] = [b, a];
      g.moveTo(px(a), py(a));
      g.lineTo(px(b), py(b));
      g.lineTo(px(c), py(c));
      g.closePath();
    }
    g.fill();
    tiles[name] = { size, u: col / COLS, v: 1 - (row + 1) / ROWS };
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return { texture, tiles };
}

export function createFx(scene, U, kit) {
  // ------------------------------------------------------------------ particles
  const CAP = 500;
  const P = new Float32Array(CAP * 3);
  const C = new Float32Array(CAP * 4);
  const S = new Float32Array(CAP);
  const live = [];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(C, 4));
  geo.setAttribute('aSize', new THREE.BufferAttribute(S, 1));
  const partMat = particleMaterial(U);
  const points = new THREE.Points(geo, partMat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  scene.add(points);

  // p: { x, y, z, vx, vy, vz, life, size, grow, color: [r, g, b], alpha, gravity, drag }
  function spawn(p) {
    if (live.length >= CAP) live.shift();
    live.push({ vx: 0, vy: 0, vz: 0, grow: 0, alpha: 1, gravity: 0, drag: 0, color: [1, 1, 1], ...p, age: 0 });
  }
  function burst(n, base, spread, speed) {
    for (let i = 0; i < n; i++) {
      spawn({
        ...base,
        x: base.x + (Math.random() - 0.5) * spread,
        y: base.y + (Math.random() - 0.5) * spread,
        z: base.z + (Math.random() - 0.5) * spread,
        vx: (base.vx || 0) + (Math.random() - 0.5) * speed,
        vy: (base.vy || 0) + (Math.random() - 0.5) * speed,
        vz: (base.vz || 0) + (Math.random() - 0.5) * speed,
        life: base.life * (0.6 + Math.random() * 0.8),
      });
    }
  }

  // -------------------------------------------------------------------- shadows
  // Each flyer drops a shadow in its own shape: the models are drawn once, from
  // straight above, into one atlas, and a shadow is a ground quad showing its tile.
  const SCAP = 96;
  const atlas = bakeSilhouettes(kit);
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(SCAP * 4), 4); // tile u, tile v, blur, alpha
  shadowGeo.setAttribute('aShade', shadeAttr);
  const shadows = new THREE.InstancedMesh(shadowGeo, silhouetteMaterial(U, atlas.texture, COLS, ROWS), SCAP);
  shadows.frustumCulled = false;
  shadows.renderOrder = 2;
  scene.add(shadows);
  const m4 = new THREE.Matrix4();
  const level = floorAt;
  let sn = 0;

  // Drop the shadow of a `kind` of flyer at (x, y, z), turned by `yaw`.
  // `squash` narrows it across the wings, for a wing on the up or down stroke.
  function shadow(kind, x, y, z, yaw = 0, scale = 1, squash = 1) {
    const tile = atlas.tiles[kind];
    if (sn >= SCAP || !tile) return;
    // Shadows fall forward along the route and a little to the left, the side
    // the sun throws the trees' shadows. Seen from the tilted overhead camera
    // that puts each one just below and beside whatever casts it, so a shadow
    // on the ground marks where something in the air really is.
    const alt = Math.max(0, y - level(x, z));
    const gx = x - alt * TUNE.shadows.throwLeft;
    const gz = z - alt * TUNE.shadows.throwAhead;
    const cs = Math.cos(yaw);
    const si = Math.sin(yaw);
    const w = tile.size * scale * squash;
    const l = tile.size * scale;
    // Lie along the slope of the ground instead of cutting into it.
    const ex = Math.min(w / 2, 7);
    const ez = Math.min(l / 2, 7);
    const x0 = level(gx - cs * ex, gz + si * ex);
    const x1 = level(gx + cs * ex, gz - si * ex);
    const z0 = level(gx - si * ez, gz - cs * ez);
    const z1 = level(gx + si * ez, gz + cs * ez);
    const gy = (x0 + x1 + z0 + z1) / 4 + 0.3;
    m4.set(
      cs * w, 0, si * l, gx,
      ((x1 - x0) / (2 * ex)) * w, 1, ((z1 - z0) / (2 * ez)) * l, gy,
      -si * w, 0, cs * l, gz,
      0, 0, 0, 1,
    );
    shadows.setMatrixAt(sn, m4);
    // The higher the flyer, the softer its shadow: a vague shape from cruising
    // height, every feather when it skims the ground.
    shadeAttr.array.set([tile.u, tile.v, Math.min(0.16, ((0.1 + alt * 0.016) * TUNE.shadows.softness) / l), 1 - Math.min(0.3, alt * 0.004)], sn * 4);
    sn++;
  }

  function update(dt) {
    let n = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      if (p.age >= p.life) {
        live.splice(i, 1);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d - p.gravity * dt;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    for (const p of live) {
      const k = p.age / p.life;
      P[n * 3] = p.x;
      P[n * 3 + 1] = p.y;
      P[n * 3 + 2] = p.z;
      C[n * 4] = p.color[0];
      C[n * 4 + 1] = p.color[1];
      C[n * 4 + 2] = p.color[2];
      C[n * 4 + 3] = p.alpha * Math.min(1, k * 8) * (1 - k * k);
      S[n] = p.size * (1 + p.grow * k);
      n++;
    }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;

    shadows.material.uniforms.uStrength.value = TUNE.shadows.strength;
    shadows.count = sn;
    shadows.instanceMatrix.needsUpdate = true;
    shadeAttr.needsUpdate = true;
    sn = 0;
  }

  function setViewport(height, fov) {
    partMat.uniforms.uScale.value = height / (2 * Math.tan((fov * Math.PI) / 360));
  }

  function dispose() {
    geo.dispose();
    partMat.dispose();
    shadowGeo.dispose();
    atlas.texture.dispose();
    shadows.material.dispose();
  }

  return { spawn, burst, shadow, update, setViewport, dispose };
}
