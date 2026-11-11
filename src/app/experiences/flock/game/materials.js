// Shaders and generated textures. Everything shares one set of light / fog
// uniforms (`U`) so the whole scene follows the time of day and the weather.
// Colours are authored and shaded directly in display space.
import * as THREE from 'three';
import { BASIN } from './ground';
import { hash2 } from './noise';

// ------------------------------------------------------------------- textures
function periodicNoise(x, y, px, py) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash2(((a % px) + px) % px, ((b % py) + py) % py);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Tiling noise: r = soft blotches, g = long brush strokes, b = paper grain.
function makeBrushTexture() {
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const r = periodicNoise(u * 4, v * 4, 4, 4) * 0.6 + periodicNoise(u * 9, v * 9, 9, 9) * 0.4;
      const g = periodicNoise(u * 5, v * 28, 5, 28) * 0.65 + periodicNoise(u * 14, v * 60, 14, 60) * 0.35;
      const b = periodicNoise(u * 64, v * 64, 64, 64) * 0.6 + periodicNoise(u * 31, v * 31, 31, 31) * 0.4;
      const i = (y * S + x) * 4;
      data[i] = r * 255;
      data[i + 1] = g * 255;
      data[i + 2] = b * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export const makeBlobTexture = () =>
  canvasTexture(64, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });

// The runway seen from above: asphalt, edge lines, a dashed centre line,
// threshold bars, numbers and the rubber left where aircraft touch down.
// The strip's length runs up the canvas.
export function makeRunwayTexture() {
  const W = 128;
  const H = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#5b5f63';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 2 + Math.random() * 10);
  }
  const u = H / 500; // pixels per world unit along the strip
  for (const end of [0, 1]) {
    g.save();
    if (end) {
      g.translate(W, H);
      g.rotate(Math.PI);
    }
    // Rubber, darkest where most aircraft touch down.
    const rub = g.createLinearGradient(0, 40 * u, 0, 190 * u);
    rub.addColorStop(0, 'rgba(20,20,22,0)');
    rub.addColorStop(0.35, 'rgba(20,20,22,0.5)');
    rub.addColorStop(1, 'rgba(20,20,22,0)');
    g.fillStyle = rub;
    g.fillRect(W * 0.3, 40 * u, W * 0.16, 150 * u);
    g.fillRect(W * 0.54, 40 * u, W * 0.16, 150 * u);
    g.fillStyle = '#eceae2';
    for (let i = 0; i < 8; i++) g.fillRect(12 + i * 13.4 + (i > 3 ? 4 : 0), 6 * u, 8, 16 * u);
    g.font = `bold ${Math.round(13 * u)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.save();
    g.translate(W / 2, 27 * u);
    g.scale(0.62, 1);
    g.fillText(end ? '27' : '09', 0, 0);
    g.restore();
    for (const d of [70, 100, 130]) for (const x of [30, 86]) g.fillRect(x, d * u, 12, 11 * u);
    g.restore();
  }
  g.fillStyle = '#eceae2';
  g.fillRect(4, 0, 3, H);
  g.fillRect(W - 7, 0, 3, H);
  for (let d = 60; d < 440; d += 20) g.fillRect(W / 2 - 2, d * u, 4, 11 * u);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const makeCloudTexture = () =>
  canvasTexture(256, (g, s) => {
    let seed = 7;
    const rnd = () => hash2(seed++, 91);
    const puff = (x, y, r, a) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(0.6, `rgba(255,255,255,${a * 0.8})`);
      grad.addColorStop(0.86, `rgba(255,255,255,${a * 0.3})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    };
    // A flat-bottomed heap: a row of big lobes, smaller ones piled on top.
    for (let i = 0; i < 7; i++) puff(s * (0.2 + (0.6 * i) / 6), s * (0.6 + rnd() * 0.03), s * (0.12 + rnd() * 0.05) * (1 - Math.abs(i / 6 - 0.5) * 0.7), 0.8);
    for (let i = 0; i < 9; i++) puff(s * (0.3 + rnd() * 0.4), s * (0.4 + rnd() * 0.13), s * (0.07 + rnd() * 0.07), 0.7);
    for (let i = 0; i < 12; i++) puff(s * (0.14 + rnd() * 0.72), s * (0.5 + rnd() * 0.14), s * (0.035 + rnd() * 0.05), 0.6);
  });

