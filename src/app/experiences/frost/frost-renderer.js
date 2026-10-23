import { createFrameLoop } from '@/lib/frame-loop';

// Plants seen through frosted glass, in raw WebGL2.
//
// Pass 1 draws the foliage as three depth layers (far, mid, near), each into its own
// transparent texture. Stems and leaves share one wind field in their vertex shaders, so a
// leaf stays on its stem as it bows, and each leaf also flutters on its own.
// Pass 2 is the glass. Each layer is blurred with its own radius (the farther from the glass,
// the softer), looked at through a warped "frost" refraction, then fogged, lifted with milk
// and finished with film grain fixed to the glass.

const LEAF_ROWS = 9;
const LAYERS = ['Far', 'Mid', 'Near'];
const LEAF_LENGTH = [0.17, 0.2, 0.235]; // height units; nearer leaves are larger
const LEAF_STRIDE = 12;
const STEM_ROWS = 20;
const STEM_STRIDE = 8;

// A gust front travelling across the stage, offset a little per stem so it never moves as one sheet.
const WIND = `
uniform float uTime;
uniform float uSway;
float gust(vec2 p, float phase) {
  float front = sin(uTime * 0.62 - dot(p, vec2(0.8, 0.6)) * 2.1 + phase * 1.7);
  float breath = sin(uTime * 1.27 + phase * 11.0 - p.y * 2.3);
  return front * 0.65 + breath * 0.35;
}
`;

const STEM_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aMesh;  // x: along the stem (0 root .. 1 tip), y: side (-1..1)
layout(location=1) in vec4 aA;     // root xy, heading, length
layout(location=2) in vec4 aB;     // bend, phase, half width, tint
uniform float uAspect;
uniform float uStemWidth;
uniform vec3 uColor;
uniform float uOpacity;
${WIND}
out vec4 vColor;

void main() {
  float s = aMesh.x;
  vec2 dir = vec2(cos(aA.z), sin(aA.z));
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 p = aA.xy + dir * (aA.w * s) + perp * (aB.x * aA.w * s * s);
  vec2 tangent = normalize(dir + perp * (2.0 * aB.x * s));
  float g = gust(p, aB.y);
  p += perp * g * uSway * 0.045 * s * s;               // same bow the leaves apply to their bases
  p += vec2(-tangent.y, tangent.x) * (aMesh.y * aB.z * uStemWidth * (1.0 - 0.75 * s));
  gl_Position = vec4(p.x / uAspect * 2.0 - 1.0, p.y * 2.0 - 1.0, 0.0, 1.0);

  vec3 c = uColor * 0.82 * (0.9 + 0.2 * aB.w);
  float a = uOpacity * (1.0 - 0.45 * aMesh.y * aMesh.y);
  vColor = vec4(c * a, a);
}
`;

const LEAF_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aMesh;  // x: along the leaf (0 base .. 1 tip), y: side (-1..1, 0 = midrib)
layout(location=1) in vec4 aA;     // base xy, rest angle, length
layout(location=2) in vec4 aB;     // half width, stem phase, position along the stem, leaf phase
layout(location=3) in vec4 aC;     // stem angle, tint, curl
uniform float uAspect;
uniform float uFlutter;
uniform float uLeafScale;
uniform float uLeafWidth;
uniform vec3 uColor;
uniform float uOpacity;
${WIND}
out vec4 vColor;

void main() {
  float t = aMesh.x;
  float side = aMesh.y;
  float s = aB.z;
  vec2 base = aA.xy;
  float len = aA.w * uLeafScale;

  float g = gust(base, aB.y);
  vec2 stemDir = vec2(cos(aC.x), sin(aC.x));
  vec2 stemPerp = vec2(-stemDir.y, stemDir.x);
  base += stemPerp * g * uSway * 0.045 * s * s;      // the stem bows, more toward its tip

  float flutter = (sin(uTime * 1.9 + aB.w * 6.2831 + g * 1.4) * 0.10
                 + sin(uTime * 3.1 + aB.w * 17.0) * 0.025) * uFlutter;
  float ang = aA.z + g * uSway * 0.10 * s + flutter * 0.5;
  float curl = aC.z + flutter;

  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 perp = vec2(-dir.y, dir.x);
  float profile = pow(max(sin(3.14159265 * pow(t, 0.7)), 0.0), 0.85);

  vec2 mid = base + dir * (len * t) + perp * (curl * len * t * t * 0.35);
  vec2 world = mid + perp * (side * aB.x * uLeafWidth * len / aA.w * profile);
  gl_Position = vec4(world.x / uAspect * 2.0 - 1.0, world.y * 2.0 - 1.0, 0.0, 1.0);

  vec3 c = uColor * (0.88 + 0.24 * aC.y);
  c *= mix(0.9, 1.08, t);
  c *= 1.0 - 0.1 * (1.0 - abs(side));                 // faint darker midrib
  float a = uOpacity * smoothstep(0.0, 0.14, t) * (1.0 - 0.4 * side * side);
  vColor = vec4(c * a, a);                            // premultiplied
}
`;

