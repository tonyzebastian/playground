import { createFrameLoop } from '@/lib/frame-loop';
import { SEA_COLORS } from './seaConfig';

// Dark, glossy water at dusk through a long lens, in raw WebGL2. There is no sky in frame:
// every light in the picture is the sky mirrored by a moving surface.
//
// 1. Water (HDR): a ray from a low camera is marched onto the long waves, so crests hide
//    the troughs behind them. At the hit, the slope of every wave (the list from buildWaves)
//    is summed, and the view ray is mirrored into a dark sky with one narrow band of light on
//    the horizon. Only the few slopes that catch that band light up, as thin bright lines.
//    Waves too fine for a pixel are faded out and turned into blur on the sun instead.
// 2. Lens: everything off the focus distance is spread over a disc (far glints become bokeh).
// 3. Glow: the brightest pixels are blurred.
// 4. Finish: glow added, tone mapping, contrast, vignette and film grain.

const MAX_WAVES = 40;
const GRAVITY = 9.81;
// Surface tension over density: makes the smallest ripples run faster than gravity alone.
const CAPILLARY = 7.4e-5;
// Metres of water under the waves: this is a few steps out from the beach.
const DEPTH = 0.3;

const FULLSCREEN_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const HASH = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const WATER_FRAG = `#version 300 es
precision highp float;
#define MAX_WAVES ${MAX_WAVES}

uniform vec2 uRes;
uniform float uStore;
uniform float uDepthStore;
uniform float uCamHeight;
uniform mat3 uCamRot;       // columns: right, up, forward
uniform float uTanHalfFov;  // vertical
uniform float uPixelAngle;  // radians one pixel covers
uniform int uWaveCount;
uniform int uLowCount;      // the first waves are the long ones that shape the surface
uniform int uSteps;
uniform vec4 uWaveA[MAX_WAVES]; // wave vector x, z (rad/m), phase now, slope
uniform vec4 uWaveB[MAX_WAVES]; // amplitude (m), lean, how much it follows the ruffled patches, the wave groups
uniform vec4 uWarp[3];          // wave vector x, z, phase now, sideways push (m)
uniform vec2 uDrift;
uniform float uMaxHeight;
uniform float uMaxSlope;
uniform vec3 uSunDir;
uniform float uSunSize;
uniform float uSunStrength;
uniform float uBand;
uniform vec3 uHorizon, uLow, uMid, uHigh, uZenith, uSun, uSunHalo, uDeep, uScatter;

out vec4 outColor;
${HASH}

// Slow sideways pushes that bend every crest, so no wave runs straight. 'pull' keeps what is
// needed to correct slopes afterwards: for each push, its direction and strength here.
vec2 bend(vec2 p, out vec3 pull[3]) {
  vec2 moved = p;
  for (int j = 0; j < 3; j++) {
    vec4 w = uWarp[j];
    vec2 dir = normalize(vec2(-w.y, w.x));
    float ph = dot(w.xy, p) + w.z;
    moved += dir * (w.w * sin(ph));
    pull[j] = vec3(dir, w.w * cos(ph));
  }
  return moved;
}

// A wave leans forward by its own amount: steep front, long back.
float lowHeight(vec2 p) {
  vec3 pull[3];
  vec2 q = bend(p, pull);
  float h = 0.0;
  for (int i = 0; i < uLowCount; i++) {
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float ph = dot(a.xy, q) + a.z;
    h += b.x * sin(ph - b.y * cos(ph));
  }
  return h;
}

// The sky the water mirrors: dark above, with one narrow band of light along the horizon,
// strongest under the sun. A narrow band is why the reflections come out as thin lines.
// 'rough' is extra blur on the sun from waves too small to draw.
vec3 sky(vec3 d, float rough) {
  float e = max(d.y, 0.0);
  vec3 col = mix(uMid, uHigh, smoothstep(0.16, 0.5, e));
  col = mix(col, uZenith, smoothstep(0.45, 1.0, e));
  col = mix(col, uLow, (1.0 - smoothstep(0.03, 0.2, e)) * 0.35);

  float side = atan(d.x, d.z) - atan(uSunDir.x, uSunDir.z);
  float under = exp(-side * side / 0.012);
  float streak = 0.55 + 0.9 * vnoise(vec2(side * 9.0 + 3.0, e * 26.0));
  col += uHorizon * uBand * exp(-e / 0.028) * (0.4 + 1.3 * under) * streak;

  float ang2 = 2.0 * (1.0 - dot(d, uSunDir));
  float s0 = uSunSize * uSunSize;
  float s2 = s0 + rough;
  col += uSun * uSunStrength * 40.0 * exp(-ang2 / (2.0 * s2)) * pow(s0 / s2, 0.9);
  col += uSunHalo * uSunStrength * 0.2 * exp(-sqrt(ang2) / 0.06);
  return col;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y);
  vec3 rd = normalize(uCamRot * vec3(ndc * uTanHalfFov, 1.0));
  vec3 ro = vec3(0.0, uCamHeight, 0.0);

  // Above the horizon there is only sky (the default framing never gets here).
  if (rd.y > -0.003) {
    outColor = vec4(sky(rd, 0.0) * uStore, 200.0 * uDepthStore);
    return;
  }

  // March onto the long waves. Each step is as far as the steepest wave face allows.
  float t = (uCamHeight - uMaxHeight) / -rd.y;
  float run = length(rd.xz);
  for (int i = 0; i < uSteps; i++) {
    vec3 p = ro + rd * t;
    t += (p.y - lowHeight(p.xz)) / (-rd.y + uMaxSlope * run);
  }
  vec3 pos = ro + rd * t;
  vec3 pull[3];
  vec2 p = bend(pos.xz, pull);

  // How much water one pixel covers: far more along the view than across it.
  vec2 fwd = rd.xz / run;
  vec2 side = vec2(-fwd.y, fwd.x);
  float across = t * uPixelAngle;
  float along = across / max(-rd.y, 0.03);

  // The sea is not even: wind ruffles it in drifting patches and leaves others glassy,
  // and the middle waves come in groups.
  float ruffle = mix(0.08, 1.7, smoothstep(0.38, 0.72, vnoise(pos.xz * 0.55 + uDrift)));
  float group = mix(0.45, 1.45, vnoise(pos.xz * 0.3 - uDrift * 0.6 + 7.3));

  vec2 grad = vec2(0.0);
  float height = 0.0;
  float lost = 0.0;
  for (int i = 0; i < uWaveCount; i++) {
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float size = mix(1.0, ruffle, b.z) * mix(1.0, group, b.w);
    // Radians of this wave inside one pixel. Past a few, it can no longer be drawn. The limit is
    // loose on purpose: far waves that half-resolve sparkle, and the lens turns sparkle into bokeh.
    float perPixel = abs(dot(a.xy, fwd)) * along + abs(dot(a.xy, side)) * across;
    float keep = 1.0 - smoothstep(2.0, 5.0, perPixel);
    lost += (1.0 - keep * keep) * a.w * a.w * size * size * 0.5;
    keep *= size;
    if (keep <= 0.0) continue;
    float ph = dot(a.xy, p) + a.z;
    float c = cos(ph);
    float s = sin(ph);
    float ph2 = ph - b.y * c;
    height += b.x * sin(ph2) * keep;
    grad += a.xy * (b.x * cos(ph2) * (1.0 + b.y * s) * keep);
  }
  // Slopes were measured on the bent surface: carry them back to the real one.
  vec2 bent = grad;
  for (int j = 0; j < 3; j++) grad += uWarp[j].xy * (pull[j].z * dot(pull[j].xy, bent));

  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 v = -rd;
  // A face turned away from the camera cannot be seen: pull it back to edge-on.
  float facing = dot(n, v);
  if (facing < 0.02) n = normalize(n + v * (0.02 - facing));
  facing = max(dot(n, v), 0.0);

  vec3 r = reflect(rd, n);
  // A mirrored ray heading down would hit the next wave: bounce it up, dimmer.
  float sunk = smoothstep(0.0, -0.08, r.y);
  r.y = abs(r.y);
  // Unseen ripples tip the average mirror up a little and blur what it shows.
  float rough = 2.0 * lost;
  r = normalize(r + vec3(0.0, sqrt(lost) * 0.6, 0.0));

  vec3 reflected = sky(r, rough) * mix(1.0, 0.5, sunk);

  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  fresnel = mix(fresnel, 0.55, clamp(sqrt(lost) * 2.5, 0.0, 0.6));

  // The water body: nearly black, with a trace of light scattered back through the crests.
  vec3 body = uDeep + uScatter * clamp(height * 8.0 + 0.1, 0.0, 1.0) * 0.05;

  vec3 col = mix(body, reflected, fresnel);
  // Alpha carries the distance, for the lens blur.
  outColor = vec4(col * uStore, min(t, 200.0) * uDepthStore);
}
`;