// ------------------------------------------------------------ shared uniforms
export function createUniforms() {
  return {
    uSun: { value: new THREE.Vector3(0.5, 0.6, -0.4).normalize() },
    uSunCol: { value: new THREE.Color(1.2, 1.02, 0.8) },
    uShadeCol: { value: new THREE.Color(0.5, 0.56, 0.78) },
    uSkyTop: { value: new THREE.Color(0.45, 0.68, 0.9) },
    uFogCol: { value: new THREE.Color(0.96, 0.86, 0.7) },
    uFogSun: { value: new THREE.Color(1, 0.86, 0.6) },
    uCloudLit: { value: new THREE.Color(1, 0.97, 0.9) },
    uCloudShade: { value: new THREE.Color(0.7, 0.72, 0.85) },
    uWaterCol: { value: new THREE.Color(0.16, 0.42, 0.56) },
    uFogDensity: { value: 0.0015 },
    uTime: { value: 0 },
    uWet: { value: 0 },
    uFlash: { value: 0 },
    uStorm: { value: 0 },
    uBrush: { value: makeBrushTexture() },
    // Sun shadow map (see engine.js): depth seen from the sun, and the matrix into it.
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowTexel: { value: 1 / 2048 },
    uShadowOn: { value: 0 },
    // The nearest basin (see ground.js): z of its two cliff tops at the river, then the river's x at each.
    uBasin: { value: new THREE.Vector4() },
    uBasinOn: { value: 0 },
    // Hand tuning (see tuning.js): sun, ambient, sun-shadow depth, rim light.
    uLight: { value: new THREE.Vector4(1, 1, 1, 0.12) },
  };
}

const FOG_PARS = /* glsl */ `
uniform vec3 uSun, uSunCol, uShadeCol, uFogCol, uFogSun;
uniform float uFogDensity, uFlash, uWet, uTime;
uniform sampler2D uBrush;
varying vec3 vWorld;
vec3 applyFog(vec3 col) {
  vec3 ray = vWorld - cameraPosition;
  float d = length(ray);
  float f = 1.0 - exp(-pow(d * uFogDensity, 1.5));
  float toSun = pow(max(dot(ray / d, uSun), 0.0), 6.0);
  return mix(col, mix(uFogCol, uFogSun, toSun * 0.8), f) + uFlash * 0.35;
}`;

// ------------------------------------------------------------- painter (solid)
const PAINT_VERT = /* glsl */ `
#if !defined(USE_MAP) && !defined(USE_TEX)
attribute vec3 aColor;
#endif
#ifdef WALK
attribute float aWalk; // how far through its stride a walker is, in radians
#endif
#ifdef SPIN
uniform float uHub; // height of the axle the sails turn on
#endif
#ifdef FLAP
attribute vec4 aFlap; // phase, amplitude, sweep, lit boost
uniform float uShoulder, uArm;
#endif
uniform float uTime;
uniform mat4 uShadowMatrix;
varying vec4 vShadow;
varying vec3 vColor, vNormal, vWorld;
varying vec2 vUv;
void main() {
  vec3 p = position;
  vec3 n = normal;
  vColor = vec3(1.0);
#if !defined(USE_MAP) && !defined(USE_TEX)
  vColor = aColor;
#endif
#ifdef FLAP
  float d = abs(p.x) - uShoulder;
  if (d > 0.0) {
    float sx = sign(p.x);
    float amp = aFlap.y;
    float sw = aFlap.z;
    float a = amp * 0.6 * sin(aFlap.x) + 0.1 * (1.0 - amp) - 0.12 * sw;
    float b = amp * 0.8 * sin(aFlap.x - 1.0) - 0.16 * (1.0 - amp);
    float d1 = min(d, uArm);
    float d2 = max(d - uArm, 0.0);
    float fold = sw * 0.95;
    float x1 = d1 * cos(a) * (1.0 - 0.3 * sw) + d2 * cos(a + b) * cos(fold);
    p.y += d1 * sin(a) + d2 * sin(a + b);
    p.z += d2 * sin(fold) + d1 * sw * 0.45;
    p.x = sx * (uShoulder + x1);
    float an = (d > uArm ? a + b : a) * sx;
    n = vec3(n.x * cos(an) - n.y * sin(an), n.x * sin(an) + n.y * cos(an), n.z);
  }
  vColor *= 1.0 + aFlap.w;
#endif
#ifdef SPIN
  // Windmill sails: turn about the axle, each mill starting at its own angle.
  float turn = uTime * 0.7 + instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
  mat2 rot = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  p.xy = rot * (p.xy - vec2(0.0, uHub)) + vec2(0.0, uHub);
  n.xy = rot * n.xy;
#endif
#ifdef WALK
  // A walking figure: legs swing from the hip, arms from the shoulder, in opposite step.
  float stride = sin(aWalk) * sign(p.x);
  if (p.y < 2.0) {
    p.z += stride * 0.42 * (2.0 - p.y);
    p.y += abs(stride) * 0.06 * (2.0 - p.y);
  } else if (abs(p.x) > 0.62 && p.y < 3.5) {
    p.z -= stride * 0.3 * (3.45 - p.y);
  }
#endif
#ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
#else
  mat4 m = modelMatrix;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor *= instanceColor;
#endif
  vec4 w = m * vec4(p, 1.0);
#ifdef SWAY
  // Wind: the whole plant leans, and its upper parts shiver.
  float bend = p.y * 0.016 + max(p.y - 1.5, 0.0) * 0.022;
  float ph = w.x * 0.05 + w.z * 0.07;
  w.x += sin(uTime * 1.3 + ph) * bend + sin(uTime * 3.3 + ph * 3.0 + p.y + p.x) * 0.045 * step(1.2, p.y);
  w.z += cos(uTime * 1.1 + ph * 1.3) * bend * 0.7;
#endif
  vWorld = w.xyz;
  vNormal = normalize(mat3(m) * n);
  // Looked up a little off the surface, so a surface never shadows itself.
  vShadow = uShadowMatrix * vec4(w.xyz + vNormal * 0.4, 1.0);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const PAINT_FRAG = /* glsl */ `
