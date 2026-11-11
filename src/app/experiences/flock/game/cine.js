// The cine camera: a watch mode that films the flock in composed shots and
// cuts between them, while the flock flies itself. Each shot places the lens
// (P) and what it looks at (L) from the middle of the flock (F), the side it
// is on (s = -1 or 1) and how far through the shot it is (k = 0..1).
// The idea of a directed, cutting camera follows Evensong (evensong-phi.vercel.app).
import * as THREE from 'three';
import { floorAt } from './ground';

const SHOTS = [
  // Alongside, on a long lens, drifting slowly back along the formation.
  { len: 8, fov: 26, at: (P, L, F, s, k) => (P.set(F.x + s * 46, F.y - 3 + k * 5, F.z - 12 + k * 16), L.set(F.x, F.y, F.z + 3)) },
  // From far ahead, the flock coming straight at the lens.
  { len: 7, fov: 15, at: (P, L, F, s, k) => (P.set(F.x + s * 14, F.y + 5, F.z - 135 + k * 45), L.set(F.x, F.y, F.z + 4)) },
  // A slow swing round the flock from behind.
  { len: 9, fov: 34, at: (P, L, F, s, k) => (P.set(F.x + Math.sin(s * (k * 1.7 - 0.5)) * 50, F.y + 9, F.z + 6 + Math.cos(s * (k * 1.7 - 0.5)) * 50), L.copy(F)) },
  // High above and behind: the flock small over the country.
  { len: 7, fov: 30, at: (P, L, F, s, k) => (P.set(F.x + s * 34, F.y + 150 - k * 25, F.z + 75), L.set(F.x, F.y, F.z - 30)) },
  // A tripod on the ground, panning as the flock goes over.
  { len: 6.5, fov: 38, fixed: true, at: (P, L, F) => L.copy(F) },
  // Close underneath, the birds against the sky.
  { len: 6, fov: 58, at: (P, L, F, s, k) => (P.set(F.x - s * 5, F.y - 6, F.z + 16 - k * 4), L.set(F.x + s * 2, F.y + 1, F.z - 30)) },
];

export function createCine() {
  const F = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  let shot = null;
  let side = 1;
  let t = 0;

  function cut(birds, speed, seconds) {
    let next = shot;
    while (next === shot) next = SHOTS[Math.floor(Math.random() * SHOTS.length)];
    shot = next;
    side = Math.random() < 0.5 ? -1 : 1;
    t = 0;
    if (shot.fixed) {
      // Stand where the flock will pass about half way through the shot.
      pos.set(F.x + side * 24, 0, F.z - speed * shot.len * seconds * 0.5);
      pos.y = floorAt(pos.x, pos.z) + 2.5;
    }
  }

  // Films one frame. `seconds` scales every shot's length. Returns { pos, look, fov, cut }.
  function update(dt, birds, leader, speed, seconds = 1) {
    if (birds.length) {
      F.set(0, 0, 0);
      for (const b of birds) F.add(b.pos);
      F.divideScalar(birds.length);
    } else F.copy(leader);
    t += dt;
    const fresh = !shot || t > shot.len * seconds;
    if (fresh) cut(birds, speed, seconds);
    shot.at(pos, look, F, side, Math.min(1, t / (shot.len * seconds)));
    if (!shot.fixed) pos.y = Math.max(pos.y, floorAt(pos.x, pos.z) + 2.5);
    return { pos, look, fov: shot.fov, cut: fresh, focus: pos.distanceTo(F) };
  }

  return { update, reset: () => (shot = null) };
}
