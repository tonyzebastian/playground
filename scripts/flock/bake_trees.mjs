// Bakes the trees for Flock in Flight with EZ-Tree (MIT, Daniel Greenheck):
// a few seeded trees per species, thinned so thousands can be instanced, and
// written as one binary plus a manifest. Also copies the bark and leaf textures.
//
//   node scripts/flock/bake_trees.mjs
//
// EZ-Tree stays a dev dependency: the game only loads the baked files.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = join(ROOT, 'node_modules/@dgreenheck/ez-tree/src/lib');
const OUT = join(ROOT, 'public/models/flock');

// EZ-Tree's source is written for a bundler: extensionless imports, JSON and
// image imports. These hooks let Node load it as is.
const hooks = `
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && ctx.parentURL && ctx.parentURL.includes('ez-tree/src')) {
    const p = fileURLToPath(new URL(spec, ctx.parentURL));
    for (const ext of ['', '.js', '/index.js']) {
      if (existsSync(p + ext) && (ext || /\\.\\w+$/.test(p))) return { url: pathToFileURL(p + ext).href, shortCircuit: true };
    }
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (/\\.(jpg|png)$/.test(url)) return { format: 'module', source: 'export default ' + JSON.stringify(url), shortCircuit: true };
  if (url.endsWith('.json') && url.includes('ez-tree')) return { format: 'module', source: 'export default ' + readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
  return next(url, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks), import.meta.url);
// The library creates its textures on import; give the image loader something to hold.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }) };

const { Tree } = await import(join(LIB, 'index.js'));

// name -> [preset, seed, height in game units, leaves kept per twig, leaf size factor]
const TREES = {
  tree_round: ['Oak Medium', 11, 12, 4, 3.1],
  tree_round2: ['Oak Large', 27, 15, 3, 3.2],
  tree_round3: ['Ash Medium', 5, 12.5, 4, 3.0],
  tree_birch: ['Aspen Medium', 8, 13, 5, 2.6],
  tree_poplar: ['Aspen Large', 19, 18, 5, 2.6],
  tree_pine: ['Pine Medium', 3, 14, 8, 1.7],
  tree_pine2: ['Pine Large', 14, 18, 7, 1.7],
  bush: ['Bush 1', 2, 2.6, 5, 2.4, 0.3],
  bush2: ['Bush 3', 6, 3.4, 5, 2.4, 0.45],
};

const chunks = [];
let offset = 0;
const push = (typed) => {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (bytes.length % 4)) % 4;
  chunks.push(bytes, new Uint8Array(pad));
  const at = offset;
  offset += bytes.length + pad;
  return at;
};

const manifest = {};
for (const [name, [preset, seed, height, keep, grow, budget = 1]] of Object.entries(TREES)) {
  const tree = new Tree();
  tree.loadPreset(preset);
  const o = tree.options;
  o.seed = seed;
  o.leaves.size *= grow;
  o.leaves.count = keep;
  for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.min(o.branch.segments[k], k === '0' ? 7 : 4));
  for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(1, Math.ceil(o.branch.sections[k] * 0.6));
  // Thin the tree until it is cheap enough to draw a few thousand times.
  const BARK = 1300 * budget;
  const LEAF = 1300 * budget;
  for (let pass = 0; pass < 12; pass++) {
    tree.generate();
    const bt = tree.branchesMesh.geometry.index.count / 3;
    const lt = tree.leavesMesh.geometry.index.count / 3;
    if (bt <= BARK && lt <= LEAF) break;
    if (bt > BARK) {
      const last = String(o.branch.levels - 1);
      if (o.branch.children[last] > 2) o.branch.children[last] = Math.max(2, Math.floor(o.branch.children[last] * 0.75));
      else for (const k of Object.keys(o.branch.children)) if (k !== last) o.branch.children[k] = Math.max(2, Math.floor(o.branch.children[k] * 0.8));
      for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(k === '0' ? 3 : 1, Math.floor(o.branch.sections[k] * 0.8));
    } else if (lt > LEAF) {
      o.leaves.count = Math.max(1, Math.floor((o.leaves.count * LEAF) / lt));
      o.leaves.size *= 1.1;
    }
  }

  const part = (mesh, soft) => {
    const g = mesh.geometry;
    const P = g.attributes.position;
    const U = g.attributes.uv;
    const N = g.attributes.normal;
    let top = 0;
    for (let i = 0; i < P.count; i++) top = Math.max(top, P.getY(i));
    return { g, P, U, N, top, soft };
  };
  const parts = { bark: part(tree.branchesMesh, false), leaves: part(tree.leavesMesh, true) };
  const top = Math.max(parts.bark.top, parts.leaves.top);
  const s = height / top;
  // Crown centre, for soft foliage normals that shade the crown as one mass.
  const L = parts.leaves.P;
  const c = [0, 0, 0];
  for (let i = 0; i < L.count; i++) {
    c[0] += L.getX(i) / L.count;
    c[1] += L.getY(i) / L.count;
    c[2] += L.getZ(i) / L.count;
  }
  let radius = 0;
  const entry = { height, barkTex: o.bark.type, leafTex: o.leaves.type };
  for (const [key, p] of Object.entries(parts)) {
    const n = p.P.count;
    const data = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      const x = p.P.getX(i);
      const y = p.P.getY(i);
      const z = p.P.getZ(i);
      let nx = p.N.getX(i);
      let ny = p.N.getY(i);
      let nz = p.N.getZ(i);
      if (p.soft) {
        const d = [x - c[0], (y - c[1]) * 0.8 + top * 0.12, z - c[2]];
        const len = Math.hypot(...d) || 1;
        nx = d[0] / len;
        ny = d[1] / len;
        nz = d[2] / len;
        radius = Math.max(radius, Math.hypot(x, z) * s);
      }
      data.set([x * s, y * s, z * s, nx, ny, nz, p.U.getX(i), p.U.getY(i)], i * 8);
    }
    const index = Uint16Array.from(p.g.index.array);
    entry[key] = { vertices: [push(data), n], index: [push(index), index.length] };
  }
  entry.radius = +radius.toFixed(2);
  manifest[name] = entry;
  console.log(name.padEnd(12), preset.padEnd(13), 'bark tris', parts.bark.g.index.count / 3, 'leaf tris', parts.leaves.g.index.count / 3, 'radius', entry.radius);
}

mkdirSync(join(OUT, 'tex'), { recursive: true });
const bin = new Uint8Array(offset);
let at = 0;
for (const chunk of chunks) {
  bin.set(chunk, at);
  at += chunk.length;
}
writeFileSync(join(OUT, 'trees.bin'), bin);
writeFileSync(join(OUT, 'trees.json'), JSON.stringify(manifest));
for (const bark of ['oak', 'birch', 'pine']) copyFileSync(join(LIB, `assets/bark/${bark}_color_1k.jpg`), join(OUT, `tex/bark_${bark}.jpg`));
for (const leaf of ['oak', 'ash', 'aspen', 'pine']) copyFileSync(join(LIB, `assets/leaves/${leaf}_color.png`), join(OUT, `tex/leaf_${leaf}.png`));
// Tree textures are seen small; 512px is plenty (sips ships with macOS).
try {
  for (const f of ['bark_oak.jpg', 'bark_birch.jpg', 'bark_pine.jpg', 'leaf_oak.png', 'leaf_ash.png', 'leaf_aspen.png', 'leaf_pine.png']) execFileSync('sips', ['-Z', '512', join(OUT, 'tex', f)], { stdio: 'ignore' });
} catch {
  console.warn('sips not available: textures left at full size');
}
copyFileSync(join(LIB, '../app/public/grass.jpg'), join(OUT, 'tex/grass.jpg'));
copyFileSync(join(LIB, '../app/public/dirt_color.jpg'), join(OUT, 'tex/dirt.jpg'));
console.log('trees.bin', bin.length, 'bytes');