const LEAF_FRAG = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }
`;

const GLASS_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const GLASS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uFar;
uniform sampler2D uMid;
uniform sampler2D uNear;
uniform vec2 uRes;
uniform float uAspect;
uniform float uTime;
uniform vec3 uBlur;          // far, mid, near radius (stage height units)
uniform float uWarp;
uniform float uWarpScale;
uniform float uMicro;
uniform float uHaze;
uniform float uFog;
uniform float uContrast;
uniform float uSat;
uniform float uGrain;
uniform float uGrainSize;
uniform float uChroma;
uniform vec3 uHazeColor;
uniform vec3 uBgTop;
uniform vec3 uBgBottom;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform vec2 uGlowPos;
uniform int uTaps;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Soft undulation plus a finer ripple: the uneven surface of frosted glass.
vec2 frost(vec2 p) {
  vec2 q = p * uWarpScale + vec2(uTime * 0.02, -uTime * 0.015);
  vec2 d = vec2(vnoise(q), vnoise(q + 17.3)) - 0.5;
  vec2 q2 = p * uWarpScale * 7.0;
  d += (vec2(vnoise(q2), vnoise(q2 + 5.1)) - 0.5) * 0.35;
  return d;
}

// Vogel-disc blur; a per-pixel rotation trades banding for noise, which the grain hides.
vec4 blurLayer(sampler2D tex, vec2 uv, float radius, float rot) {
  if (radius < 0.0004) return texture(tex, uv);
  vec2 scale = vec2(radius / uAspect, radius);
  vec4 acc = vec4(0.0);
  float n = float(uTaps);
  for (int i = 0; i < 48; i++) {
    if (i >= uTaps) break;
    float r = sqrt((float(i) + 0.5) / n);
    float a = float(i) * 2.39996323 + rot;
    acc += texture(tex, uv + vec2(cos(a), sin(a)) * r * scale);
  }
  return acc / n;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uAspect, uv.y);

  vec2 suv = uv + frost(p) * uWarp * 0.02 / vec2(uAspect, 1.0);
  suv += (hash22(gl_FragCoord.xy) - 0.5) * uMicro * 0.0015;

  float rot = hash12(gl_FragCoord.xy) * 6.2831853;

  vec3 col = mix(uBgBottom, uBgTop, smoothstep(0.0, 1.0, uv.y));
  float glow = 1.0 - smoothstep(0.0, 1.15, length(p - vec2(uGlowPos.x * uAspect, uGlowPos.y)));
  col = mix(col, uGlowColor, glow * glow * uGlow);

  vec4 L = blurLayer(uFar, suv, uBlur.x, rot);
  col = col * (1.0 - L.a) + L.rgb;
  col = mix(col, uHazeColor, uFog);                       // air between the layers

  L = blurLayer(uMid, suv, uBlur.y, rot);
  col = col * (1.0 - L.a) + L.rgb;
  col = mix(col, uHazeColor, uFog * 0.5);

  L = blurLayer(uNear, suv, uBlur.z, rot);
  col = col * (1.0 - L.a) + L.rgb;

  col = mix(col, uHazeColor, uHaze);                      // the milk of the glass
  col = (col - 0.9) * uContrast + 0.9;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, uSat);

  // Film grain, fixed to the glass: the same pattern every frame.
  vec2 cell = floor(gl_FragCoord.xy / uGrainSize);
  float g = hash12(cell) + hash12(cell + 7.7) - 1.0;
  vec3 tint = vec3(hash12(cell + 3.1), hash12(cell + 5.3), hash12(cell + 9.7)) - 0.5;
  float weight = 0.6 + 0.4 * (1.0 - luma);
  col += (vec3(g) + tint * uChroma) * uGrain * 0.1 * weight;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// ------------------------------------------------------------------ foliage

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const rad = (d) => (d * Math.PI) / 180;

// Stems grow in from the left and bottom edges and fan up across the glass. Each leaf is
// 12 floats (the leaf shader's `aA`, `aB`, `aC`); each stem is 8 (the stem shader's `aA`, `aB`).
function growLayer(rand, aspect, stems, leavesPer, leafLength) {
  const data = new Float32Array(stems * leavesPer * LEAF_STRIDE);
  const stemData = new Float32Array(stems * STEM_STRIDE);
  let o = 0;
  const reach = 0.85 * Math.max(1, aspect * 0.75);

  for (let st = 0; st < stems; st++) {
    const fromLeft = rand() < 0.55;
    const root = fromLeft ? [-0.05, 0.05 + rand() * 0.7] : [rand() * aspect * 0.65, -0.05];
    const heading = rad(fromLeft ? 8 + rand() * 50 : 50 + rand() * 50);
    const length = reach * (0.7 + rand() * 0.6);
    const bend = (rand() - 0.5) * 0.5;
    const phase = rand();
    const dx = Math.cos(heading);
    const dy = Math.sin(heading);
    stemData.set([root[0], root[1], heading, length, bend, phase, leafLength * 0.03, rand()], st * STEM_STRIDE);

    for (let k = 0; k < leavesPer; k++) {
      const s = Math.min(0.2 + (0.8 * (k + rand() * 0.5)) / leavesPer, 1);
      const px = root[0] + dx * length * s - dy * bend * length * s * s;
      const py = root[1] + dy * length * s + dx * bend * length * s * s;
      const tangent = heading + Math.atan(2 * bend * s);
      const tip = k === leavesPer - 1;
      const side = k % 2 ? 1 : -1;
      const spread = rad(30 + rand() * 30) * (1 - 0.35 * s);
      const len = leafLength * (1.1 - 0.5 * s) * (0.8 + rand() * 0.4);

      data[o++] = px;
      data[o++] = py;
      data[o++] = tip ? tangent : tangent + side * spread + rad((rand() - 0.5) * 12);
      data[o++] = len;
      data[o++] = len * (0.075 + rand() * 0.025); // half width
      data[o++] = phase;
      data[o++] = s;
      data[o++] = rand();
      data[o++] = heading;
      data[o++] = rand();
      data[o++] = (rand() - 0.5) * 0.6; // curl
      data[o++] = 0;
    }
  }
  return { leaves: data, stems: stemData };
}

// One leaf: (LEAF_ROWS) rows of three vertices (left edge, midrib, right edge).
function leafMesh() {
  const verts = [];
  const indices = [];
  for (let r = 0; r < LEAF_ROWS; r++) {
    const t = r / (LEAF_ROWS - 1);
    verts.push(t, -1, t, 0, t, 1);
    if (r === 0) continue;
    const a = (r - 1) * 3;
    const b = r * 3;
    indices.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
  }
  return { verts: new Float32Array(verts), indices: new Uint16Array(indices) };
}

// One stem: a ribbon of STEM_ROWS rows, two vertices each.
function stemMesh() {
  const verts = [];
  const indices = [];
  for (let r = 0; r < STEM_ROWS; r++) {
    const u = r / (STEM_ROWS - 1);
    verts.push(u, -1, u, 1);
    if (r === 0) continue;
    const a = (r - 1) * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { verts: new Float32Array(verts), indices: new Uint16Array(indices) };
}

const hexToRgb = (hex, fallback) => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// ------------------------------------------------------------------- renderer

// `getValues()` returns the live control values (see frostConfig.js). Returns `destroy()`.
export function createFrost(canvas, getValues, { lite = false, onReady } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) {
    onReady?.();
    return () => {};
  }

  const compile = (type, src) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const link = (vert, frag) => {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(program));
    return program;
  };
  const uniforms = (program, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));

  const leafProgram = link(LEAF_VERT, LEAF_FRAG);
  const stemProgram = link(STEM_VERT, LEAF_FRAG);
  const glassProgram = link(GLASS_VERT, GLASS_FRAG);
  const leafU = uniforms(leafProgram, ['uTime', 'uAspect', 'uSway', 'uFlutter', 'uLeafScale', 'uLeafWidth', 'uColor', 'uOpacity']);
  const stemU = uniforms(stemProgram, ['uTime', 'uAspect', 'uSway', 'uStemWidth', 'uColor', 'uOpacity']);
  const glassU = uniforms(glassProgram, [
    'uFar', 'uMid', 'uNear', 'uRes', 'uAspect', 'uTime', 'uBlur', 'uWarp', 'uWarpScale', 'uMicro',
    'uHaze', 'uFog', 'uContrast', 'uSat', 'uGrain', 'uGrainSize', 'uChroma', 'uHazeColor', 'uBgTop', 'uBgBottom',
    'uGlowColor', 'uGlow', 'uGlowPos', 'uTaps',
  ]);

  // Shared leaf mesh, plus one instance buffer / VAO per depth layer.
  const mesh = leafMesh();
  const meshBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

  const ribbon = stemMesh();
  const ribbonBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, ribbon.verts, gl.STATIC_DRAW);
  const ribbonIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ribbonIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ribbon.indices, gl.STATIC_DRAW);

  const layers = LAYERS.map(() => {
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    const stemVao = gl.createVertexArray();
    const stemBuffer = gl.createBuffer();
    gl.bindVertexArray(stemVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, stemBuffer);
    for (let i = 0; i < 2; i++) {
      gl.enableVertexAttribArray(i + 1);
      gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, STEM_STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(i + 1, 1);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ribbonIndexBuffer);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i + 1);
      gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, LEAF_STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(i + 1, 1);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);
    return { vao, buffer, stemVao, stemBuffer, count: 0, stemCount: 0, texture: gl.createTexture(), fbo: gl.createFramebuffer() };
  });
  const emptyVao = gl.createVertexArray();

  let grown = '';
  const grow = (plants, aspect) => {
    const key = [plants.seed, plants.stemsFar, plants.stemsMid, plants.stemsNear, plants.leavesPerStem, aspect.toFixed(1)].join('|');
    if (key === grown) return;
    grown = key;
    const rand = mulberry32(plants.seed * 7919);
    const stems = [plants.stemsFar, plants.stemsMid, plants.stemsNear];
    layers.forEach((layer, i) => {
      const grownLayer = growLayer(rand, aspect, stems[i], plants.leavesPerStem, LEAF_LENGTH[i]);
      layer.count = grownLayer.leaves.length / LEAF_STRIDE;
      layer.stemCount = grownLayer.stems.length / STEM_STRIDE;
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, grownLayer.leaves, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.stemBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, grownLayer.stems, gl.STATIC_DRAW);
    });
  };

  // Layer textures are smaller than the canvas (they get blurred anyway).
  let width = 0;
  let height = 0;
  let layerW = 0;
  let layerH = 0;
  const sizeLayers = (w, h) => {
    layerW = w;
    layerH = h;
    layers.forEach((layer) => {
      gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layer.texture, 0);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const resize = (v) => {
    const q = v.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, q.pixelRatio, lite ? 1.25 : 2);
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    const scale = Math.min(q.renderScale, lite ? 0.5 : 1);
    const lw = Math.max(2, Math.round(w * scale));
    const lh = Math.max(2, Math.round(h * scale));
    if (w !== width || h !== height) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    }
    if (lw !== layerW || lh !== layerH) sizeLayers(lw, lh);
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let time = Math.random() * 100;
  let announced = false;

  const frame = (dt) => {
    const v = getValues();
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    resize(v);
    grow(v.plants, aspect);

    if (v.motion.playing) time += dt * v.motion.windSpeed * (reduceMotion.matches ? 0.3 : 1);

    // Pass 1: the three foliage layers.
    const p = v.plants;
    const colors = [
      hexToRgb(p.colorFar, [0.64, 0.8, 0.67]),
      hexToRgb(p.colorMid, [0.47, 0.68, 0.53]),
      hexToRgb(p.colorNear, [0.31, 0.56, 0.41]),
    ];
    const opacity = [p.opacityFar, p.opacityMid, p.opacityNear];
    gl.viewport(0, 0, layerW, layerH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    layers.forEach((layer, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(stemProgram);
      gl.uniform1f(stemU.uTime, time);
      gl.uniform1f(stemU.uAspect, aspect);
      gl.uniform1f(stemU.uSway, v.motion.sway);
      gl.uniform1f(stemU.uStemWidth, p.stemWidth);
      gl.uniform3fv(stemU.uColor, colors[i]);
      gl.uniform1f(stemU.uOpacity, opacity[i]);
      gl.bindVertexArray(layer.stemVao);
      gl.drawElementsInstanced(gl.TRIANGLES, ribbon.indices.length, gl.UNSIGNED_SHORT, 0, layer.stemCount);

      gl.useProgram(leafProgram);
      gl.uniform1f(leafU.uTime, time);
      gl.uniform1f(leafU.uAspect, aspect);
      gl.uniform1f(leafU.uSway, v.motion.sway);
      gl.uniform1f(leafU.uFlutter, v.motion.flutter);
      gl.uniform1f(leafU.uLeafScale, p.leafSize);
      gl.uniform1f(leafU.uLeafWidth, p.leafWidth);
      gl.uniform3fv(leafU.uColor, colors[i]);
      gl.uniform1f(leafU.uOpacity, opacity[i]);
      gl.bindVertexArray(layer.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0, layer.count);
    });

    // Pass 2: the glass.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, width, height);
    gl.useProgram(glassProgram);
    layers.forEach((layer, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    });
    gl.uniform1i(glassU.uFar, 0);
    gl.uniform1i(glassU.uMid, 1);
    gl.uniform1i(glassU.uNear, 2);
    gl.uniform2f(glassU.uRes, width, height);
    gl.uniform1f(glassU.uAspect, aspect);
    gl.uniform1f(glassU.uTime, time);
    gl.uniform3f(glassU.uBlur, v.glass.blurFar, v.glass.blurMid, v.glass.blurNear);
    gl.uniform1f(glassU.uWarp, v.glass.frostWarp);
    gl.uniform1f(glassU.uWarpScale, v.glass.warpScale);
    gl.uniform1f(glassU.uMicro, v.glass.microFrost);
    gl.uniform1f(glassU.uHaze, v.haze.milk);
    gl.uniform1f(glassU.uFog, v.haze.layerFog);
    gl.uniform1f(glassU.uContrast, v.haze.contrast);
    gl.uniform1f(glassU.uSat, v.haze.saturation);
    gl.uniform3fv(glassU.uHazeColor, hexToRgb(v.haze.color, [0.95, 0.97, 0.94]));
    gl.uniform1f(glassU.uGrain, v.grain.amount);
    gl.uniform1f(glassU.uGrainSize, v.grain.size);
    gl.uniform1f(glassU.uChroma, v.grain.chroma);
    gl.uniform3fv(glassU.uBgTop, hexToRgb(v.backdrop.top, [0.97, 0.98, 0.96]));
    gl.uniform3fv(glassU.uBgBottom, hexToRgb(v.backdrop.bottom, [0.91, 0.94, 0.9]));
    gl.uniform3fv(glassU.uGlowColor, hexToRgb(v.backdrop.glowColor, [0.66, 0.8, 0.69]));
    gl.uniform1f(glassU.uGlow, v.backdrop.glowStrength);
    gl.uniform2f(glassU.uGlowPos, v.backdrop.glowX, v.backdrop.glowY);
    gl.uniform1i(glassU.uTaps, Math.min(v.quality.blurTaps, lite ? 16 : 48));
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!announced) {
      announced = true;
      onReady?.();
    }
  };

  const onContextLost = (e) => e.preventDefault();
  canvas.addEventListener('webglcontextlost', onContextLost);

  const stop = createFrameLoop(canvas, frame);

  return () => {
    stop();
    canvas.removeEventListener('webglcontextlost', onContextLost);
  };
}