// The long lens: only one distance is sharp. Everything nearer or farther is spread over a
// disc, which is what turns far sun glints into soft round lights.
const LENS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uDepthLoad;
uniform float uFocus;
uniform float uAperture;  // pixels of blur per (1 / metre) off focus
uniform float uMaxBlur;
uniform int uTaps;
out vec4 outColor;
${HASH}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 here = texture(uScene, uv);
  float off = 1.0 / uFocus - 1.0 / max(here.a * uDepthLoad, 0.05);
  // The foreground blurs less than the distance, as it does when focus sits near the front.
  float radius = min(abs(off) * (off < 0.0 ? 0.45 : 1.0) * uAperture, uMaxBlur);
  if (radius < 0.6) {
    outColor = vec4(here.rgb, 1.0);
    return;
  }
  // A spiral of samples filling the disc, turned a little per pixel so it reads as grain, not rings.
  float turn = hash12(gl_FragCoord.xy) * 6.2832;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < uTaps; i++) {
    float f = (float(i) + 0.5) / float(uTaps);
    float a = float(i) * 2.39996 + turn;
    sum += texture(uScene, uv + vec2(cos(a), sin(a)) * sqrt(f) * radius / uRes).rgb;
  }
  outColor = vec4(sum / float(uTaps), 1.0);
}
`;

// Keeps only what is brighter than white, at quarter size.
const BRIGHT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uLoad;
uniform float uStore;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = 1.0 / uRes;
  vec3 sum = vec3(0.0);
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec3 c = texture(uScene, uv + (vec2(float(x), float(y)) - 0.5) * px * 0.5).rgb * uLoad;
      // Brightest channel, not brightness: a red glint is dim to the eye but still glows.
      sum += c * smoothstep(1.0, 3.0, max(c.r, max(c.g, c.b)));
    }
  }
  outColor = vec4(sum * 0.25 * uStore, 1.0);
}
`;