${FOG_PARS}
uniform vec3 uSkyTop;
#ifdef USE_MAP
uniform sampler2D map, uGrass, uDirt;
#endif
#ifdef USE_TEX
uniform sampler2D tex;
#endif
varying vec3 vColor, vNormal;
varying vec2 vUv;
varying vec4 vShadow;
uniform sampler2D uShadowMap;
uniform float uShadowTexel, uShadowOn;
uniform vec4 uLight;
// How much direct sun reaches this point: 0 in shadow, 1 in the open.
float sunlight() {
  vec3 sc = vShadow.xyz * 0.5 + 0.5;
  if (uShadowOn < 0.5 || sc.z > 1.0) return 1.0;
  float s = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      s += step(sc.z - 0.0009, texture2D(uShadowMap, sc.xy + vec2(float(x), float(y)) * uShadowTexel * 1.4).r);
    }
  }
  vec2 e = abs(sc.xy - 0.5) * 2.0;
  return mix(s / 9.0, 1.0, smoothstep(0.8, 1.0, max(e.x, e.y)));
}
void main() {
  vec3 base = vColor;
#ifdef USE_MAP
  base *= texture2D(map, vUv).rgb;
  // Real grass and soil photographs give the painted colours their grain.
  // Each is divided by its own average, so it adds detail without a colour cast.
  float grassy = smoothstep(0.0, 0.14, base.g - max(base.r, base.b) * 0.94);
  float farK = smoothstep(40.0, 260.0, distance(vWorld, cameraPosition));
  // Two fixed scales, cross-faded by distance. The scale itself must never
  // depend on the camera, or the texture slides over the ground as it moves.
  vec2 gn = vWorld.xz * 0.085;
  vec2 gf = vWorld.xz * 0.019;
  vec3 gAvg = max(texture2D(uGrass, gn, 10.0).rgb, 0.03);
  vec3 dAvg = max(texture2D(uDirt, gn, 10.0).rgb, 0.03);
  vec3 gd = mix(texture2D(uGrass, gn).rgb, texture2D(uGrass, gf).rgb, farK) / gAvg;
  vec3 dd = mix(texture2D(uDirt, gn * 0.8).rgb, texture2D(uDirt, gf * 0.8).rgb, farK) / dAvg;
  base *= mix(vec3(1.0), mix(dd, gd, grassy), 0.75 - 0.3 * farK);
#endif
#ifdef USE_TEX
  vec4 tx = texture2D(tex, vUv);
#ifdef LEAF
  if (tx.a < 0.3) discard;
  // Leaves take their hue from the tree's tint and their detail from the photo.
  float lum = dot(tx.rgb, vec3(0.3, 0.6, 0.1));
  base *= mix(vec3(lum * 2.6), tx.rgb * 2.2, 0.35);
#else
  base *= tx.rgb * 1.2;
#endif
#endif
  vec3 n = normalize(vNormal);
#ifndef LEAF
  n *= gl_FrontFacing ? 1.0 : -1.0;
#endif
  // Brush: blotches shift the value, strokes break up flat areas.
  vec2 bu = vWorld.xz * 0.021 + vWorld.y * 0.013;
  vec3 br = texture2D(uBrush, bu).rgb;
  float stroke = texture2D(uBrush, bu.yx * 2.7).g;
  base *= 0.96 + 0.08 * br.r;
  // Close to the eye, finer strokes keep the paint from going soft.
  float nearK = 1.0 - smoothstep(20.0, 90.0, distance(vWorld, cameraPosition));
  vec3 fine = texture2D(uBrush, vWorld.xz * 0.17 + vWorld.y * 0.09).rgb;
  base *= 1.0 + nearK * (fine.b - 0.5) * 0.06;
  base = mix(base, base * vec3(0.62, 0.68, 0.74), uWet * 0.6);

#ifdef USE_MAP
  // The ground is never perfectly smooth: let the brush texture ruffle it.
  n = normalize(n + vec3(fine.r - 0.5, 0.0, fine.g - 0.5) * (0.3 + 0.5 * nearK) + vec3(br.r - 0.5, 0.0, stroke - 0.5) * 0.22);
#endif
  // Light: sky from above and warm bounce from below fill the shade; the sun
  // adds on top wherever nothing stands between it and the surface.
  float sun = mix(1.0, sunlight(), uLight.z);
  float direct = smoothstep(-0.12, 0.72, dot(n, uSun)) * sun;
#ifdef LEAF
  direct = mix(direct, sun * 0.75, 0.45); // leaves glow when lit from behind
#endif
  float up = 0.5 + 0.5 * n.y;
  vec3 ambient = uShadeCol * mix(0.5, 0.82, up) + uSkyTop * up * 0.08 + uSunCol * (1.0 - up) * 0.06;
  vec3 col = base * (ambient * uLight.y + max(uSunCol * 1.08 - uShadeCol * 0.8, 0.0) * direct * uLight.x);
#ifndef USE_MAP
  vec3 view = normalize(cameraPosition - vWorld);
  float edge = 1.0 - max(dot(n, view), 0.0);
  col += uSkyTop * pow(edge, 3.0) * uLight.w;
  // A low sun catches the edges that face it: a warm rim, strongest on the birds.
  float lowSun = 1.0 - smoothstep(0.25, 0.75, uSun.y);
#ifdef SHARP
  col += uSunCol * pow(edge, 2.2) * smoothstep(-0.2, 0.6, dot(n, uSun)) * lowSun * uLight.w * 5.0 * sun;
#else
  col += uSunCol * pow(edge, 2.5) * smoothstep(-0.2, 0.6, dot(n, uSun)) * lowSun * uLight.w * 1.5 * sun;
#endif
#endif
#ifdef SHARP
  gl_FragColor = vec4(applyFog(col), 0.0);
#else
  gl_FragColor = vec4(applyFog(col), 1.0);
#endif
}`;

export function paintMaterial(U, { map = null, flap = null, doubleSide = false, sway = false, tex = null, leaf = false, ground = null, sharp = false, spin = 0, walk = false } = {}) {
  const defines = {};
  if (walk) defines.WALK = '';
  if (sharp) defines.SHARP = ''; // stays out of the motion blur (see postMaterial)
  if (sway) defines.SWAY = '';
  if (leaf) defines.LEAF = '';
  const uniforms = { ...U };
  if (map) {
    defines.USE_MAP = '';
    uniforms.map = { value: map };
    uniforms.uGrass = { value: ground.grass };
    uniforms.uDirt = { value: ground.dirt };
  }
  if (spin) {
    defines.SPIN = '';
    uniforms.uHub = { value: spin };
  }
  if (tex) {
    defines.USE_TEX = '';
    uniforms.tex = { value: tex };
  }
  if (flap) {
    defines.FLAP = '';
    uniforms.uShoulder = { value: flap.shoulder };
    uniforms.uArm = { value: flap.arm };
  }
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
    vertexShader: PAINT_VERT,
    fragmentShader: PAINT_FRAG,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// ------------------------------------------------------------------------ sky
const GLSL_NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += vnoise(p) * a; p = p * 2.07 + 13.1; a *= 0.5; }
  return s / 0.9375;
}`;

