// Fish. Now and then one leaps from the river ahead of the flock; where the
// river goes over a cliff, many go over with it. One instanced mesh of fish on
// simple arcs, with a splash where each leaves and meets the water.
import * as THREE from 'three';
import { BASIN, basinNear, fallsOf, levelAt, relAt, riverX, sunk } from './ground';
import { paintMaterial } from './materials';

const G = 26;

export function createFish(scene, U, kit, fx, { lite }) {
  const CAP = lite ? 24 : 70;
  const mat = paintMaterial(U, { doubleSide: true });
  const mesh = new THREE.InstancedMesh(kit.fish.geometry, mat, CAP);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);

  const fish = [];
  const dummy = new THREE.Object3D();
  const rand = (a, b) => a + Math.random() * (b - a);
  let leap = 0.5;

  const splash = (x, y, z, n) => fx.burst(n, { x, y: y + 0.3, z, vy: 5, life: 0.6, size: 1.5, grow: 1, color: [1, 1, 1], alpha: 0.6, gravity: 12, drag: 1 }, 1.2, 6);
  const add = (x, y, z, vx, vy, vz, floor) => {
    if (fish.length < CAP) fish.push({ pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(vx, vy, vz), floor, size: rand(0.9, 1.5), roll: rand(-3, 3), spin: rand(0, 6) });
  };

  function update(dt, z) {
    // Leaps from the river ahead.
    leap -= dt;
    if (leap <= 0) {
      leap = rand(0.3, 1.1);
      const fz = z - rand(25, 230);
      const x = riverX(fz) + rand(-7, 7);
      const edge = sunk(x, fz);
      if (relAt(x, fz) < -0.6 && (edge < 0.01 || edge > 0.99)) {
        const level = levelAt(x, fz);
        add(x, level, fz, rand(-2, 2), rand(9, 14), rand(-7, 7), level);
        splash(x, level, fz, 5);
      }
    }
    // Over the falls: a steady run of fish carried off each lip.
    const basin = basinNear(z, 700, 300);
    if (basin) {
      const [into, out] = fallsOf(basin);
      for (const [lip, x, way] of [[into[0], into[1], -1], [out[0], out[1], 1]]) {
        if (Math.abs(lip - z) > 520 || Math.random() > dt * (lite ? 3 : 7)) continue;
        add(x + rand(-9, 9), rand(0.2, 1.2), lip + way * rand(0, 3), rand(-1, 1), rand(1, 6), way * rand(6, 11), -BASIN.drop);
      }
    }
    let n = 0;
    for (let i = fish.length - 1; i >= 0; i--) {
      const f = fish[i];
      f.vel.y -= G * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.spin += f.roll * dt;
      if (f.vel.y < 0 && f.pos.y < f.floor) {
        splash(f.pos.x, f.floor, f.pos.z, 4);
        fish.splice(i, 1);
      }
    }
    for (const f of fish) {
      dummy.position.copy(f.pos);
      dummy.lookAt(f.pos.x - f.vel.x, f.pos.y - f.vel.y, f.pos.z - f.vel.z); // the model's nose is its -Z
      dummy.rotateZ(f.spin);
      dummy.scale.setScalar(f.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(n++, dummy.matrix);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { update, dispose: () => mat.dispose() };
}