const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uStep;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSource, 0));
  vec3 sum = texture(uSource, uv).rgb * 0.227;
  sum += (texture(uSource, uv + uStep * 1.385).rgb + texture(uSource, uv - uStep * 1.385).rgb) * 0.316;
  sum += (texture(uSource, uv + uStep * 3.231).rgb + texture(uSource, uv - uStep * 3.231).rgb) * 0.0703;
  outColor = vec4(sum, 1.0);
}
`;

const FINISH_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uLoad;
uniform float uExposure;
uniform float uGlow;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uGrainSize;
uniform float uSeed;
out vec4 outColor;
${HASH}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = texture(uScene, uv).rgb * uLoad;
  vec3 bloom = texture(uBloom, uv).rgb + textureLod(uBloom, uv, 2.0).rgb * 0.7;
  col += bloom * uLoad * uGlow * 0.35;
  col *= uExposure * 1.5;

  // Tone map half by the brightest channel (keeps the orange in the lines) and half per
  // channel (lets the hottest glints bleach toward white, as film does).
  float peak = max(max(col.r, max(col.g, col.b)), 1e-4);
  vec3 kept = col * (aces(vec3(peak)).x / peak);
  col = mix(aces(col), kept, 0.5);

  col = pow(col, vec3(1.0 / 2.2));
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  vec2 off = uv - 0.5;
  col *= 1.0 - uVignette * dot(off, off) * 1.6;

  vec2 g = floor(gl_FragCoord.xy / uGrainSize);
  float n = hash12(g + uSeed * 61.7) + hash12(g * 1.37 + uSeed * 17.3) - 1.0;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += n * uGrain * 0.035 * (1.0 - 0.6 * lum);

  outColor = vec4(col, 1.0);
}
`;