export function skyMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uSunCol, uSkyTop, uFogCol, uFogSun, uCloudLit, uCloudShade;
      uniform float uTime, uStorm, uFlash;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uFogCol, uSkyTop, pow(h, 0.5));
        float s = max(dot(d, uSun), 0.0);
        col = mix(col, uFogSun, pow(s, 4.0) * 0.8 * (1.0 - h * 0.5));
        col += uSunCol * smoothstep(0.9988, 0.9994, s) * 0.6 * (1.0 - uStorm);
        vec2 q = d.xz / (d.y + 0.22);
        float c = fbm(q * vec2(1.1, 2.2) + vec2(uTime * 0.006, 0.0));
        c = smoothstep(0.52 - 0.3 * uStorm, 0.8, c) * smoothstep(0.0, 0.22, d.y);
        col = mix(col, mix(uCloudShade, uCloudLit, 0.35 + 0.65 * pow(s, 2.0)), c * 0.8);
        float a = atan(d.x, -d.z);
        float far = 0.03 + 0.085 * fbm(vec2(a * 3.0 + 4.0, 1.0));
        float near = 0.012 + 0.05 * fbm(vec2(a * 7.0, 9.0));
        vec3 mount = mix(uFogCol, uCloudShade * 0.7, 0.42);
        col = mix(col, mount, smoothstep(far + 0.004, far - 0.004, d.y));
        col = mix(col, mix(uFogCol, mount * 0.8, 0.55), smoothstep(near + 0.004, near - 0.004, d.y));
        col = mix(col, uFogCol, smoothstep(0.006, -0.02, d.y));
        gl_FragColor = vec4(col + uFlash * 0.5, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------- water
export function waterMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: U,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform vec4 uBasin;
      uniform float uBasinOn;
      varying vec3 vWorld;
      varying float vSunk;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        // The surface steps down into a basin where the river goes over the
        // cliff, and back up at the far side: those steps are the waterfalls.
        vSunk = uBasinOn * (1.0 - smoothstep(uBasin.x - ${BASIN.fall}.0, uBasin.x, w.z)) * smoothstep(uBasin.y, uBasin.y + ${BASIN.fall}.0, w.z);
        w.y -= ${BASIN.drop}.0 * vSunk;
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_PARS}
      uniform vec3 uWaterCol, uSkyTop;
      uniform vec4 uBasin;
      uniform float uBasinOn;
      varying float vSunk;
      void main() {
        // The land's own drop here (the cliff line wanders from side to side).
        float cw = 28.0 * sin(vWorld.x * 0.013 + 1.3) + 14.0 * sin(vWorld.x * 0.031 + 4.0);
        vec2 top = uBasin.xy + vec2(28.0 * sin(uBasin.z * 0.013 + 1.3) + 14.0 * sin(uBasin.z * 0.031 + 4.0), 28.0 * sin(uBasin.w * 0.013 + 1.3) + 14.0 * sin(uBasin.w * 0.031 + 4.0)) - cw;
        float land = uBasinOn * (1.0 - smoothstep(top.x - ${BASIN.fall}.0, top.x, vWorld.z)) * smoothstep(top.y, top.y + ${BASIN.fall}.0, vWorld.z);
        float nearIn = step(abs(vWorld.z - uBasin.x), abs(vWorld.z - uBasin.y));
        float fromRiver = abs(vWorld.x - mix(uBasin.w, uBasin.z, nearIn));
        float falling = smoothstep(0.015, 0.08, vSunk) * (1.0 - smoothstep(0.92, 0.985, vSunk));
        // Water only falls where the river is; nowhere may it hang over land that has dropped away.
        if (falling > 0.0 && fromRiver > 21.0) discard;
        if (land - vSunk > 0.04 && fromRiver > 21.0) discard;
        vec2 uv = vWorld.xz * 0.028;
        vec2 ur = vec2(uv.x * 0.8 - uv.y * 0.6, uv.x * 0.6 + uv.y * 0.8);
        float n1 = texture2D(uBrush, uv * 0.37 + vec2(uTime * 0.006, uTime * 0.009)).r;
        float n2 = texture2D(uBrush, ur * 1.9 - vec2(uTime * 0.02, -uTime * 0.014)).r;
        float n3 = texture2D(uBrush, uv * 6.1 + uTime * 0.03).b;
        vec3 n = normalize(vec3((n1 - 0.5) * 0.7, 1.0, (n2 - 0.5) * 0.7));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 col = mix(uWaterCol, mix(uSkyTop, uFogCol, 0.5), 0.18 + 0.7 * fres);
        float spec = pow(max(dot(reflect(-v, n), uSun), 0.0), 60.0);
        float glint = smoothstep(0.66, 0.72, n1 * 0.5 + n2 * 0.35 + n3 * 0.3) * (0.25 + 0.75 * pow(max(dot(reflect(-v, vec3(0, 1, 0)), uSun), 0.0), 3.0));
        col += uSunCol * (spec * 0.8 + glint * 0.2) * (1.0 - uWet * 0.7);
        float alpha = 0.74 + 0.24 * fres;
        // Falling water: white, in long streaks that run down the face.
        float streak = texture2D(uBrush, vec2(vWorld.x * 0.09, vWorld.y * 0.012 + uTime * 0.55)).r;
        float streak2 = texture2D(uBrush, vec2(vWorld.x * 0.21 + 0.4, vWorld.y * 0.02 + uTime * 0.8)).g;
        vec3 foam = mix(uShadeCol * 0.9 + 0.25, vec3(1.0), 0.5 + 0.5 * streak) * (0.82 + 0.18 * streak2);
        col = mix(col, foam * mix(uShadeCol + 0.35, vec3(1.0), 0.6), falling);
        alpha = mix(alpha, 0.96, falling);
        // Churned white at the foot of each fall.
        float foot = uBasinOn * step(0.985, vSunk) * (1.0 - smoothstep(0.0, 46.0, min(abs(vWorld.z - (uBasin.x - ${BASIN.fall}.0)), abs(vWorld.z - (uBasin.y + ${BASIN.fall}.0))))) * (1.0 - smoothstep(10.0, 24.0, fromRiver));
        col = mix(col, vec3(0.95), foot * (0.35 + 0.5 * n3));
        gl_FragColor = vec4(applyFog(col), alpha);
      }`,
  });
}

// ---------------------------------------------------------- billboards (clouds)
export function cloudMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uMap: { value: makeCloudTexture() } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec4 aShape; // width, height, flip, darkness
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDark, vFade;
      void main() {
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 w = aPos + right * position.x * aShape.x * aShape.z + up * position.y * aShape.y;
        vWorld = w;
        vUv = uv;
        vDark = aShape.w;
        vFade = smoothstep(6.0, 45.0, distance(w, cameraPosition));
        // Fair-weather clouds seen from above read as a smear over the land, so
        // they fade out under the overhead camera. Storm clouds stay.
        if (aShape.w < 0.01) vFade *= 1.0 - smoothstep(8.0, 40.0, cameraPosition.y - aPos.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_PARS}
      uniform sampler2D uMap;
      uniform vec3 uCloudLit, uCloudShade;
      varying vec2 vUv;
      varying float vDark, vFade;
      void main() {
        float a = texture2D(uMap, vUv).a;
        if (a < 0.01) discard;
        float lum = smoothstep(0.34, 0.56, vUv.y + (a - 0.5) * 0.16);
        vec3 col = mix(mix(uCloudShade, uCloudLit, 0.35), uCloudLit, lum);
        col = mix(col, col * vec3(0.4, 0.43, 0.52), vDark);
        gl_FragColor = vec4(applyFog(col), smoothstep(0.03, 0.55, a) * (0.86 + vDark * 0.14) * vFade);
      }`,
  });
}

