// People out walking in the towns. Each keeps to the lanes: every so often it
// looks a little left, right and straight on, and takes whichever way stays
// closest to a road. They are scenery only; the children who throw stones are
// threats (threats.js). One instanced mesh; legs and arms swing in the shader.
import * as THREE from 'three';
import { BIOME, biomeAt, heightAt, relAt, townRoad } from './ground';
import { paintMaterial } from './materials';

const SLAB = 40; // people are placed a slab of the route at a time
const SHIRTS = [[0.95, 0.95, 0.92], [0.85, 0.35, 0.28], [0.3, 0.5, 0.75], [0.95, 0.78, 0.35], [0.4, 0.62, 0.45], [0.7, 0.55, 0.8], [0.9, 0.6, 0.4]];

export function createPeople(scene, U, kit, { lite }) {
  const CAP = lite ? 30 : 70;
  const geo = kit.walker.geometry;
  const stride = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  geo.setAttribute('aWalk', stride);
  const mat = paintMaterial(U, { walk: true });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.layers.enable(1); // they cast shadows
  scene.add(mesh);

  const walkers = [];
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let placed = null; // the furthest slab already given its people

  // How far off a lane a walker would be a few steps on, heading `turn` away from
  // where it faces. Water, wet sand and anything outside the town count as far off:
  // the lanes run on across the river, and nobody follows them in.
  const DRY = 1.6;
  const walkable = (x, z) => relAt(x, z) > DRY && biomeAt(z) === BIOME.TOWN;
  const off = (w, turn, reach) => {
    const x = w.x - Math.sin(w.dir + turn) * reach;
    const z = w.z - Math.cos(w.dir + turn) * reach;
    return walkable(x, z) ? townRoad(x, z) : 99;
  };

  function update(dt, z) {
    // Fill slabs as they come into view ahead.
    const ahead = Math.floor((-z + 420) / SLAB);
    if (placed === null) placed = Math.floor((-z - 60) / SLAB);
    for (; placed < ahead; placed++) {
      const sz = -(placed + 0.5) * SLAB;
      if (biomeAt(sz) !== BIOME.TOWN) continue;
      for (let tries = 0, made = 0; tries < 14 && made < 3 && walkers.length < CAP; tries++) {
        const x = (Math.random() - 0.5) * 230;
        const wz = sz + (Math.random() - 0.5) * SLAB;
        if (townRoad(x, wz) > 2 || !walkable(x, wz)) continue;
        walkers.push({ x, z: wz, dir: Math.random() * 6.28, speed: 2.6 + Math.random() * 1.4, size: 0.85 + Math.random() * 0.3, step: Math.random() * 6.28, think: Math.random(), shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)] });
        made++;
      }
    }
    let n = 0;
    for (let i = walkers.length - 1; i >= 0; i--) {
      const w = walkers[i];
      if (w.z > z + 90) {
        walkers.splice(i, 1);
        continue;
      }
      w.think -= dt;
      if (w.think <= 0) {
        w.think = 0.35 + Math.random() * 0.3;
        // Take whichever way keeps to the lane; turn right round at a dead end.
        const ways = [0, 0.7, -0.7, 1.5, -1.5].map((turn) => [off(w, turn, 6), turn]).sort((a, b) => a[0] - b[0]);
        w.turn = ways[0][0] > 4 ? Math.PI : ways[0][1];
      }
      const swing = Math.max(-1.6, Math.min(1.6, w.turn || 0)) * dt * 2.2;
      w.dir += swing;
      w.turn = (w.turn || 0) - swing;
      // Never take a step onto wet ground: stop, and turn round instead.
      const nx = w.x - Math.sin(w.dir) * w.speed * dt;
      const nz = w.z - Math.cos(w.dir) * w.speed * dt;
      if (relAt(nx - Math.sin(w.dir) * 1.5, nz - Math.cos(w.dir) * 1.5) > DRY) {
        w.x = nx;
        w.z = nz;
        w.step += w.speed * dt * 1.5;
      } else {
        w.turn = Math.PI;
        w.think = 0.6;
      }
    }
    for (const w of walkers) {
      quat.setFromAxisAngle(UP, w.dir);
      m4.compose(pos.set(w.x, heightAt(w.x, w.z) - 0.1, w.z), quat, scl.setScalar(w.size));
      mesh.setMatrixAt(n, m4);
      mesh.instanceColor.array.set(w.shirt, n * 3);
      stride.array[n] = w.step;
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    stride.needsUpdate = true;
  }

  function reset() {
    walkers.length = 0;
    placed = null;
  }

  return { update, reset, dispose: () => mat.dispose() };
}
