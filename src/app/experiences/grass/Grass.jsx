"use client";

import { useEffect, useRef, useState } from "react";
import { createFrameLoop } from "@/lib/frame-loop";

// Instanced-blade grass in raw WebGL2. Every blade is the same 8-segment
// triangle strip; per-instance attributes place it on a height field, shape it
// and drive its wind response entirely in the vertex shader.

const FIELD = { minX: -9, minZ: -10, sizeX: 18, sizeZ: 18 };
const SEGMENTS = 8;

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aBlade;   // x: side (-1|1), y: t along blade (0..1)
layout(location=1) in vec3 aRoot;    // root position (xz on the ground plane)
layout(location=2) in vec4 aShape;   // height, half width, lean direction, side direction
layout(location=3) in vec3 aMotion;  // clump phase, shade, lean amount
uniform mat4 uVP;
uniform float uTime;
uniform float uWind;
uniform float uRelief;
uniform float uLength;
uniform vec4 uField;                 // minX, minZ, sizeX, sizeZ
uniform sampler2D uTerrain;
out vec3 vNormal;
out vec3 vWorld;
out float vT;
out float vShade;
out float vGust;

float terrain(vec2 xz) {
  vec2 uv = clamp((xz - uField.xy) / uField.zw, 0.0, 1.0);
  return smoothstep(0.2, 0.8, textureLod(uTerrain, uv, 2.0).r);
}