// The shadow of a flyer: its outline from an atlas (see fx.js), laid on the
// ground and softened at the edge. aShade is tile u, tile v, blur, strength.
export function silhouetteMaterial(U, map, cols, rows) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uMap: { value: map }, uTile: { value: new THREE.Vector2(1 / cols, 1 / rows) }, uStrength: { value: 0.58 } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute vec4 aShade;
      varying vec2 vUv;
      varying vec4 vShade;
      void main() {
        vUv = uv;
        vShade = aShade;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec2 uTile;
      uniform float uWet, uStrength;
      varying vec2 vUv;
      varying vec4 vShade;
      void main() {
        float a = 0.0;
        for (int i = 0; i < 24; i++) {
          float ang = float(i) * 2.399963;
          vec2 o = vec2(cos(ang), sin(ang)) * sqrt((float(i) + 0.5) / 24.0) * vShade.z;
          a += texture2D(uMap, vShade.xy + clamp(vUv + o, 0.0, 1.0) * uTile).r;
        }
        a *= vShade.w * (1.0 - uWet * 0.5) / 24.0;
        gl_FragColor = vec4(vec3(0.05, 0.1, 0.16), a * uStrength);
      }`,
  });
}

// Flat soft discs on the ground under trees, rocks and buildings.
export function shadowMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uMap: { value: makeBlobTexture() } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vAlpha;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vUv = uv;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_PARS}
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float a = texture2D(uMap, vUv).a * vAlpha * (1.0 - uWet * 0.5);
        gl_FragColor = vec4(vec3(0.05, 0.1, 0.16), a * 0.55);
      }`,
  });
}

