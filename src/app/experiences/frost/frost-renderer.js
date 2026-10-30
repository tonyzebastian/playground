import { createFrameLoop } from '@/lib/frame-loop';
import { FROST_MOODS } from './frostConfig';
import { createStreet, LIGHT_STRIDE, MAX_BUILDINGS, MAX_GLARE, MAX_LIGHTS, MAX_POOLS } from './street';
import { createRain, DROP_STRIDE } from './rain';

// A night street seen through a fogged, wet café window, in raw WebGL2.
//
// The street is rendered in HDR (brighter than white) so lights blur the way a lens blurs them:
// 1. Scene: sky, road, buildings, shopfronts and windows, with lamp light pooled on them.
// 2. Lens blur: the scene is spread by a disc blur, then every light (street.js) is added as
//    its own out-of-focus disc, with a brighter rim and a cat's-eye cut toward the corners.
// 3. The same scene nearly sharp, with small sharp lights: what each drop shows, upside down.
// 4. Water map: each drop (rain.js) as a small dome (normal in RG, size in B, coverage in A).
// 5. Mist: fogs back slowly and is wiped where a drop slides.
// 6. Glass: the blurred street under the mist, fine condensation beads drawn per pixel,
//    the drops bending the sharp street, then tone mapping and film grain.

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
`;

const SCENE_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uAspect;
uniform float uTime;
uniform float uStore;
uniform float uWindows;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uGround;
uniform vec3 uBuilding;
uniform vec3 uWindow;
uniform vec3 uGlow;
uniform vec2 uVP;
uniform vec4 uNearKerb;   // two points on each line
uniform vec4 uFarKerb;
uniform vec4 uFacade;
uniform vec4 uBuildings[${MAX_BUILDINGS * 3}];
uniform int uBuildingCount;
uniform vec4 uPools[${MAX_POOLS * 2}];
uniform int uPoolCount;
out vec4 outColor;
${HASH}

float lineY(vec4 l, float x) { return l.y + (x - l.x) * (l.w - l.y) / (l.z - l.x); }
float box(vec2 f, vec2 lo, vec2 hi) {
  vec2 a = step(lo, f) * step(f, hi);
  return a.x * a.y;
}

vec3 shopColor(float k) {
  if (k < 1.5) return vec3(1.0, 0.72, 0.42);
  if (k < 2.5) return vec3(0.85, 0.92, 1.0);
  if (k < 3.5) return vec3(1.0, 0.86, 0.6);
  return vec3(1.0, 0.55, 0.7);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uAspect, uv.y);

  // Sky, lit from below by the city.
  vec3 col = mix(uSkyHorizon, uSkyTop, smoothstep(0.38, 1.0, p.y));
  vec2 g = (p - uVP) * vec2(0.7, 1.6);
  col += uGlow * exp(-dot(g, g) * 9.0) * 0.5;
  // A low, uneven skyline far away.
  float far = 0.44 + vnoise(vec2(p.x * 22.0, 3.0)) * 0.05 + step(0.7, hash12(vec2(floor(p.x * 40.0), 1.0))) * 0.04;
  col = mix(col, uBuilding * 0.6 + uSkyHorizon * 0.4, step(p.y, far) * 0.85);

  // Ground: the far pavement, the wet road, and our own kerb.
  float facadeY = lineY(uFacade, p.x);
  float farKerb = lineY(uFarKerb, p.x);
  float nearKerb = lineY(uNearKerb, p.x);
  if (p.y < facadeY) {
    vec3 pave = uGround * 1.6;
    vec3 road = uGround * 0.8 + uSkyHorizon * 0.06;
    // Wet asphalt: a faint sheen of the glowing sky in the distance.
    road += uGlow * 0.08 * smoothstep(0.1, 0.0, abs(p.y - farKerb)) + uSkyHorizon * 0.05 * smoothstep(nearKerb, farKerb, p.y);
    col = p.y > farKerb ? pave : p.y > nearKerb ? road : uGround * 1.2;
  }

  // Buildings, far to near. Each has its own floors, window rhythm and share of lit rooms.
  for (int i = 0; i < ${MAX_BUILDINGS}; i++) {
    if (i >= uBuildingCount) break;
    vec4 A = uBuildings[i * 3];
    vec4 B = uBuildings[i * 3 + 1];
    vec4 C = uBuildings[i * 3 + 2];
    if (p.x < A.x || p.x > A.y) continue;
    float t = (p.x - A.x) / max(A.y - A.x, 1e-4);
    float yb = mix(A.z, A.w, t);
    float yt = mix(B.x, B.y, t);
    if (p.y < yb || p.y > yt) continue;
    float v = (p.y - yb) / max(yt - yb, 1e-4);
    float seed = float(i) * 17.31;
    vec3 wall = uBuilding * C.w * (0.85 + 0.3 * hash12(vec2(seed, 2.0)));
    wall *= 0.85 + 0.15 * step(0.04, 1.0 - v);   // a darker cornice
    col = wall;

    vec2 grid = vec2(t * B.w, v * B.z);
    vec2 cell = floor(grid);
    vec2 f = fract(grid);
    if (cell.y < 0.5 && C.z > 0.5) {
      // A lit shopfront at street level, split by dark mullions.
      float pane = box(f, vec2(0.06, 0.1), vec2(0.94, 0.82)) * step(0.08, fract(t * B.w * 0.5));
      float hum = 0.8 + 0.4 * hash12(cell + seed);
      col += shopColor(C.z) * pane * hum * 3.4 * uWindows;
    } else {
      float h = hash12(cell + seed);
      // Rooms switch on and off now and then, each on its own slow clock.
      float clock = floor(uTime / (35.0 + h * 90.0) + h * 7.0);
      float lit = step(hash12(cell + seed + clock * 1.37), C.x);
      vec2 lo = vec2(0.18 + 0.1 * hash12(vec2(seed, 5.0)), 0.25);
      float pane = box(f, lo, vec2(1.0 - lo.x, 0.78));
      vec3 tint = mix(vec3(0.8, 0.88, 1.0), uWindow, clamp(0.35 + C.y * 0.65 + (h - 0.5) * 0.5, 0.0, 1.0));
      float level = 0.25 + 0.9 * hash12(cell + seed + 3.3);
      // One window here and there has a television on.
      if (h > 0.985) level *= 0.4 + 0.6 * vnoise(vec2(uTime * 4.0, seed));
      col += tint * pane * lit * level * 2.6 * uWindows;
    }
  }

  // Lamplight pooled on the pavement, road and walls.
  for (int i = 0; i < ${MAX_POOLS}; i++) {
    if (i >= uPoolCount) break;
    vec4 P = uPools[i * 2];
    vec3 c = uPools[i * 2 + 1].rgb;
    vec2 d = (p - P.xy) * vec2(1.0, p.y < facadeY ? 2.4 : 0.8);
    col += c * P.w * exp(-dot(d, d) / (P.z * P.z)) * 0.45;
  }

  outColor = vec4(col * uStore, 1.0);
}
`;