// sRGB hex to linear light.
const hexToLinear = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
};

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// The sea as a list of plain waves, in families that each behave differently: the swell, a
// second swell crossing it, the middle waves (which come in groups), a crossing set of those,
// and ripples (which only show where wind ruffles the water). Each family has a range of
// wavelengths (m), a heading off the wind and how far its waves stray from it (degrees), how
// steep each wave is, and how far it can lean forward. Longest first: the first `lowCount`
// waves are the ones the ray is marched onto.
function buildWaves(dials, lite) {
  const rand = mulberry32(dials.seed * 7919 + 13);
  const families = [
    { count: 3, from: 3.2, to: 1.6, heading: 0, stray: 14, slope: 0.042 * dials.swell, lean: 0.5 },
    { count: 2, from: 2.3, to: 1.2, heading: 55, stray: 12, slope: 0.026 * dials.swell * dials.crossing, lean: 0.2 },
    { count: lite ? 8 : 12, from: 1.3, to: 0.38, heading: 0, stray: 55, slope: 0.036 * dials.chop, lean: 0.45, group: 1 },
    { count: lite ? 3 : 5, from: 0.95, to: 0.4, heading: -50, stray: 25, slope: 0.024 * dials.chop * dials.crossing, lean: 0.25, group: 0.6 },
    { count: lite ? 6 : 14, from: 0.24, to: lite ? 0.08 : 0.05, heading: 10, stray: 85, slope: 0.017 * dials.ripples, lean: 0, patch: 1 },
  ];
  const lowCount = 8;
  const waves = [];
  for (const family of families) {
    for (let i = 0; i < family.count; i++) {
      const length = family.from * Math.pow(family.to / family.from, (i + rand()) / family.count);
      const k = (2 * Math.PI) / length;
      // Two randoms summed: most waves run close to their heading, a few well off it.
      const stray = (rand() + rand() - 1) * family.stray * dials.spread;
      const angle = ((dials.wind + family.heading + stray) * Math.PI) / 180;
      const slope = family.slope * (0.6 + 0.8 * rand());
      const low = waves.length < lowCount;
      waves.push({
        // Toward the camera, which looks along +z.
        kx: Math.sin(angle) * k,
        kz: -Math.cos(angle) * k,
        // Shallow water slows the long waves; ripples never feel the bottom.
        omega: Math.sqrt((GRAVITY * k + CAPILLARY * k * k * k) * Math.tanh(k * DEPTH)),
        phase: rand() * Math.PI * 2,
        slope,
        amp: slope / k,
        lean: family.lean * rand(),
        patch: family.patch ?? 0,
        // The marched waves keep a fixed size, so the surface the ray hits is the one shaded.
        group: low ? 0 : (family.group ?? 0),
      });
    }
  }
  let maxHeight = 0;
  let maxSlope = 0;
  for (let i = 0; i < lowCount; i++) {
    maxHeight += waves[i].amp;
    maxSlope += waves[i].slope * (1 + waves[i].lean);
  }
  // Three slow sideways pushes, a few metres long, that bend the crests.
  const warps = [5.3, 3.1, 1.9].map((length, i) => {
    const angle = rand() * Math.PI * 2;
    const k = (2 * Math.PI) / length;
    return { kx: Math.cos(angle) * k, kz: Math.sin(angle) * k, phase: rand() * 6.283, speed: 0.11 + 0.07 * i, push: (0.16 * dials.bend * length) / 5.3 };
  });
  return { waves, warps, lowCount, maxHeight, maxSlope: Math.max(maxSlope * 0.85, 0.05) };
}

