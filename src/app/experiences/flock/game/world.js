// The ground under the flock: a strip of terrain chunks built ahead of the
// flight path and recycled behind it, plus the trees, rocks and buildings that
// stand on them. Chunks are built a slice at a time so a new one never costs a
// whole frame.
import * as THREE from 'three';
import { AIRFIELD, BASIN, BIOME, airportAt, airportNear, basinNear, colourAt, fallsOf, farmEdge, heightAt, paving, riverX, sampleGround, sunk, townRoad } from './ground';
import { makeRunwayTexture, paintMaterial, shadowMaterial, waterMaterial } from './materials';
import { hex, noise2, rng } from './noise';

const L = 120; // chunk length along the route
const W = 760; // half width
// Vertices and texels are packed toward the flight path, sparse at the edges.
const xOf = (s) => W * (0.3 * s + 0.7 * s * s * s);

const rgb = (h) => hex(h).map((v) => v / 255);
const TINT = {
  round: ['#3f7d2e', '#5a9a35', '#7fb446', '#2f6b33'].map(rgb),
  pine: ['#1f5a38', '#2a6b3e', '#3b7a45'].map(rgb),
  poplar: ['#6ea13c', '#86b548'].map(rgb),
  autumn: ['#d98a2e', '#c0561f', '#e3b23a', '#a94c1b'].map(rgb),
  birch: ['#8fb84a', '#a9c65a', '#c9cf5e'].map(rgb),
  bush: ['#2f5f2c', '#3d7030', '#4f8236', '#3a6a45'].map(rgb),
  cow: ['#ffffff', '#8a5a3a', '#4a423c', '#d9c9a8', '#ffffff'].map(rgb),
  wall: [[1, 1, 1], [1, 0.93, 0.88], [0.92, 0.95, 1], [1, 0.97, 0.84], [0.9, 0.9, 0.88]],
};
const VARIANTS = { round: ['tree_round', 'tree_round2', 'tree_round3', 'tree_birch', 'tree_round'], pine: ['tree_pine', 'tree_pine2'], poplar: ['tree_poplar'] };
const WHITE = [1, 1, 1];
const HOUSES = ['house', 'house2', 'house3', 'house4', 'house5'];
const FARMHOUSES = ['house', 'house3', 'house4'];

// What stands on an airfield: [model, x, distance into the zone, turn].
const AIRPORT_PROPS = [
  ['terminal', 82, 480, 0],
  ['control_tower', 74, 318, 0],
  ['hangar', 84, 362, Math.PI / 2],
  ['hangar', 84, 610, Math.PI / 2],
  ['airliner', 41, 458, -Math.PI / 2],
  ['airliner', 41, 502, -Math.PI / 2],
  ['biplane', 58, 362, -Math.PI / 2],
  ['biplane', 56, 604, -2.2],
  ['biplane', 44, 620, -1.2],
];

// name -> [capacity, collision radius, height]
const PROPS = {
  tree_round: [1500, 3.0, 12],
  tree_round2: [800, 4.0, 15],
  tree_round3: [800, 3.0, 12.5],
  tree_birch: [1000, 2.0, 13],
  tree_pine: [1500, 2.3, 14],
  tree_pine2: [1200, 2.4, 18],
  tree_poplar: [500, 2.2, 18],
  bush: [4000, 0, 0],
  bush2: [1200, 0, 0],
  tuft: [15000, 0, 0],
  cow: [300, 0, 0],
  sailboat: [40, 0, 0],
  house: [300, 4.6, 7.4],
  house2: [200, 4.5, 9.6],
  house3: [200, 5.0, 6.8],
  house4: [200, 6.0, 7.4],
  house5: [200, 3.6, 12.6],
  terminal: [4, 0, 0],
  control_tower: [4, 0, 0],
  hangar: [8, 0, 0],
  airliner: [8, 0, 0],
  biplane: [12, 0, 0],
  sheep: [500, 0, 0],
  windmill: [12, 3.4, 15],
  barn: [60, 7, 9.5],
  church: [16, 4.2, 25],
  lighthouse: [10, 2.6, 24],
  rock: [400, 0, 0],
  haystack: [300, 0, 0],
};