// Lens blur: a golden-angle disc that favours bright samples, as a lens does.
const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uAspect;
uniform float uRadius;
uniform float uLod;
out vec4 outColor;
${HASH}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float rot = hash12(gl_FragCoord.xy) * 6.2831853;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  const int N = 44;
  for (int i = 0; i < N; i++) {
    float r = sqrt((float(i) + 0.5) / float(N));
    float a = float(i) * 2.39996323 + rot;
    vec3 c = textureLod(uScene, uv + vec2(cos(a), sin(a)) * r * vec2(uRadius / uAspect, uRadius), uLod).rgb;
    float w = 1.0 + dot(c, vec3(0.3, 0.6, 0.1)) * 3.0;
    acc += c * w;
    wsum += w;
  }
  outColor = vec4(acc / wsum, 1.0);
}
`;

const LIGHT_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aA;     // x, y, radius, intensity
layout(location=2) in vec4 aB;     // r, g, b, kind + seed
layout(location=3) in vec4 aC;     // motion x, motion y, reflection length
uniform float uAspect;
uniform float uRadiusScale;
uniform float uSharp;
uniform float uStore;
out vec2 vLocal;
out vec3 vColor;
out float vKind;
out float vSeed;
out float vLength;
out vec2 vOffset;
out vec2 vScreen;
out vec2 vSmear;     // half the motion, in radii
void main() {
  float kind = floor(aB.w + 0.001);
  float seed = fract(aB.w);
  float r = uSharp > 0.5 ? 0.0035 + aA.z * 0.05 : aA.z * uRadiusScale;
  vec2 motion = aC.xy;
  vec2 extent;
  vec2 center;
  if (kind > 0.5) {
    float len = aC.z;
    extent = vec2(r * 2.0 + abs(motion.x) * 0.5, r * (len * 0.5 + 1.4) + abs(motion.y) * 0.5);
    center = aA.xy - vec2(0.0, r * len * 0.5);
  } else {
    extent = vec2(r * (uSharp > 0.5 ? 3.0 : 3.4)) + abs(motion) * 0.5;
    center = aA.xy;
  }
  vec2 p = center + aCorner * extent;
  vLocal = (p - aA.xy) / r;
  vSmear = motion * 0.5 / r;
  vKind = kind;
  vSeed = seed;
  vLength = aC.z;
  vScreen = p;
  // Lights toward the frame edges are clipped by the lens into a cat's eye.
  vOffset = (aA.xy - vec2(uAspect * 0.5, 0.5)) * 1.1;
  // A smeared light spreads the same light over a longer shape.
  float smear = 1.0 + length(motion) / max(r, 1e-4) * 0.55;
  float energy = uSharp > 0.5 ? 1.0 : pow(0.05 / max(r, 0.004), 1.4) * 0.42;
  vColor = aB.rgb * aA.w * energy * uStore / smear;
  gl_Position = vec4(p.x / uAspect * 2.0 - 1.0, p.y * 2.0 - 1.0, 0.0, 1.0);
}
`;