export function createSea(canvas, getValues, { lite = false, onReady } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) {
    onReady?.();
    return () => {};
  }
  // Float targets keep the sun brighter than white until the end. Without them, values are
  // stored scaled down in 8-bit textures.
  const hdr = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const STORE = hdr ? 1 : 1 / 6;

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

  const waterProgram = link(FULLSCREEN_VERT, WATER_FRAG);
  const lensProgram = link(FULLSCREEN_VERT, LENS_FRAG);
  const brightProgram = link(FULLSCREEN_VERT, BRIGHT_FRAG);
  const blurProgram = link(FULLSCREEN_VERT, BLUR_FRAG);
  const finishProgram = link(FULLSCREEN_VERT, FINISH_FRAG);
  const colorNames = ['uHorizon', 'uLow', 'uMid', 'uHigh', 'uZenith', 'uSun', 'uSunHalo', 'uDeep', 'uScatter'];
  const waterU = uniforms(waterProgram, ['uRes', 'uStore', 'uDepthStore', 'uCamHeight', 'uCamRot', 'uTanHalfFov', 'uPixelAngle', 'uWaveCount', 'uLowCount', 'uSteps', 'uWaveA', 'uWaveB', 'uWarp', 'uDrift', 'uMaxHeight', 'uMaxSlope', 'uSunDir', 'uSunSize', 'uSunStrength', 'uBand', ...colorNames]);
  const lensU = uniforms(lensProgram, ['uScene', 'uRes', 'uDepthLoad', 'uFocus', 'uAperture', 'uMaxBlur', 'uTaps']);
  const brightU = uniforms(brightProgram, ['uScene', 'uRes', 'uLoad', 'uStore']);
  const blurU = uniforms(blurProgram, ['uSource', 'uStep']);
  const finishU = uniforms(finishProgram, ['uScene', 'uBloom', 'uRes', 'uLoad', 'uExposure', 'uGlow', 'uContrast', 'uVignette', 'uGrain', 'uGrainSize', 'uSeed']);

  const vao = gl.createVertexArray();

  const target = ({ mipmaps = false } = {}) => ({ texture: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0, mipmaps });
  const sizeTarget = (t, w, h) => {
    if (t.w === w && t.h === h) return;
    t.w = w;
    t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, t.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (t.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const sceneTarget = target();
  const lensTarget = target();
  const brightTarget = target();
  const blurTarget = target();
  const bloomTarget = target({ mipmaps: true });

  let width = 0;
  let height = 0;
  const resize = (v) => {
    const ratio = Math.min(window.devicePixelRatio || 1, lite ? Math.min(v.quality.pixelRatio, 1.25) : v.quality.pixelRatio);
    const w = Math.max(2, Math.round(canvas.clientWidth * ratio));
    const h = Math.max(2, Math.round(canvas.clientHeight * ratio));
    if (w !== width || h !== height) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    }
    sizeTarget(sceneTarget, w, h);
    sizeTarget(lensTarget, w, h);
    const qw = Math.max(2, w >> 2);
    const qh = Math.max(2, h >> 2);
    sizeTarget(brightTarget, qw, qh);
    sizeTarget(blurTarget, qw, qh);
    sizeTarget(bloomTarget, qw, qh);
  };

  const draw = (t, w, h) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const colors = Object.fromEntries(Object.entries(SEA_COLORS).map(([name, hex]) => [name, hexToLinear(hex)]));
  const colorUniform = (name) => `u${name[0].toUpperCase()}${name.slice(1)}`;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const waveA = new Float32Array(MAX_WAVES * 4);
  const waveB = new Float32Array(MAX_WAVES * 4);
  const warpData = new Float32Array(12);
  // Without float targets, distance is stored as a fraction of 64 m.
  const DEPTH_STORE = hdr ? 1 : 1 / 64;
  const camRot = new Float32Array(9);
  let sea = null;
  let seaKey = '';
  let time = 0;
  let announced = false;

  const frame = (dt) => {
    const v = getValues();
    resize(v);
    time += v.motion.playing ? dt * v.motion.speed * (reduceMotion.matches ? 0.35 : 1) : 0;

    const key = JSON.stringify(v.waves);
    if (key !== seaKey) {
      seaKey = key;
      sea = buildWaves(v.waves, lite);
      sea.waves.forEach((w, i) => {
        waveA.set([w.kx, w.kz, 0, w.slope], i * 4);
        waveB.set([w.amp, w.lean, w.patch, w.group], i * 4);
      });
    }
    // Phases are wrapped here, in double precision, so long sessions never lose smoothness.
    const TAU = Math.PI * 2;
    sea.waves.forEach((w, i) => {
      waveA[i * 4 + 2] = (((w.phase - w.omega * time) % TAU) + TAU) % TAU;
    });
    sea.warps.forEach((w, i) => {
      warpData.set([w.kx, w.kz, (w.phase + w.speed * time) % TAU, w.push], i * 4);
    });

    // Camera: looks along +z and down by `pitch`, with a slow handheld drift.
    const rad = Math.PI / 180;
    const sway = v.lens.sway * (reduceMotion.matches ? 0 : 1);
    const pitch = (v.lens.pitch + sway * (0.1 * Math.sin(time * 0.53) + 0.05 * Math.sin(time * 1.31 + 1.0))) * rad;
    const yaw = sway * (0.12 * Math.sin(time * 0.41 + 2.0) + 0.05 * Math.sin(time * 1.07)) * rad;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // Columns: right, up, forward.
    camRot.set([cy, 0, -sy, sy * sp, cp, cy * sp, sy * cp, -sp, cy * cp]);
    const tanHalf = Math.tan((v.lens.zoom * rad) / 2);

    const sunUp = v.light.sunHeight * rad;
    const sunAz = v.light.sunSide * rad;
    const sunDir = [Math.sin(sunAz) * Math.cos(sunUp), Math.sin(sunUp), Math.cos(sunAz) * Math.cos(sunUp)];

    gl.disable(gl.BLEND);
    gl.bindVertexArray(vao);

    // 1. Water.
    gl.useProgram(waterProgram);
    gl.uniform2f(waterU.uRes, width, height);
    gl.uniform1f(waterU.uStore, STORE);
    gl.uniform1f(waterU.uDepthStore, DEPTH_STORE);
    gl.uniform4fv(waterU.uWarp, warpData);
    gl.uniform2f(waterU.uDrift, (time * 0.05) % 512, (time * -0.085) % 512);
    gl.uniform1f(waterU.uCamHeight, v.lens.height);
    gl.uniformMatrix3fv(waterU.uCamRot, false, camRot);
    gl.uniform1f(waterU.uTanHalfFov, tanHalf);
    gl.uniform1f(waterU.uPixelAngle, (2 * tanHalf) / height);
    gl.uniform1i(waterU.uWaveCount, sea.waves.length);
    gl.uniform1i(waterU.uLowCount, sea.lowCount);
    gl.uniform1i(waterU.uSteps, lite ? 7 : 12);
    gl.uniform4fv(waterU.uWaveA, waveA);
    gl.uniform4fv(waterU.uWaveB, waveB);
    gl.uniform1f(waterU.uMaxHeight, sea.maxHeight);
    gl.uniform1f(waterU.uMaxSlope, sea.maxSlope);
    gl.uniform3fv(waterU.uSunDir, sunDir);
    gl.uniform1f(waterU.uSunSize, 0.013 * v.light.sunSize);
    gl.uniform1f(waterU.uSunStrength, v.light.sunStrength);
    gl.uniform1f(waterU.uBand, v.light.band);
    for (const name of Object.keys(colors)) gl.uniform3fv(waterU[colorUniform(name)], colors[name]);
    draw(sceneTarget, width, height);

    // 2. Lens blur. Blur is sized against the stage, so it looks the same at any resolution.
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(lensProgram);
    gl.bindTexture(gl.TEXTURE_2D, sceneTarget.texture);
    gl.uniform1i(lensU.uScene, 0);
    gl.uniform2f(lensU.uRes, width, height);
    gl.uniform1f(lensU.uDepthLoad, 1 / DEPTH_STORE);
    gl.uniform1f(lensU.uFocus, v.lens.focus);
    gl.uniform1f(lensU.uAperture, v.lens.blur * 0.085 * height);
    gl.uniform1f(lensU.uMaxBlur, 0.03 * height);
    gl.uniform1i(lensU.uTaps, lite ? 20 : 48);
    draw(lensTarget, width, height);

    // 3. Glow: bright parts at quarter size, blurred across then down.
    gl.useProgram(brightProgram);
    gl.bindTexture(gl.TEXTURE_2D, lensTarget.texture);
    gl.uniform1i(brightU.uScene, 0);
    gl.uniform2f(brightU.uRes, brightTarget.w, brightTarget.h);
    gl.uniform1f(brightU.uLoad, 1 / STORE);
    gl.uniform1f(brightU.uStore, STORE);
    draw(brightTarget, brightTarget.w, brightTarget.h);

    gl.useProgram(blurProgram);
    gl.uniform1i(blurU.uSource, 0);
    gl.bindTexture(gl.TEXTURE_2D, brightTarget.texture);
    gl.uniform2f(blurU.uStep, 1 / brightTarget.w, 0);
    draw(blurTarget, blurTarget.w, blurTarget.h);
    gl.bindTexture(gl.TEXTURE_2D, blurTarget.texture);
    gl.uniform2f(blurU.uStep, 0, 1 / brightTarget.h);
    draw(bloomTarget, bloomTarget.w, bloomTarget.h);
    gl.bindTexture(gl.TEXTURE_2D, bloomTarget.texture);
    gl.generateMipmap(gl.TEXTURE_2D);

    // 4. Finish.
    gl.useProgram(finishProgram);
    gl.bindTexture(gl.TEXTURE_2D, lensTarget.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomTarget.texture);
    gl.uniform1i(finishU.uScene, 0);
    gl.uniform1i(finishU.uBloom, 1);
    gl.uniform2f(finishU.uRes, width, height);
    gl.uniform1f(finishU.uLoad, 1 / STORE);
    gl.uniform1f(finishU.uExposure, v.light.exposure);
    gl.uniform1f(finishU.uGlow, v.finish.glow);
    gl.uniform1f(finishU.uContrast, v.finish.contrast);
    gl.uniform1f(finishU.uVignette, v.finish.vignette);
    gl.uniform1f(finishU.uGrain, v.finish.grain);
    gl.uniform1f(finishU.uGrainSize, v.finish.grainSize * (width / Math.max(canvas.clientWidth, 1)));
    gl.uniform1f(finishU.uSeed, v.motion.playing ? (time * 24) % 97 : 0);
    draw(null, width, height);
    gl.activeTexture(gl.TEXTURE0);

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