// ------------------------------------------------------------------- particles
export function particleMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uMap: { value: makeBlobTexture() }, uScale: { value: 600 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aColor;
      attribute float aSize;
      uniform float uScale;
      varying vec4 vCol;
      void main() {
        vCol = aColor;
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec4 vCol;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vCol.a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol.rgb, a);
      }`,
  });
}

// ------------------------------------------------------------------------ rain
export function rainMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uRain: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uDrift: { value: new THREE.Vector3(6, -70, 30) } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aEnd;
      uniform float uTime, uRain;
      uniform vec3 uCenter, uDrift;
      varying float vA;
      void main() {
        vec3 box = vec3(170.0, 130.0, 170.0);
        vec3 p = mod(position + uDrift * uTime - uCenter, box) - box * 0.5 + uCenter;
        p += normalize(uDrift) * aEnd * 3.2;
        vA = (1.0 - aEnd) * uRain * step(fract(position.x * 7.31), uRain + 0.15);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogCol;
      varying float vA;
      void main() { gl_FragColor = vec4(mix(uFogCol, vec3(1.0), 0.6), vA * 0.5); }`,
  });
}

// ------------------------------------------------------------------ final pass
// Final pass: a soft colour grade, a light vignette, the speed stretch when
// diving and the red flash on a hit. No grain or paper texture.
const SCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const screenPass = (uniforms, fragmentShader) => new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false, vertexShader: SCREEN_VERT, fragmentShader });