const LIGHT_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vColor;
in float vKind;
in float vSeed;
in float vLength;
in vec2 vOffset;
in vec2 vScreen;
in vec2 vSmear;
uniform float uSharp;
uniform float uTime;
out vec4 outColor;
${HASH}

void main() {
  // Motion blur: measure from the nearest point on the path the light travelled.
  float m = length(vSmear);
  vec2 q = vLocal;
  if (m > 1e-3) {
    vec2 dir = vSmear / m;
    q -= dir * clamp(dot(vLocal, dir), -m, m);
  }
  float d = length(q);
  // The fog on the glass isn't even: the same patchy texture dims every light passing behind it.
  float frost = 0.72 + 0.38 * vnoise(vScreen * 28.0) + 0.18 * vnoise(vScreen * 71.0);
  float v;

  if (vKind > 0.5) {
    // A reflection on wet tarmac: fades in under the light, breaks into ripples, tapers away.
    float len = max(vLength, 1.0);
    float t = clamp(-q.y / len, 0.0, 1.0);
    float width = (0.38 + 0.35 * vSeed) * (1.0 + t * 0.9) * (uSharp > 0.5 ? 0.5 : 1.0);
    float x = q.x / width;
    float fadeIn = smoothstep(0.6, -0.9, q.y);
    float fadeOut = pow(1.0 - t, 1.6) * smoothstep(1.0, 0.7, t);
    float ripple = 0.45 + 0.55 * vnoise(vec2(q.y * (1.3 + vSeed) + uTime * 0.35, vSeed * 37.0));
    ripple *= 0.7 + 0.3 * vnoise(vec2(q.y * 6.0, vSeed * 11.0 + uTime * 0.2));
    float wobble = (vnoise(vec2(q.y * 0.9, vSeed * 5.0)) - 0.5) * 0.5 * t;
    x += wobble / width;
    v = exp(-x * x * 1.3) * fadeIn * fadeOut * ripple * 0.75 * frost;
  } else if (uSharp > 0.5) {
    v = exp(-d * d * 3.5) * 1.8 + exp(-d * d * 0.35) * 0.1;
  } else {
    // A defocused light seen through fogged glass: a hot middle, a soft edge whose outline
    // differs light to light, a cat's-eye cut near the corners, and a wide misty glow.
    float a = atan(q.y, q.x);
    float edge = 1.0 + 0.09 * (vnoise(vec2(a * 1.7 + vSeed * 31.0, vSeed * 9.0)) - 0.5) * 2.0;
    // Some lights stay fairly crisp, others melt into the fog.
    float soft = 0.16 + 0.55 * vSeed * vSeed;
    float disc = smoothstep(edge, edge - soft, d) * smoothstep(1.2, 1.2 - soft, length(q + vOffset));
    float body = 0.5 + 0.5 * exp(-d * d * 1.7);
    float glow = exp(-d * d * 0.3) * 0.17 + exp(-d * 0.85) * 0.05;
    v = (disc * body * frost + glow) * smoothstep(3.3, 2.3, d);
  }
  outColor = vec4(vColor * v, 0.0);
}
`;

const DROP_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aDrop;    // x, y, radius x, radius y
layout(location=2) in float aSize;
uniform float uAspect;
out vec2 vLocal;
out float vSize;
out float vSeed;
void main() {
  // A little margin so an irregular outline can bulge past the nominal radius.
  vec2 p = aDrop.xy + aCorner * aDrop.zw * 1.2;
  vLocal = aCorner * 1.2;
  vSize = aSize;
  vSeed = fract(sin(dot(aDrop.xy, vec2(12.9898, 78.233))) * 43758.5453);
  gl_Position = vec4(p.x / uAspect * 2.0 - 1.0, p.y * 2.0 - 1.0, 0.0, 1.0);
}
`;