// Plants further than this to either side of the route are drawn from the
// low-detail `_far` meshes (scripts/flock/bake_trees.mjs): the flock never gets close to them.
const FAR_FROM_ROUTE = 110;
for (const name of Object.keys(PROPS)) {
  if (name.startsWith('tree_')) PROPS[`${name}_far`] = [...PROPS[name]];
}
PROPS.bush2_far = [5200, 0, 0];

export function createWorld(scene, U, kit, { lite, fx: fx_ }) {
  const { drop: BASIN_DROP, fall: BASIN_FALL } = BASIN;
  const NX = lite ? 72 : 104;
  const NZ = lite ? 12 : 20;
  const TW = lite ? 192 : 512;
  const TH = lite ? 48 : 128;
  const AHEAD = lite ? 7 : 10;
  const density = lite ? 0.55 : 1;
  const propRange = lite ? 280 : 400;

  const index = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + 1;
      const c = a + NX + 1;
      const d = c + 1;
      index.push(a, b, d, a, d, c);
    }
  }
  const uvs = new Float32Array((NX + 1) * (NZ + 1) * 2);
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const o = (j * (NX + 1) + i) * 2;
      uvs[o] = (0.5 + (i / NX) * (TW - 1)) / TW;
      uvs[o + 1] = (0.5 + (j / NZ) * (TH - 1)) / TH;
    }
  }

  function makeChunk() {
    const geo = new THREE.BufferGeometry();
    const n = (NX + 1) * (NZ + 1);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(index);
    const tex = new THREE.DataTexture(new Uint8Array(TW * TH * 4), TW, TH, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    const mesh = new THREE.Mesh(geo, paintMaterial(U, { map: tex, ground: kit.ground }));
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.layers.enable(1);
    scene.add(mesh);
    return { k: null, mesh, geo, tex, ready: false, props: {}, colliders: [], shade: null, job: null };
  }

  const chunks = Array.from({ length: AHEAD + 3 }, makeChunk);
  const ground = { h: 0, biome: 0, level: 0, rel: 0 };
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function* build(c, k) {
    const z1 = -k * L;
    const P = c.geo.attributes.position.array;
    const N = c.geo.attributes.normal.array;
    for (let j = 0; j <= NZ; j++) {
      const z = z1 - (j / NZ) * L;
      for (let i = 0; i <= NX; i++) {
        const x = xOf((i / NX) * 2 - 1);
        const o = (j * (NX + 1) + i) * 3;
        const h = heightAt(x, z);
        const e = 2.5;
        const nx = heightAt(x - e, z) - heightAt(x + e, z);
        const nz = heightAt(x, z - e) - heightAt(x, z + e);
        const inv = 1 / Math.hypot(nx, 2 * e, nz);
        P[o] = x;
        P[o + 1] = h;
        P[o + 2] = z;
        N[o] = nx * inv;
        N[o + 1] = 2 * e * inv;
        N[o + 2] = nz * inv;
      }
      if (j % 3 === 2) yield;
    }
    const D = c.tex.image.data;
    for (let r = 0; r < TH; r++) {
      const z = z1 - (r / (TH - 1)) * L;
      for (let q = 0; q < TW; q++) {
        const x = xOf((q / (TW - 1)) * 2 - 1);
        sampleGround(x, z, ground);
        const col = colourAt(x, z, ground.rel, ground.biome);
        const o = (r * TW + q) * 4;
        D[o] = Math.min(255, col[0]);
        D[o + 1] = Math.min(255, col[1]);
        D[o + 2] = Math.min(255, col[2]);
        D[o + 3] = 255;
      }
      if (r % 2 === 1) yield;
    }
    scatter(c, k);
    yield;
    c.geo.attributes.position.needsUpdate = true;
    c.geo.attributes.normal.needsUpdate = true;
    c.tex.needsUpdate = true;
    c.mesh.visible = true;
    c.ready = true;
    propsDirty = true;
  }

  // Trees, rocks and buildings for one chunk, from its own seeded generator.
  function scatter(c, k) {
    const r = rng(k * 7919 + 13);
    const lists = {};
    const colliders = [];
    const shade = [];
    const put = (name, x, y, z, rot, s, tint, shadow = true) => {
      const list = (lists[name] = lists[name] || []);
      quat.setFromAxisAngle(UP, rot);
      m4.compose(pos.set(x, y - 0.25, z), quat, scl.set(s, s, s));
      list.push(...m4.elements, tint[0], tint[1], tint[2]);
      const [, radius, height] = PROPS[name];
      // A soft shadow, thrown forward like the ones under the birds.
      const reach = (radius || 1.6) * s;
      if (shadow) shade.push(x + height * s * 0.05, y + 0.35, z - reach * 0.5 - height * s * 0.12, reach * 2.7, reach * 2.7 + height * s * 0.3);
      if (radius && Math.abs(x) < 80) colliders.push({ x, z, r: radius * s, top: y + height * s });
    };
    const tree = (x, y, z, kind) => {
      const autumn = noise2(x * 0.006, z * 0.006 + 50) > 0.6 && kind !== 'pine';
      const name = VARIANTS[kind][Math.floor(r() * VARIANTS[kind].length)];
      const set = autumn ? TINT.autumn : name === 'tree_birch' ? TINT.birch : TINT[kind];
      const c = set[Math.floor(r() * set.length)];
      const v = 0.85 + r() * 0.3;
      put(Math.abs(x) > FAR_FROM_ROUTE ? `${name}_far` : name, x, y, z, r() * 6.28, 0.7 + r() * 0.65, [c[0] * v, c[1] * v, c[2] * v]);
    };
    const bush = (x, y, z, hedge) => {
      const name = hedge || r() < 0.7 ? 'bush' : 'bush2';
      put(Math.abs(x) > FAR_FROM_ROUTE ? 'bush2_far' : name, x, y, z, r() * 6.28, (0.6 + r() * 0.9) * (Math.abs(x) > FAR_FROM_ROUTE && name === 'bush' ? 0.6 : 1), TINT.bush[Math.floor(r() * 4)]);
    };
    const herd = (x, z) => {
      const n = 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const cx = x + (r() - 0.5) * 26;
        const cz = z + (r() - 0.5) * 26;
        const ch = heightAt(cx, cz);
        if (ch > 1.4) put('cow', cx, ch + 0.2, cz, r() * 6.28, 0.85 + r() * 0.3, TINT.cow[Math.floor(r() * 5)]);
      }
    };
    const flockOfSheep = (x, z) => {
      const n = 5 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {
        const sx = x + (r() - 0.5) * 22;
        const sz = z + (r() - 0.5) * 22;
        const sh = heightAt(sx, sz);
        if (sh > 1.4) put('sheep', sx, sh + 0.25, sz, r() * 6.28, 0.9 + r() * 0.35, WHITE);
      }
    };
    const house = (names, x, y, z, rot, s) => put(names[Math.floor(r() * names.length)], x, y, z, rot, s, TINT.wall[Math.floor(r() * 5)]);
    const cell = 13;
    const z1 = -k * L;
    // Airport buildings and parked aircraft, where this chunk crosses an airfield.
    const ap = airportAt(z1 - L / 2);
    for (const [name, x, d, rot] of ap ? AIRPORT_PROPS : []) {
      const z = ap.start - d;
      if (z > z1 || z <= z1 - L) continue;
      const parked = name === 'airliner' || name === 'biplane';
      put(name, x, AIRFIELD.y + 0.25 + (parked ? rest[name] : 0), z, rot, 1, WHITE, false);
      // A parked airliner is a row of obstacles for a flock that comes in low.
      if (name === 'airliner') for (let i = -3; i <= 3; i++) colliders.push({ x: x + i * 5.5, z, r: 3.4, top: AIRFIELD.y + (i < -1 ? 12 : 7.5) });
    }
    let special = r() < 0.5;
    for (let cz = 0; cz < L / cell - 0.5; cz++) {
      for (let cx = -Math.floor(propRange / cell); cx < propRange / cell; cx++) {
        const x = (cx + 0.15 + r() * 0.7) * cell;
        const z = z1 - (cz + 0.15 + r() * 0.7) * cell;
        const roll = r();
        const pick = r();
        if (roll > density) continue;
        const p = roll / density;
        sampleGround(x, z, ground);
        const h = ground.h;
        if (ground.biome === BIOME.WATER && h < -3 && p < 0.007) put('sailboat', x, 0.3, z, pick * 6.28, 0.9 + pick * 0.5, WHITE, false);
        if (ground.rel < 1.3 || Math.abs(x - riverX(z)) < 24) continue;
        // Nothing stands on a cliff face.
        const cliff = sunk(x, z);
        if (cliff > 0.02 && cliff < 0.98) continue;
        switch (ground.biome) {
          case BIOME.HILLS:
            if (special && h > 17 && Math.abs(x) > 26 && Math.abs(x) < 130) {
              special = false;
              put('windmill', x, h, z, 2.6 + pick, 1, WHITE);
            } else if (p < 0.045) tree(x, h, z, h > 15 ? 'pine' : pick < 0.6 ? 'round' : 'poplar');
            else if (p < 0.085) put('rock', x, h, z, pick * 6.28, 0.6 + pick * 1.2, WHITE);
            else if (p < 0.13) bush(x, h, z);
            else if (p < 0.145) flockOfSheep(x, z);
            else if (p < 0.153 && Math.abs(x) > 26 && h < 16) {
              house(['house3', 'house3', 'house'], x, h, z, pick * 6.28, 0.9 + pick * 0.2);
              for (const [dx, dz] of [[8, 3], [9.5, -3], [-7, 6]]) tree(x + dx, heightAt(x + dx, z + dz), z + dz, 'poplar');
            }
            break;
          case BIOME.BASIN: {
            // Lush low country: woods in drifts, boulders under the cliffs.
            const wood = noise2(x * 0.012 + 40, z * 0.012 + 3) > 0.45;
            if (p < (wood ? 0.5 : 0.06)) tree(x, h, z, pick < 0.3 ? 'pine' : 'round');
            else if (p < (wood ? 0.62 : 0.14)) bush(x, h, z);
            else if (p < (wood ? 0.66 : 0.19)) put('rock', x, h, z, pick * 6.28, 0.8 + pick * 1.8, WHITE);
            break;
          }
          case BIOME.AIRPORT:
            // Nothing grows on the field itself; trees and hedges ring it.
            if (Math.abs(x - 20) < 135) break;
            if (p < 0.12) tree(x, h, z, pick < 0.75 ? 'round' : 'poplar');
            else if (p < 0.2) bush(x, h, z);
            break;
          case BIOME.FOREST:
            if (noise2(x * 0.012 + 9, z * 0.012) > 0.66) break;
            if (p < 0.68) tree(x, h, z, noise2(x * 0.01, z * 0.01 + 7) > 0.5 ? 'pine' : 'round');
            else if (p < 0.8) bush(x, h, z);
            break;
          case BIOME.FARM:
            if (p < 0.035) tree(x, h, z, pick < 0.5 ? 'poplar' : 'round');
            else if (p < 0.07) put('haystack', x, h, z, 0, 0.8 + pick * 0.4, WHITE);
            else if (p < 0.082 && p > 0.078) herd(x, z);
            else if (p < 0.078 && Math.abs(x) > 26) {
              house(FARMHOUSES, x, h, z, pick * 6.28, 1);
              put('barn', x + 16, heightAt(x + 16, z - 6), z - 6, pick * 6.28 + 1.57, 1, WHITE);
              tree(x - 9, heightAt(x - 9, z + 5), z + 5, 'round');
            }
            break;
          case BIOME.TOWN: {
            if (townRoad(x, z) < 7.5) break;
            if (special && Math.abs(x) > 24 && Math.abs(x) < 110) {
              special = false;
              put('church', x, h, z, 3.14, 1, WHITE);
            } else if (p < 0.34) house(HOUSES, x, h, z, Math.floor(pick * 4) * 1.5708 + (r() - 0.5) * 0.9, 0.85 + pick * 0.3);
            else if (p < 0.42) bush(x, h, z);
            else if (p < 0.52) tree(x, h, z, pick < 0.3 ? 'poplar' : 'round');
            break;
          }
          case BIOME.WATER:
            if (h < 1.8) break;
            if (special && h < 5) {
              special = false;
              put('lighthouse', x, h, z, 0, 1, WHITE);
            } else if (p < 0.14) tree(x, h, z, pick < 0.4 ? 'pine' : 'round');
            else if (p < 0.18) put('rock', x, h, z, pick * 6.28, 0.7 + pick, WHITE);
            break;
          case BIOME.HIGHLAND:
            if (p < 0.15 && h < 17) tree(x, h, z, 'pine');
            else if (p < 0.21) put('rock', x, h, z, pick * 6.28, 0.8 + pick * 1.6, WHITE);
            break;
          default: {
            const grove = noise2(x * 0.015 + 3, z * 0.015) > 0.62;
            if (p < (grove ? 0.42 : 0.035)) tree(x, h, z, pick < 0.82 ? 'round' : 'poplar');
            else if (p < (grove ? 0.44 : 0.05)) put('rock', x, h, z, pick * 6.28, 0.6 + pick, WHITE);
            else if (p < (grove ? 0.62 : 0.1)) bush(x, h, z);
            else if (p < (grove ? 0.62 : 0.106)) herd(x, z);
          }
        }
      }
    }
    // Hedges: bushes along the field boundaries of the farmland.
    for (let hz = 0; hz < L; hz += 4.5) {
      for (let hx = -200; hx < 200; hx += 4.5) {
        const x = hx + r() * 3;
        const z = z1 - hz - r() * 3;
        if (r() > 0.75 * density) continue;
        sampleGround(x, z, ground);
        if (ground.biome !== BIOME.FARM || ground.h < 1.3) continue;
        const fe = farmEdge(x, z);
        if (fe.edge < 1.9 && !fe.track) bush(x, ground.h, z, true);
      }
    }
    // Grass: tufts near the flight path, tinted like the ground they stand on.
    const reach = lite ? 45 : 95;
    const step = lite ? 7 : 4.6;
    for (let gz = 0; gz < L; gz += step) {
      for (let gx = -reach; gx < reach; gx += step) {
        const x = gx + r() * step;
        const z = z1 - gz - r() * step;
        sampleGround(x, z, ground);
        if (ground.rel < 1.5 || ground.biome === BIOME.TOWN || (ground.biome === BIOME.AIRPORT && paving(x, z))) continue;
        const steep = sunk(x, z);
        if (steep > 0.02 && steep < 0.98) continue;
        const col = colourAt(x, z, ground.rel, ground.biome);
        const k = (1.2 + r() * 0.35) / 255;
        put('tuft', x, ground.h + 0.2, z, r() * 6.28, 0.45 + r() * 0.75, [col[0] * k, col[1] * k * 1.04, col[2] * k * 0.9], false);
      }
    }
    c.props = {};
    for (const name of Object.keys(lists)) c.props[name] = new Float32Array(lists[name]);
    c.colliders = colliders;
    c.shade = shade;
  }

  // How far a parked aircraft's origin sits above the ground it rests on.
  const rest = {};
  for (const name of ['airliner', 'biplane']) {
    kit[name].geometry.computeBoundingBox();
    rest[name] = -kit[name].geometry.boundingBox.min.y;
  }

  // The runway: one painted strip, moved to whichever airport is nearest.
  const { runway: RW } = AIRFIELD;
  const runwayTex = makeRunwayTexture();
  const runwayMat = paintMaterial(U, { tex: runwayTex });
  runwayMat.polygonOffset = true;
  runwayMat.polygonOffsetFactor = -3;
  runwayMat.polygonOffsetUnits = -3;
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(RW.half * 2, RW.to - RW.from).rotateX(-Math.PI / 2), runwayMat);
  runway.frustumCulled = false;
  runway.visible = false;
  scene.add(runway);

  // ------------------------------------------------------------ instanced props
  // Grass blades are lit like the ground they grow from, not edge-on.
  const tuftNormals = kit.tuft.geometry.attributes.normal;
  for (let i = 0; i < tuftNormals.count; i++) tuftNormals.setXYZ(i, 0, 1, 0);
  const propMat = paintMaterial(U);
  const swayMat = paintMaterial(U, { sway: true, doubleSide: true });
  const meshes = {};
  const leafMeshes = {};
  const treeMats = new Map();
  const treeMat = (tex, leaf) => {
    if (!treeMats.has(tex)) treeMats.set(tex, paintMaterial(U, { tex, leaf, sway: true, doubleSide: leaf }));
    return treeMats.get(tex);
  };
  for (const [name, [cap]] of Object.entries(PROPS)) {
    const tree = kit.trees[name];
    const mesh = tree
      ? new THREE.InstancedMesh(tree.bark, treeMat(tree.barkTex, false), cap)
      : new THREE.InstancedMesh(kit[name].geometry, name === 'tuft' || name === 'sailboat' ? swayMat : propMat, cap);
    const colours = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.frustumCulled = false;
    mesh.count = 0;
    if (name !== 'tuft') mesh.layers.enable(1);
    scene.add(mesh);
    meshes[name] = mesh;
    if (tree) {
      // Bark and leaves share one set of instance matrices; only the leaves are tinted.
      const leaves = new THREE.InstancedMesh(tree.leaves, treeMat(tree.leafTex, true), cap);
      leaves.instanceMatrix = mesh.instanceMatrix;
      leaves.instanceColor = colours;
      leaves.frustumCulled = false;
      leaves.count = 0;
      leaves.layers.enable(1);
      scene.add(leaves);
      leafMeshes[name] = leaves;
    } else mesh.instanceColor = colours;
  }
  const SHADES = lite ? 2200 : 5200;
  const shadeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  shadeGeo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(SHADES).fill(lite ? 0.8 : 0.28), 1));
  const shadeMesh = new THREE.InstancedMesh(shadeGeo, shadowMaterial(U), SHADES);
  shadeMesh.frustumCulled = false;
  shadeMesh.renderOrder = 2;
  shadeMesh.count = 0;
  scene.add(shadeMesh);
  const sm = new THREE.Matrix4();

  let propsDirty = false;
  function refillProps() {
    propsDirty = false;
    let sn = 0;
    for (const c of chunks) {
      if (!c.ready || !c.shade) continue;
      for (let i = 0; i < c.shade.length && sn < SHADES; i += 5, sn++) {
        sm.makeScale(c.shade[i + 3], 1, c.shade[i + 4]).setPosition(c.shade[i], c.shade[i + 1], c.shade[i + 2]);
        shadeMesh.setMatrixAt(sn, sm);
      }
    }
    shadeMesh.count = sn;
    shadeMesh.instanceMatrix.needsUpdate = true;
    for (const [name, mesh] of Object.entries(meshes)) {
      const cap = PROPS[name][0];
      const M = mesh.instanceMatrix.array;
      const tinted = leafMeshes[name] || mesh;
      const C = tinted.instanceColor.array;
      let n = 0;
      for (const c of chunks) {
        const data = c.ready && c.props[name];
        if (!data) continue;
        for (let i = 0; i < data.length && n < cap; i += 19, n++) {
          for (let e = 0; e < 16; e++) M[n * 16 + e] = data[i + e];
          C[n * 3] = data[i + 16];
          C[n * 3 + 1] = data[i + 17];
          C[n * 3 + 2] = data[i + 18];
        }
      }
      mesh.count = n;
      tinted.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      tinted.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------------- water
  // Finely divided along the route, so its surface can step down a waterfall.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200, 1, lite ? 400 : 800).rotateX(-Math.PI / 2), waterMaterial(U));
  water.renderOrder = 1;
  water.frustumCulled = false;
  scene.add(water);

  function update(z, budgetMs = 3.5, force = false) {
    const k0 = Math.floor((-z - 170) / L);
    const k1 = k0 + AHEAD + 1;
    for (const c of chunks) {
      if (c.k !== null && (c.k < k0 || c.k > k1)) {
        c.k = null;
        c.ready = false;
        c.job = null;
        c.mesh.visible = false;
        propsDirty = true;
      }
    }
    const start = performance.now();
    for (let k = k0; k <= k1; k++) {
      let c = chunks.find((q) => q.k === k);
      if (!c) {
        c = chunks.find((q) => q.k === null);
        if (!c) break;
        c.k = k;
        c.job = build(c, k);
      }
      if (c.job) {
        while (force || performance.now() - start < budgetMs) {
          if (c.job.next().done) {
            c.job = null;
            break;
          }
        }
        if (c.job) break;
      }
    }
    if (propsDirty) refillProps();
    // Tell the water where the nearest basin's cliffs are, and raise spray under its falls.
    const basin = basinNear(z);
    U.uBasinOn.value = basin ? 1 : 0;
    if (basin) {
      const falls = fallsOf(basin);
      U.uBasin.value.set(falls[0][0], falls[1][0], falls[0][1], falls[1][1]);
      for (const [fz, fx] of falls) {
        if (Math.abs(fz - z) > 520) continue;
        const foot = fz === falls[0][0] ? fz - BASIN_FALL - 4 : fz + BASIN_FALL + 4;
        for (let i = 0; i < 2; i++) {
          fx_.spawn({ x: fx + (Math.random() - 0.5) * 26, y: -BASIN_DROP + 2, z: foot + (Math.random() - 0.5) * 10, vy: 5 + Math.random() * 7, vz: fz === falls[0][0] ? -3 : 3, life: 2.2, size: 11, grow: 2.5, color: [0.85, 0.87, 0.9], alpha: 0.08, drag: 0.6 });
        }
      }
    }
    const ap = airportNear(z, 1500, 700);
    runway.visible = !!ap;
    if (ap) runway.position.set(RW.x, AIRFIELD.y + 0.05, (ap.near + ap.far) / 2);
    water.position.set(0, 0, Math.round(z / 100) * 100 - 900);
  }

  // What a bird at (x, y, z) has flown into, if anything.
  function hit(x, y, z) {
    if (y > 46) return null;
    if (y < heightAt(x, z) + 0.8) return sunk(x, z) > 0.02 && sunk(x, z) < 0.98 ? 'cliff' : 'ground';
    const k = Math.floor(-z / L);
    for (const c of chunks) {
      if (c.k !== k || !c.ready) continue;
      for (const o of c.colliders) {
        if (y > o.top) continue;
        const dx = x - o.x;
        const dz = z - o.z;
        const rad = o.r + 0.7;
        if (dx * dx + dz * dz < rad * rad) return 'prop';
      }
    }
    return null;
  }

  function dispose() {
    for (const c of chunks) {
      c.geo.dispose();
      c.tex.dispose();
      c.mesh.material.dispose();
    }
    propMat.dispose();
    swayMat.dispose();
    treeMats.forEach((m) => m.dispose());
    shadeGeo.dispose();
    shadeMesh.material.dispose();
    runway.geometry.dispose();
    runwayMat.dispose();
    runwayTex.dispose();
    water.geometry.dispose();
    water.material.dispose();
  }

  return { update, hit, dispose };
}