void main() {
  float side = aBlade.x;
  float t = aBlade.y;
  float H = aShape.x * uLength;

  // Ground height and slope from the height field.
  float level = terrain(aRoot.xz);
  float e = 0.25;
  vec2 grad = vec2(terrain(aRoot.xz + vec2(e, 0.0)) - level,
                   terrain(aRoot.xz + vec2(0.0, e)) - level) * uRelief / e;
  vec3 groundNormal = normalize(vec3(-grad.x, 1.0, -grad.y));

  // Wind: gust fronts sweep across the field. Each clump lags a little so the
  // front breaks up instead of moving as one hard line.
  vec2 windDir = normalize(vec2(0.78, 0.63));
  vec2 crossDir = vec2(-windDir.y, windDir.x);
  float along = dot(aRoot.xz, windDir);
  float across = dot(aRoot.xz, crossDir);
  float lag = sin(aMotion.x * 1.37) * 0.5;
  float phase = fract((along - uTime + lag) / 16.0);
  float frontDist = min(phase, 1.0 - phase) * 16.0;
  float front = 1.0 - smoothstep(0.7, 3.0, frontDist);
  float region = 0.2 + 0.8 * pow(sin(across * 0.3 - uTime * 0.2) * 0.5 + 0.5, 1.6);
  float gust = front * region;
  float breath = sin(uTime * 0.9 + aMotion.x) * 0.5 + 0.5;
  float flutter = sin(uTime * 5.0 + aMotion.x * 3.1 + t * 3.0) * 0.006;
  float wind = clamp((0.10 + gust * 0.50 + breath * 0.10) * uWind, 0.0, 2.0);

  float lean = aMotion.z;
  float arch = pow(t, 1.4);
  float curve = t * t;
  float taper = pow(max(1.0 - t, 0.0), 0.66);
  vec2 radial = vec2(cos(aShape.z), sin(aShape.z));
  vec2 bladeSide = vec2(cos(aShape.w), sin(aShape.w));
  vec2 bendDir = normalize(radial * 1.3 + windDir * wind * 0.8);

  float reach = H * (0.05 * t + lean * 0.65 * arch) + H * wind * 0.30 * curve;
  float lift = max(0.02, 1.0 - lean * 0.6 * arch - wind * 0.5 * curve);

  vec3 world = aRoot;
  world.y += (level - 0.5) * uRelief;
  world.xz += groundNormal.xz * H * t * 0.25;   // grow out of the slope
  world.xz += bendDir * reach;
  world.xz += vec2(-bendDir.y, bendDir.x) * flutter * H * curve;
  world.y += H * t * lift * groundNormal.y;
  world.xz += bladeSide * side * aShape.y * taper;

  float s = lean * 0.9 * arch + wind * 0.6 * curve;
  vec3 tangent = normalize(vec3(bendDir.x * s, max(0.05, 1.0 - s * 0.8), bendDir.y * s));
  vNormal = normalize(cross(vec3(bladeSide.x, 0.0, bladeSide.y), tangent));
  vWorld = world;
  vT = t;
  vShade = aMotion.y;
  vGust = gust;
  gl_Position = uVP * vec4(world, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in float vT;
in float vShade;
in float vGust;
uniform vec3 uCamera;
out vec4 outColor;

void main() {
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  vec3 sun = normalize(vec3(-0.54, 0.78, 0.32));
  vec3 view = normalize(uCamera - vWorld);
  float direct = max(dot(n, sun), 0.0);
  float through = pow(max(dot(-n, sun), 0.0), 1.2);        // light through the blade
  float spec = pow(max(dot(n, normalize(sun + view)), 0.0), 28.0);
  float rim = pow(1.0 - abs(dot(n, view)), 6.0);

  vec3 root = vec3(0.07, 0.13, 0.07);
  vec3 cool = vec3(0.22, 0.29, 0.22);
  vec3 green = vec3(0.43, 0.52, 0.26);
  vec3 fresh = vec3(0.58, 0.65, 0.25);
  vec3 olive = vec3(0.48, 0.54, 0.26);
  vec3 straw = vec3(0.76, 0.75, 0.52);
  vec3 pale = vec3(0.85, 0.89, 0.71);

  float s = vShade;
  vec3 c = s < 0.15 ? cool : s < 0.40 ? green : s < 0.62 ? fresh : s < 0.84 ? olive : straw;
  c *= mix(0.85, 1.12, fract(s * 7.31));

  c = mix(root, c, smoothstep(0.05, 0.45, vT));               // dark at the root
  c = mix(c, pale, smoothstep(0.5, 0.95, direct) * smoothstep(0.45, 1.0, vT) * 0.25);
  c *= 0.70 + direct * 0.72 + through * 0.18;
  c += pale * rim * (0.08 + vT * 0.18);
  c += vec3(0.96, 0.98, 0.91) * spec * (0.9 + vGust * 0.4) * smoothstep(0.2, 1.0, vT);
  c = max(c, vec3(0.0, 0.118, 0.031));
  outColor = vec4(min(c, vec3(0.96)), 1.0);
}`;

// ---- small math / random helpers -------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function lookAt(eye, target) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => {
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}

function compile(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function makeProgram(gl) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

// ---- terrain: fractal value noise baked into a one-channel texture ---------

function makeTerrainTexture(gl, size = 256) {
  const rand = rng(7);
  const lattice = new Float32Array(64 * 64).map(() => rand());
  const at = (x, y) => lattice[(y & 63) * 64 + (x & 63)];
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      const h = noise(nx * 4, ny * 4) * 0.6 + noise(nx * 9 + 3, ny * 9) * 0.28 + noise(nx * 20, ny * 20 + 5) * 0.12;
      data[y * size + x] = Math.max(0, Math.min(255, h * 255));
    }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// ---- blade instances --------------------------------------------------------
// Layout per instance (10 floats): root xyz | height, halfWidth, lean dir, side dir | clump phase, shade, lean

function makeLayer(gl, { count, tufts, height, width, spread, lean }) {
  const rand = rng(count);
  const clumps = [];
  const cols = Math.ceil(Math.sqrt(tufts * (FIELD.sizeX / FIELD.sizeZ)));
  const rows = Math.ceil(tufts / cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      clumps.push({
        x: FIELD.minX + ((c + 0.15 + rand() * 0.7) / cols) * FIELD.sizeX,
        z: FIELD.minZ + ((r + 0.15 + rand() * 0.7) / rows) * FIELD.sizeZ,
        phase: rand() * Math.PI * 2,
        tone: rand(),
        size: 0.7 + rand() * 0.6,
      });

  const data = new Float32Array(count * 10);
  for (let i = 0; i < count; i++) {
    const k = clumps[Math.floor(rand() * clumps.length)];
    const angle = rand() * Math.PI * 2;
    const dist = Math.pow(rand(), 0.8) * spread * k.size;
    const x = k.x + Math.cos(angle) * dist;
    const z = k.z + Math.sin(angle) * dist;
    const away = Math.atan2(z - k.z, x - k.x) + (rand() - 0.5) * 0.6; // blades arch away from the tuft centre
    const edge = Math.min(1, dist / (spread * k.size));
    const shade = Math.max(0.05, Math.min(0.98, k.tone * 0.6 + rand() * 0.4));
    const o = i * 10;
    data[o] = x;
    data[o + 1] = 0.01;
    data[o + 2] = z;
    data[o + 3] = height * (0.7 + rand() * 0.6) * (1 - edge * 0.25);
    data[o + 4] = width * (0.8 + rand() * 0.5);
    data[o + 5] = away;
    data[o + 6] = away + Math.PI / 2 + (rand() - 0.5) * 0.5;
    data[o + 7] = k.phase;
    data[o + 8] = shade;
    data[o + 9] = Math.min(0.98, lean * (0.35 + edge * 0.65) + rand() * 0.2);
  }

  const bladeVerts = new Float32Array((SEGMENTS + 1) * 4);
  for (let s = 0; s <= SEGMENTS; s++) bladeVerts.set([-1, s / SEGMENTS, 1, s / SEGMENTS], s * 4);

  const vao = gl.createVertexArray();
  const bladeBuf = gl.createBuffer();
  const instBuf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, bladeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, bladeVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = 40;
  [[1, 3, 0], [2, 4, 12], [3, 3, 28]].forEach(([loc, size, offset]) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(loc, 1);
  });
  gl.bindVertexArray(null);
  return { vao, bladeBuf, instBuf, count, vertices: (SEGMENTS + 1) * 2 };
}

// ---- component --------------------------------------------------------------

export default function Grass() {
  const canvasRef = useRef(null);
  const params = useRef({ wind: 1, relief: 1.6 });
  const [wind, setWind] = useState(1);
  const [relief, setRelief] = useState(1.6);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    params.current = { wind, relief };
  }, [wind, relief]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
    if (!gl) {
      setFailed(true);
      return undefined;
    }

    const small = matchMedia("(max-width: 700px)").matches;
    let program, tall, carpet, terrain;
    try {
      program = makeProgram(gl);
    } catch (err) {
      console.error(err);
      setFailed(true);
      return undefined;
    }
    terrain = makeTerrainTexture(gl);
    tall = makeLayer(gl, { count: small ? 70000 : 130000, tufts: 420, height: 2.3, width: 0.011, spread: 0.9, lean: 0.8 });
    carpet = makeLayer(gl, { count: small ? 90000 : 180000, tufts: 3000, height: 0.8, width: 0.007, spread: 0.45, lean: 0.6 });

    const loc = (n) => gl.getUniformLocation(program, n);
    const u = {
      vp: loc("uVP"), time: loc("uTime"), wind: loc("uWind"), relief: loc("uRelief"),
      length: loc("uLength"), field: loc("uField"), terrain: loc("uTerrain"), camera: loc("uCamera"),
    };

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    canvas.addEventListener("pointermove", onMove);

    let time = 0;

    const frame = (dt) => {
      const p = params.current;
      time += dt * (0.5 + p.wind * 0.6);

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);

      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      const eye = [pointer.x * 1.6, 6.2 - pointer.y * 0.8, 7.5];
      const view = lookAt(eye, [0, 0.2, -2.2]);
      const vp = multiply(perspective(0.74, w / h, 0.1, 80), view);

      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0.118, 0.031, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, terrain);
      gl.uniform1i(u.terrain, 0);
      gl.uniformMatrix4fv(u.vp, false, vp);
      gl.uniform1f(u.time, time);
      gl.uniform1f(u.wind, p.wind);
      gl.uniform1f(u.relief, p.relief);
      gl.uniform4f(u.field, FIELD.minX, FIELD.minZ, FIELD.sizeX, FIELD.sizeZ);
      gl.uniform3fv(u.camera, eye);

      for (const layer of [carpet, tall]) {
        gl.uniform1f(u.length, 1);
        gl.bindVertexArray(layer.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, layer.vertices, layer.count);
      }
    };

    const stopLoop = createFrameLoop(canvas, frame);

    return () => {
      stopLoop();
      canvas.removeEventListener("pointermove", onMove);
      [tall, carpet].forEach((l) => {
        gl.deleteBuffer(l.bladeBuf);
        gl.deleteBuffer(l.instBuf);
        gl.deleteVertexArray(l.vao);
      });
      gl.deleteTexture(terrain);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <div className="absolute inset-0 bg-[#001e08]">
      <canvas ref={canvasRef} className="h-full w-full touch-none" />
      {failed && (
        <p className="absolute inset-0 grid place-items-center text-sm text-white/70">WebGL2 is not available in this browser.</p>
      )}
      <div className="absolute bottom-28 left-1/2 flex -translate-x-1/2 gap-5 rounded-full bg-white/85 px-5 py-3 text-xs text-slate-700 shadow-lg backdrop-blur">
        <label className="flex items-center gap-2">
          Wind
          <input type="range" min="0.2" max="3" step="0.05" value={wind} onChange={(e) => setWind(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          Relief
          <input type="range" min="0" max="4" step="0.05" value={relief} onChange={(e) => setRelief(+e.target.value)} />
        </label>
      </div>
    </div>
  );
}