// No two drops alike: a wobbly outline, a bottom that sags, a tilt that moves the highlight,
// and a thickness that sets how strongly it bends light.
const DROP_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vSize;
in float vSeed;
uniform float uPixel;   // one pixel, in stage units
out vec4 outColor;
void main() {
  vec2 l = vLocal;
  float s2 = fract(vSeed * 7.13);
  float s3 = fract(vSeed * 13.7);
  if (l.y < 0.0) l.y /= 1.0 + 0.3 * s2;
  float ang = atan(l.y, l.x);
  float wob = 1.0 + (0.08 + 0.12 * s3) * (sin(ang * 2.0 + vSeed * 20.0) * 0.6 + sin(ang * 3.0 + s2 * 40.0) * 0.4);
  float d = length(l) / wob;
  if (d > 1.0) discard;
  float edge = clamp(uPixel / max(vSize, 1e-4), 0.02, 0.6);
  float a = smoothstep(1.0, 1.0 - edge * 1.5, d);
  vec2 n = l / wob;
  n += (vec2(vSeed, s2) - 0.5) * 0.45 * (1.0 - d * d);
  float thick = 0.45 + 0.55 * s3;
  outColor = vec4(clamp(n * 0.5 + 0.5, 0.0, 1.0), clamp(vSize * thick / 0.012, 0.0, 1.0), a);
}
`;

const WIPE_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vSize;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  if (d > 1.0) discard;
  outColor = vec4(0.0, 0.0, 0.0, smoothstep(1.0, 0.2, d) * 0.35);
}
`;

const FILL_FRAG = `#version 300 es
precision highp float;
uniform float uAlpha;
out vec4 outColor;
void main() { outColor = vec4(1.0, 1.0, 1.0, uAlpha); }
`;

const GLASS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uBlur;
uniform sampler2D uSharp;
uniform sampler2D uWater;
uniform sampler2D uMist;
uniform vec2 uRes;
uniform float uAspect;
uniform float uLoad;
uniform float uLens;
uniform float uMistAmount;
uniform float uCondense;
uniform float uWarp;
uniform float uExposure;
uniform vec3 uHaze;
uniform float uGrain;
uniform float uGrainSize;
uniform float uChroma;
uniform vec4 uGlare[${MAX_GLARE * 2}];   // x, y, radius, strength | r, g, b
out vec4 outColor;
${HASH}

vec2 frost(vec2 p) {
  vec2 q = p * 3.0;
  vec2 d = vec2(vnoise(q), vnoise(q + 17.3)) - 0.5;
  vec2 q2 = p * 24.0;
  d += (vec2(vnoise(q2), vnoise(q2 + 5.1)) - 0.5) * 0.45;
  return d;
}