// Bloom, god rays and motion blur (desktop only), after the frame pipeline of
// Petalwake (MIT, Jacob Miller, https://github.com/jjcm/petalwake).
//
// What glows: the brightest parts of the picture in rgb, and in alpha the
// bright sky, which is what the god rays are drawn out of.
export function brightMaterial() {
  return screenPass(
    { tScene: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.85 } },
    /* glsl */ `
      uniform sampler2D tScene, tDepth;
      uniform vec2 uTexel;
      uniform float uThreshold;
      varying vec2 vUv;
      void main() {
        vec3 c = 0.25 * (texture2D(tScene, vUv + uTexel * vec2(-1, -1)).rgb + texture2D(tScene, vUv + uTexel * vec2(1, -1)).rgb
          + texture2D(tScene, vUv + uTexel * vec2(-1, 1)).rgb + texture2D(tScene, vUv + uTexel * vec2(1, 1)).rgb);
        float y = dot(c, vec3(0.299, 0.587, 0.114));
        float sky = step(0.99999, texture2D(tDepth, vUv).r);
        gl_FragColor = vec4(min(c, 4.0) * smoothstep(uThreshold, uThreshold + 0.5, y), sky * smoothstep(0.8, 1.35, y));
      }`,
  );
}

// One direction of a soft blur.
export function blurMaterial() {
  return screenPass(
    { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } },
    /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 uStep;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tSrc, vUv) * 0.227;
        c += (texture2D(tSrc, vUv + uStep * 1.385) + texture2D(tSrc, vUv - uStep * 1.385)) * 0.316;
        c += (texture2D(tSrc, vUv + uStep * 3.231) + texture2D(tSrc, vUv - uStep * 3.231)) * 0.0703;
        gl_FragColor = c;
      }`,
  );
}

// Shafts of light: the bright sky smeared away from the sun.
export function raysMaterial() {
  return screenPass(
    { tSrc: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 } },
    /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 uSun;
      uniform float uAspect;
      varying vec2 vUv;
      void main() {
        vec2 stepTo = (uSun - vUv) / 30.0 * 0.92;
        vec2 p = vUv;
        float acc = 0.0;
        float w = 1.0;
        for (int i = 0; i < 30; i++) {
          acc += texture2D(tSrc, p).a * w;
          p += stepTo;
          w *= 0.955;
        }
        // Shafts fade with distance from the sun, so they never haze the whole sky.
        float reach = 1.0 - smoothstep(0.0, 0.75, length((vUv - uSun) * vec2(uAspect, 1.0)));
        gl_FragColor = vec4(acc / 14.0 * reach * reach);
      }`,
  );
}

