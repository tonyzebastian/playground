// Loads the Blender-built model kit (scripts/flock/build_models.py) and turns
// each model into a geometry the painter material can draw: vertex colours
// move to `aColor` in display space.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export async function loadKit(url = '/models/flock/flock-kit.glb') {
  const gltf = await new GLTFLoader().loadAsync(url);
  const kit = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const c = g.getAttribute('color');
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c ? Math.pow(c.getX(i), 1 / 2.2) : 1;
      arr[i * 3 + 1] = c ? Math.pow(c.getY(i), 1 / 2.2) : 1;
      arr[i * 3 + 2] = c ? Math.pow(c.getZ(i), 1 / 2.2) : 1;
    }
    g.setAttribute('aColor', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('color');
    kit[o.name] = { geometry: g, offset: o.position.clone() };
  });
  return kit;
}

// Trees baked from EZ-Tree by scripts/flock/bake_trees.mjs: per tree a bark
// mesh and a leaf-card mesh, with shared bark and leaf textures.
export async function loadTrees(base = '/models/flock/') {
  const [manifest, buffer] = await Promise.all([
    fetch(`${base}trees.json`).then((r) => r.json()),
    fetch(`${base}trees.bin`).then((r) => r.arrayBuffer()),
  ]);
  const loader = new THREE.TextureLoader();
  const textures = {};
  const texture = (file, repeat) => {
    if (!textures[file]) {
      const t = loader.load(`${base}tex/${file}`);
      t.colorSpace = THREE.NoColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      textures[file] = t;
    }
    return textures[file];
  };
  const part = (p) => {
    const data = new Float32Array(buffer, p.vertices[0], p.vertices[1] * 8);
    const mesh = new THREE.InterleavedBuffer(data, 8);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(mesh, 3, 0));
    g.setAttribute('normal', new THREE.InterleavedBufferAttribute(mesh, 3, 3));
    g.setAttribute('uv', new THREE.InterleavedBufferAttribute(mesh, 2, 6));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer, p.index[0], p.index[1]), 1));
    return g;
  };
  const trees = {};
  for (const [name, t] of Object.entries(manifest)) {
    trees[name] = { bark: part(t.bark), leaves: part(t.leaves), barkTex: texture(`bark_${t.barkTex}.jpg`, true), leafTex: texture(`leaf_${t.leafTex}.png`, false), radius: t.radius, height: t.height };
  }
  return { trees, grass: texture('grass.jpg', true), dirt: texture('dirt.jpg', true) };
}