// Condensation: a bead in some cells of a jittered grid. Returns the bead's normal and coverage.
vec4 beads(vec2 px, float cell, float density, float seed) {
  vec2 g = px / cell;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec4 best = vec4(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 k = id + o + seed;
      if (hash12(k * 1.7) > density) continue;
      vec2 c = o + 0.15 + 0.7 * hash22(k);
      float h = hash12(k + 3.1);
      float rad = 0.1 + 0.38 * h * h;
      vec2 dv = f - c;
      dv.y *= 1.0 + 0.2 * hash12(k + 8.4);
      float d = length(dv);
      float cov = smoothstep(rad, rad - 1.2 / cell, d);
      if (cov > best.z) best = vec4(dv / rad, cov, hash12(k + 5.9));
    }
  }
  return best;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uAspect, uv.y);
  vec2 toUv = vec2(1.0 / uAspect, 1.0);

  // Fogged glass: the blurred street, softened and lifted where the mist is.
  float fog = texture(uMist, uv).r;
  float m = fog * uMistAmount;
  vec2 suv = uv + frost(p) * uWarp * 0.008 * m * toUv;
  vec3 bg = textureLod(uBlur, suv, 0.0).rgb * uLoad;
  vec3 scatter = textureLod(uBlur, uv, 4.5).rgb * uLoad;
  bg = mix(bg, bg * 0.62 + scatter * 0.55, m) + uHaze * 0.03 * m;

  // Headlights aimed at the window: their light catches in the fog on the glass itself.
  vec3 glare = vec3(0.0);
  for (int i = 0; i < ${MAX_GLARE}; i++) {
    vec4 G = uGlare[i * 2];
    if (G.w <= 0.0) continue;
    vec2 dv = (p - G.xy) * vec2(0.8, 1.0);
    float r2 = dot(dv, dv) / (G.z * G.z);
    glare += uGlare[i * 2 + 1].rgb * G.w * (exp(-r2 * 1.6) + exp(-r2 * 0.25) * 0.25);
  }
  float patchy = 0.7 + 0.6 * vnoise(p * 9.0) * vnoise(p * 23.0 + 4.0);
  bg += glare * (0.15 + m * 0.85) * patchy;
  vec3 col = bg;

  // Fine condensation beads, sized in pixels so they stay fine at any resolution.
  // Condensation gathers unevenly: thick patches, thinner ones, heavier toward the bottom,
  // and where fine beads have merged, fewer and larger ones.
  float px = uRes.y / 1000.0;
  float field = vnoise(p * 3.1 + 7.0) * 0.65 + vnoise(p * 8.3 + 2.0) * 0.35;
  float dense = smoothstep(0.22, 0.78, field) * (0.6 + 0.55 * (1.0 - uv.y));
  vec4 b0 = beads(gl_FragCoord.xy, 3.0 * px, 0.8 * dense, 23.0);
  vec4 b1 = beads(gl_FragCoord.xy, 5.6 * px, 0.62 * dense, 0.0);
  vec4 b2 = beads(gl_FragCoord.xy, 8.5 * px, 0.42 * (1.0 - dense * 0.55), 11.0);
  vec4 b = b0;
  if (b1.z > b.z) b = b1;
  if (b2.z > b.z) b = b2;
  float beadCover = b.z * uCondense * smoothstep(0.25, 0.9, fog);
  if (beadCover > 0.001) {
    vec2 n = b.xy;
    float e = length(n);
    float lum = dot(scatter + bg, vec3(0.3, 0.6, 0.1));
    float lit = clamp(lum * 2.5, 0.0, 1.0);
    // Explicit level: the offset jumps per pixel, which would otherwise pick a tiny mip.
    vec3 inside = textureLod(uBlur, uv - n * 0.012 * toUv, 0.0).rgb * uLoad * 1.05;
    // A dark edge only shows against light; in the dark a bead just catches a little haze.
    inside = mix(inside, bg * 0.5, smoothstep(0.65, 1.0, e) * 0.5 * lit);
    inside += uHaze * 0.012 * (1.0 - lit);
    vec2 hl = vec2(-0.35, 0.4) + (vec2(b.w, fract(b.w * 7.3)) - 0.5) * 0.5;
    float spark = exp(-dot(n - hl, n - hl) * 12.0);
    inside += bg * spark * lum * 2.0 + glare * spark * 2.5;
    col = mix(col, inside, beadCover * (0.55 + 0.45 * lit));
  }

  // Drops: each is a short-focus lens showing a sharper, upside-down patch of street.
  vec4 w = texture(uWater, uv);
  float cover = w.a;
  if (cover > 0.002) {
    vec2 n = (w.rg - 0.5) * 2.0 / max(cover, 0.05);
    float size = w.b / max(cover, 0.05);
    float e = clamp(length(n), 0.0, 1.0);
    vec2 slope = n / sqrt(max(0.06, 1.0 - e * e * 0.92));
    vec2 look = -slope * (0.02 + size * 0.03) * uLens;
    vec3 drop = texture(uSharp, uv + look * toUv).rgb * uLoad + bg * 0.1;
    // Light can't get out near the edge (total internal reflection): a dark rim...
    float lum = dot(scatter, vec3(0.3, 0.6, 0.1));
    float lit = clamp(lum * 3.0, 0.0, 1.0);
    float rim = smoothstep(0.72, 0.98, e);
    drop = mix(drop, bg * 0.12, rim * (0.35 + 0.5 * lit));
    // ...and gathers into a bright crescent on the lower inside edge.
    drop += scatter * 1.4 * smoothstep(0.5, 0.82, e) * (1.0 - rim) * smoothstep(0.1, -0.9, n.y);
    // The highlight sits wherever this drop's own tilt puts it (the tilt is baked into n).
    float spec = exp(-dot(n - vec2(-0.3, 0.42), n - vec2(-0.3, 0.42)) * 30.0);
    drop += vec3(0.9, 0.94, 1.0) * spec * (0.015 + lum * 1.6) * (0.4 + size);
    drop += glare * (spec * 3.0 + smoothstep(0.55, 0.9, e) * (1.0 - rim) * 0.8);
    col = mix(col, drop, cover);
  }

  // Very bright light burns toward white, then a filmic curve.
  // Tone map brightness but keep each light's hue, so overlapping lights stay coloured;
  // only the very brightest cores drift toward white.
  col *= uExposure;
  float L = max(dot(col, vec3(0.3, 0.6, 0.1)), 1e-5);
  vec3 kept = col * (aces(vec3(L)).x / L);
  kept = mix(kept, vec3(aces(vec3(L)).x), smoothstep(4.0, 14.0, L) * 0.6);
  col = mix(aces(col), clamp(kept, 0.0, 1.0), 0.7);
  col = pow(col, vec3(0.95));

  vec2 c = uv - 0.5;
  col *= 1.0 - dot(c, c) * 0.6;
  vec2 cell = floor(gl_FragCoord.xy / uGrainSize);
  float gr = hash12(cell) + hash12(cell + 7.7) - 1.0;
  vec3 tint = vec3(hash12(cell + 3.1), hash12(cell + 5.3), hash12(cell + 9.7)) - 0.5;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col += (vec3(gr) + tint * uChroma) * uGrain * 0.06 * (0.45 + 0.55 * (1.0 - luma));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const hexToRgb = (hex, fallback = [0, 0, 0]) => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// `getValues()` returns the live control values (see frostConfig.js). Returns `destroy()`.