export function postMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      uBrush: U.uBrush,
      uTime: U.uTime,
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
      uAspect: { value: 1 },
      uHurt: { value: 0 },
      uSpeed: { value: 0 },
      // Hand tuning (see tuning.js): exposure, saturation, contrast, highlight roll-off; then warmth, vignette.
      uGrade: { value: new THREE.Vector4(1, 1.1, 0.3, 1.25) },
      uGrade2: { value: new THREE.Vector2(0, 0.35) },
      // Bloom, god rays, motion blur: their inputs, then strengths (bloom, rays, blur).
      tDepth: { value: null },
      tBloom: { value: null },
      tRays: { value: null },
      uFx: { value: new THREE.Vector3() },
      uSunCol: U.uSunCol,
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      // Depth of field: focus distance, where the far blur starts and is full, and its size in pixels.
      uDof: { value: new THREE.Vector4(30, 150, 1400, 0) },
      uNearFar: { value: new THREE.Vector2(1, 2600) },
      // The film look: shadow tint, highlight tint, strength. Then the letterbox bars (share of the height, each).
      uSplitLo: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uSplitHi: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uSplit: { value: 0 },
      uBars: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene, uBrush, tDepth, tBloom, tRays;
      uniform vec3 uFx, uSunCol;
      uniform mat4 uInvViewProj, uPrevViewProj;
      uniform vec4 uDof;
      uniform vec2 uNearFar;
      uniform vec3 uSplitLo, uSplitHi;
      uniform float uSplit, uBars;
      uniform vec2 uTexel;
      uniform float uAspect, uHurt, uTime, uSpeed;
      uniform vec4 uGrade;
      uniform vec2 uGrade2;
      varying vec2 vUv;
      float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      // How far out of focus a point is, 0..1: soft far away, softer still right in front of the lens.
      float blurAt(vec2 p) {
        float z = texture2D(tDepth, p).r * 2.0 - 1.0;
        float d = 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
        return max(smoothstep(uDof.y, uDof.z, d) * 0.75, 1.0 - smoothstep(uDof.x * 0.2, uDof.x * 0.6, d));
      }
      void main() {
        vec2 dir = (vUv - 0.5);
        vec2 uv = vUv - dir * dot(dir, dir) * uSpeed * 0.05;
        vec4 here = texture2D(tScene, uv);
        vec3 col = here.rgb;
        // Motion blur: smear each point along the way it moved across the screen
        // since the last frame. The birds and aircraft mark themselves with a
        // low alpha: they stay sharp, and are never smeared into what is behind them.
        if (uFx.z > 0.0 && here.a > 0.5) {
          vec4 w = uInvViewProj * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).r * 2.0 - 1.0, 1.0);
          vec4 was = uPrevViewProj * vec4(w.xyz / w.w, 1.0);
          if (was.w > 0.0) {
            vec2 vel = (uv - (was.xy / was.w * 0.5 + 0.5)) * uFx.z;
            vel *= min(1.0, 0.045 / max(length(vel), 1e-5));
            float n = 1.0;
            for (int i = 0; i < 6; i++) {
              vec4 s = texture2D(tScene, uv + vel * (float(i) / 5.0 - 0.5));
              float k = step(0.5, s.a);
              col += s.rgb * k;
              n += k;
            }
            col /= n;
          }
        }
        // Depth of field: the flock is in focus; the distance and anything close to the
        // lens go soft. Birds and aircraft (low alpha) are never softened or smeared.
        if (uDof.w > 0.0 && here.a > 0.5) {
          float soft = blurAt(uv);
          if (soft > 0.02) {
            float n = 1.0;
            for (int i = 0; i < 10; i++) {
              float a = float(i) * 2.399963;
              vec2 p = uv + vec2(cos(a), sin(a)) * sqrt((float(i) + 0.5) / 10.0) * soft * uDof.w * uTexel;
              vec4 s = texture2D(tScene, p);
              float k = step(0.5, s.a) * (0.05 + blurAt(p));
              col += s.rgb * k;
              n += k;
            }
            col /= n;
          }
        }
        col += texture2D(tBloom, uv).rgb * uFx.x + uSunCol * texture2D(tRays, uv).r * uFx.y;
        col *= uGrade.x;
        col *= vec3(1.0 + uGrade2.x, 1.0, 1.0 - uGrade2.x);
        float y = luma(col);
        col = mix(vec3(y), col, uGrade.y);
        // Roll the highlights off instead of clipping them.
        col = mix(col, 1.0 - exp(-col * uGrade.w), smoothstep(0.55, 1.2, y));
        col = mix(col, col * col * (3.0 - 2.0 * col), uGrade.z);
        // Split toning: one tint for the shadows, another for the highlights.
        float tone = luma(col);
        col = mix(col, col * uSplitLo * 2.0, uSplit * (1.0 - smoothstep(0.0, 0.55, tone)));
        col = mix(col, col * uSplitHi * 2.0, uSplit * smoothstep(0.45, 1.0, tone));
        float v = dot(dir, dir);
        col *= 1.0 - v * uGrade2.y;
        col = mix(col, vec3(0.75, 0.12, 0.08), uHurt * smoothstep(0.08, 0.5, v) * 0.7);
        col *= 1.0 - step(0.5 - uBars, abs(vUv.y - 0.5)); // letterbox
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