export function createFrost(canvas, getValues, { lite = false, onReady } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) {
    onReady?.();
    return () => {};
  }
  // Float targets keep lights brighter than white until the end. Without them, values are
  // stored scaled down in 8-bit textures.
  const hdr = !!gl.getExtension('EXT_color_buffer_float');
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

  const sceneProgram = link(FULLSCREEN_VERT, SCENE_FRAG);
  const blurProgram = link(FULLSCREEN_VERT, BLUR_FRAG);
  const lightProgram = link(LIGHT_VERT, LIGHT_FRAG);
  const dropProgram = link(DROP_VERT, DROP_FRAG);
  const wipeProgram = link(DROP_VERT, WIPE_FRAG);
  const fillProgram = link(FULLSCREEN_VERT, FILL_FRAG);
  const glassProgram = link(FULLSCREEN_VERT, GLASS_FRAG);
  const sceneU = uniforms(sceneProgram, ['uRes', 'uAspect', 'uTime', 'uStore', 'uWindows', 'uSkyTop', 'uSkyHorizon', 'uGround', 'uBuilding', 'uWindow', 'uGlow', 'uVP', 'uNearKerb', 'uFarKerb', 'uFacade', 'uBuildings', 'uBuildingCount', 'uPools', 'uPoolCount']);
  const blurU = uniforms(blurProgram, ['uScene', 'uRes', 'uAspect', 'uRadius', 'uLod']);
  const lightU = uniforms(lightProgram, ['uAspect', 'uRadiusScale', 'uSharp', 'uStore', 'uTime']);
  const dropU = uniforms(dropProgram, ['uAspect', 'uPixel']);
  const wipeU = uniforms(wipeProgram, ['uAspect']);
  const fillU = uniforms(fillProgram, ['uAlpha']);
  const glassU = uniforms(glassProgram, ['uBlur', 'uSharp', 'uWater', 'uMist', 'uRes', 'uAspect', 'uLoad', 'uLens', 'uMistAmount', 'uCondense', 'uWarp', 'uExposure', 'uHaze', 'uGrain', 'uGrainSize', 'uChroma', 'uGlare']);

  // One quad, drawn once per light, drop or wipe with per-instance attributes.
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const instances = (layout) => {
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    layout.attribs.forEach(([loc, size, offset]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, layout.stride * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    });
    gl.bindVertexArray(null);
    return { vao, buffer };
  };
  const lightInstances = instances({ stride: LIGHT_STRIDE, attribs: [[1, 4, 0], [2, 4, 4], [3, 4, 8]] });
  const dropInstances = instances({ stride: DROP_STRIDE, attribs: [[1, 4, 0], [2, 1, 4]] });
  const wipeInstances = instances({ stride: 4, attribs: [[1, 4, 0], [2, 1, 2]] });
  const wipeData = new Float32Array(16 * 4);
  const emptyVao = gl.createVertexArray();

  const target = ({ float = false, mipmaps = false } = {}) => ({ texture: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0, float: float && hdr, mipmaps });
  const sizeTarget = (t, w, h, clear) => {
    if (t.w === w && t.h === h) return;
    t.w = w;
    t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    if (t.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, t.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (t.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
    if (clear) {
      gl.clearColor(...clear);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const sceneTarget = target({ float: true, mipmaps: true });
  const blurTarget = target({ float: true, mipmaps: true });
  const sharpTarget = target({ float: true });
  const waterTarget = target();
  const mistTarget = target();

  let width = 0;
  let height = 0;
  const resize = (v) => {
    const q = v.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, q.pixelRatio, lite ? 1.5 : 2);
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (w !== width || h !== height) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    }
    const s = Math.min(q.sceneScale, lite ? 0.35 : 1);
    const at = (k) => [Math.max(2, Math.round(w * s * k)), Math.max(2, Math.round(h * s * k))];
    sizeTarget(sceneTarget, ...at(0.5));
    sizeTarget(blurTarget, ...at(0.75));
    sizeTarget(sharpTarget, ...at(1));
    sizeTarget(waterTarget, w, h);
    sizeTarget(mistTarget, Math.max(2, Math.round(w / 4)), Math.max(2, Math.round(h / 4)), [1, 1, 1, 1]);
  };

  const street = createStreet();
  const rain = createRain();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let time = 0;
  let mistReturn = 0;
  let announced = false;

  const drawScene = (t, v, mood, aspect, counts) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.useProgram(sceneProgram);
    gl.uniform2f(sceneU.uRes, t.w, t.h);
    gl.uniform1f(sceneU.uAspect, aspect);
    gl.uniform1f(sceneU.uTime, time);
    gl.uniform1f(sceneU.uStore, STORE);
    gl.uniform1f(sceneU.uWindows, v.street.windows);
    gl.uniform3fv(sceneU.uSkyTop, hexToRgb(mood.skyTop));
    gl.uniform3fv(sceneU.uSkyHorizon, hexToRgb(mood.skyHorizon));
    gl.uniform3fv(sceneU.uGround, hexToRgb(mood.ground));
    gl.uniform3fv(sceneU.uBuilding, hexToRgb(mood.building));
    gl.uniform3fv(sceneU.uWindow, hexToRgb(mood.window));
    gl.uniform3fv(sceneU.uGlow, hexToRgb(mood.glow));
    const vp = street.project(4000, 0, 0);
    gl.uniform2f(sceneU.uVP, vp.x, vp.y);
    const line = (side) => {
      const a = street.project(6, side, 0);
      const b = street.project(400, side, 0);
      return [a.x, a.y, b.x, b.y];
    };
    gl.uniform4fv(sceneU.uNearKerb, line(-5.5));
    gl.uniform4fv(sceneU.uFarKerb, line(5.5));
    gl.uniform4fv(sceneU.uFacade, line(10));
    gl.uniform4fv(sceneU.uBuildings, street.buildingData);
    gl.uniform1i(sceneU.uBuildingCount, counts.buildingCount);
    gl.uniform4fv(sceneU.uPools, street.poolData);
    gl.uniform1i(sceneU.uPoolCount, counts.poolCount);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const drawLights = (t, aspect, sharp, radiusScale, lightCount) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(lightProgram);
    gl.uniform1f(lightU.uAspect, aspect);
    gl.uniform1f(lightU.uRadiusScale, radiusScale);
    gl.uniform1f(lightU.uSharp, sharp ? 1 : 0);
    gl.uniform1f(lightU.uStore, STORE);
    gl.uniform1f(lightU.uTime, time);
    gl.bindVertexArray(lightInstances.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lightCount);
    gl.disable(gl.BLEND);
  };

  const mipmap = (t) => {
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
  };

  const frame = (dt) => {
    const v = getValues();
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    const mood = FROST_MOODS[v.street.mood] ?? FROST_MOODS.night;
    resize(v);

    const step = v.motion.playing ? dt * v.motion.speed * (reduceMotion.matches ? 0.4 : 1) : 0;
    time += step;

    // The "shutter": how long each frame's light smear lasts, in street seconds.
    const shutter = v.motion.playing ? 0.14 * v.motion.speed : 0;
    const counts = street.update(step, v.street, aspect, { lamp: hexToRgb(mood.lamp), window: hexToRgb(mood.window) }, shutter);
    const { dropCount, wipeCount } = rain.update(step, v.drops, aspect, lite, v.street.seed);
    gl.bindBuffer(gl.ARRAY_BUFFER, lightInstances.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, street.lights.subarray(0, counts.lightCount * LIGHT_STRIDE), gl.DYNAMIC_DRAW);
    gl.disable(gl.BLEND);

    // 1–2. The scene, then its lens blur, then the out-of-focus lights on top.
    drawScene(sceneTarget, v, mood, aspect, counts);
    mipmap(sceneTarget);
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurTarget.fbo);
    gl.viewport(0, 0, blurTarget.w, blurTarget.h);
    gl.useProgram(blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTarget.texture);
    gl.uniform1i(blurU.uScene, 0);
    gl.uniform2f(blurU.uRes, blurTarget.w, blurTarget.h);
    gl.uniform1f(blurU.uAspect, aspect);
    const radius = 0.032 * v.glass.blur;
    gl.uniform1f(blurU.uRadius, radius);
    gl.uniform1f(blurU.uLod, Math.max(0, Math.log2((radius * sceneTarget.h) / 4)));
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawLights(blurTarget, aspect, false, v.glass.blur, counts.lightCount);
    mipmap(blurTarget);

    // 3. Nearly sharp, for the drops.
    drawScene(sharpTarget, v, mood, aspect, counts);
    drawLights(sharpTarget, aspect, true, 1, counts.lightCount);

    // 4. The water map.
    gl.bindFramebuffer(gl.FRAMEBUFFER, waterTarget.fbo);
    gl.viewport(0, 0, waterTarget.w, waterTarget.h);
    gl.clearColor(0.5, 0.5, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(dropProgram);
    gl.uniform1f(dropU.uAspect, aspect);
    gl.uniform1f(dropU.uPixel, 1 / height);
    gl.bindBuffer(gl.ARRAY_BUFFER, dropInstances.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, rain.drops.subarray(0, dropCount * DROP_STRIDE), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(dropInstances.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, dropCount);

    // 5. Mist creeps back in steps an 8-bit texture can hold; a sliding drop wipes it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, mistTarget.fbo);
    gl.viewport(0, 0, mistTarget.w, mistTarget.h);
    mistReturn += step * v.glass.mistReturn * 0.04;
    if (mistReturn > 0.012) {
      gl.useProgram(fillProgram);
      gl.uniform1f(fillU.uAlpha, mistReturn);
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      mistReturn = 0;
    }
    if (wipeCount) {
      for (let i = 0; i < wipeCount; i++) {
        const r = rain.wipes[i * 3 + 2];
        wipeData.set([rain.wipes[i * 3], rain.wipes[i * 3 + 1], r, r], i * 4);
      }
      gl.useProgram(wipeProgram);
      gl.uniform1f(wipeU.uAspect, aspect);
      gl.bindBuffer(gl.ARRAY_BUFFER, wipeInstances.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, wipeData.subarray(0, wipeCount * 4), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(wipeInstances.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, wipeCount);
    }
    gl.disable(gl.BLEND);

    // 6. The glass.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(glassProgram);
    [blurTarget, sharpTarget, waterTarget, mistTarget].forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
    });
    gl.uniform1i(glassU.uBlur, 0);
    gl.uniform1i(glassU.uSharp, 1);
    gl.uniform1i(glassU.uWater, 2);
    gl.uniform1i(glassU.uMist, 3);
    gl.uniform2f(glassU.uRes, width, height);
    gl.uniform1f(glassU.uAspect, aspect);
    gl.uniform1f(glassU.uLoad, 1 / STORE);
    gl.uniform1f(glassU.uLens, v.drops.lens);
    gl.uniform1f(glassU.uMistAmount, v.glass.mist);
    gl.uniform1f(glassU.uCondense, v.glass.condensation);
    gl.uniform1f(glassU.uWarp, v.glass.frostWarp);
    gl.uniform1f(glassU.uExposure, v.street.exposure);
    gl.uniform3fv(glassU.uHaze, hexToRgb(mood.haze));
    gl.uniform1f(glassU.uGrain, v.grain.amount);
    gl.uniform1f(glassU.uGrainSize, v.grain.size);
    gl.uniform1f(glassU.uChroma, v.grain.chroma);
    gl.uniform4fv(glassU.uGlare, street.glareData);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
