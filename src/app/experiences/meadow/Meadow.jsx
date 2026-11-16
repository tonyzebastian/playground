"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { bakedKey } from "./meadowConfig";

// Windy meadow seen from above. Each frame: a wind field is baked to a small texture, long
// instanced blades read it in the vertex shader, and a post pass resolves the anti-aliased
// image with optional softening, grain and grading. Every look and motion parameter is a
// uniform fed from the DialKit values; only controls that change where blades are planted
// rebuild the instance buffers.

const WIND_RECT = [-60, -60, 120, 100]; // minX, minZ, sizeX, sizeZ of the wind texture
const WIND_RES = 512;
const BASE_COUNT = { tall: 270000, under: 200000 };
const SMALL_COUNT = { tall: 110000, under: 90000 };
const FLOWER_COUNT = 2400, FLOWER_COUNT_SMALL = 900;
const STALK_COUNT = 7000, STALK_COUNT_SMALL = 3000;
const CARPET_COUNT = 150000, CARPET_COUNT_SMALL = 60000;
const SHADOW_SEGMENTS = 4;      // blades are drawn into the shadow map with fewer segments

const NOISE = `
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}`;

const FULLSCREEN_VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p * 2.0 - 1.0;
  gl_Position = vec4(vUv, 0.0, 1.0);
}`;

// Wind field: r = gust strength, gb = flow direction as a unit vector, a = fine flutter.
// The grass is combed into wide meandering lanes: the flow direction swings left and right
// of the wind as a sine of the distance across the lane, with that distance warped by slow
// noise so the lanes wander like paths. Three lane scales drift at different speeds. A weak,
// very large-scale noise vector opens a few big swirls where lanes meet. Storing a vector
// (not an angle) keeps interpolation seamless.
const WIND_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uRect;
uniform float uTime;
uniform vec2 uDir;        // wind direction right now (wanders over time)
uniform vec2 uBase;       // fixed axes the lanes are laid out on
uniform vec2 uAdv;        // pattern drift: the wind direction integrated over time (not direction x elapsed time)
uniform float uLaneT;     // lane clock, advanced at the Lane Speed rate
uniform float uLaneWidth;
uniform float uLaneSwing;
uniform float uMeander;
uniform float uLaneBright;
uniform float uSwirl;
uniform float uSwirlSize;
out vec4 outColor;
${NOISE}
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
void main() {
  vec2 p = uRect.xy + (vUv * 0.5 + 0.5) * uRect.zw;
  vec2 perp = vec2(-uBase.y, uBase.x);
  vec2 q = p * 0.04 - uAdv * 0.10;
  vec2 w = vec2(fbm(q + 4.0), fbm(q + 11.0));
  float warp = (fbm(q * 1.6 + w * 1.8) - 0.5) * uMeander;
  float across = (dot(p, perp) + warp + dot(p, uBase) * 0.12) / uLaneWidth;
  float lane = (0.55 * sin(across * 0.09 + 4.0 - uLaneT * 0.12)
              + 0.50 * sin(across * 0.20 - uLaneT * 0.30)
              + 0.35 * sin(across * 0.46 + 1.7 - uLaneT * 0.62)) / 1.05;
  float angle = clamp(lane, -1.0, 1.0) * uLaneSwing + (w.x - 0.5) * 0.8;
  vec2 dir = rot(uDir, angle);
  vec2 sp = p * 0.05 / uSwirlSize - uAdv * 0.08;
  vec2 big = vec2(fbm(sp + 3.0), fbm(sp + 17.0)) - 0.5;
  dir = normalize(dir * 0.55 + big * uSwirl + vec2(1e-5));
  float gust = clamp(smoothstep(-0.6, 0.9, lane) * 0.7 + 0.15, 0.0, 1.0);
  float flutter = fbm(p * 0.55 - uAdv * 1.9);
  outColor = vec4(gust, dir * 0.5 + 0.5, flutter);
}`;

// Final grade: optional painted layer blended over the sharp scene, then exposure, filmic contrast,
// vignette and grain. The painted layer is rendered at reduced resolution and upscaled here.
const POST_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uPaint;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform float uPaintAmount;
uniform float uTime;
uniform float uExposure;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uBloom;
uniform float uSaturation;
uniform float uTone;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
out vec4 outColor;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// Leaves the mid-tones alone and rolls anything brighter than 0.72 off toward white, like film.
vec3 shoulder(vec3 x) {
  const float a = 0.72;
  vec3 hi = a + (1.0 - a) * (1.0 - exp(-(x - a) / (1.0 - a)));
  return mix(x, hi, step(a, x));
}
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec3 c = texture(uScene, uv).rgb;
  if (uPaintAmount > 0.0) c = mix(c, texture(uPaint, uv).rgb, uPaintAmount);
  c += (texture(uBloomA, uv).rgb * 0.55 + texture(uBloomB, uv).rgb * 0.75) * uBloom;
  c = max(c * uExposure, 0.0);
  // split tone: shadows lean one way, highlights the other; the tint is normalised so only hue shifts
  float l = dot(c, LUMA);
  vec3 tint = mix(uShadowTint, uHighTint, smoothstep(0.05, 0.6, l));
  tint /= max(dot(tint, LUMA), 1e-3);
  c *= mix(vec3(1.0), tint, uTone * 0.5);
  c = mix(vec3(dot(c, LUMA)), c, uSaturation);
  c = clamp(shoulder(max(c, 0.0)), 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c *= 1.0 - uVignette * dot(vUv, vUv) * 0.5;
  c += (hash21(gl_FragCoord.xy + fract(floor(uTime * 24.0) * 0.137) * 91.0) - 0.5) * uGrain;
  outColor = vec4(c, 1.0);
}`;

// Bloom: a 4-tap downsample that keeps only what is brighter than the threshold (threshold 0 = plain downsample).
const BLOOM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;       // one texel of the source
uniform float uThreshold;
out vec4 outColor;
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec3 c = 0.25 * (texture(uTex, uv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uTex, uv + uTexel * vec2(1.0, -1.0)).rgb
                 + texture(uTex, uv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uTex, uv + uTexel * vec2(1.0, 1.0)).rgb);
  c = min(max(c, 0.0), vec3(6.0));
  float l = max(c.r, max(c.g, c.b));
  c *= max(l - uThreshold, 0.0) / max(l, 1e-4);
  outColor = vec4(c, 1.0);
}`;

// ---- painterly anisotropic Kuwahara (Kyprianidis et al.), run at reduced resolution ------------
// 1. Structure tensor of the image (Sobel gradients per colour channel): E, F, G = gx.gx, gx.gy, gy.gy.
const TENSOR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;   // full-resolution scene, sampled bilinearly (this is also the downsample)
uniform vec2 uTexel;        // 1 / pass size
out vec4 outColor;
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec3 tl = texture(uScene, uv + uTexel * vec2(-1.0, 1.0)).rgb, t = texture(uScene, uv + uTexel * vec2(0.0, 1.0)).rgb, tr = texture(uScene, uv + uTexel * vec2(1.0, 1.0)).rgb;
  vec3 l = texture(uScene, uv + uTexel * vec2(-1.0, 0.0)).rgb, r = texture(uScene, uv + uTexel * vec2(1.0, 0.0)).rgb;
  vec3 bl = texture(uScene, uv + uTexel * vec2(-1.0, -1.0)).rgb, b = texture(uScene, uv + uTexel * vec2(0.0, -1.0)).rgb, br = texture(uScene, uv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  vec3 gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  outColor = vec4(dot(gx, gx), dot(gx, gy), dot(gy, gy), 1.0);
}`;

// 2. Gaussian smoothing of the tensor field (run horizontally, then vertically) so strokes follow broad flow.
const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDirection;
uniform float uSigma;
out vec4 outColor;
void main() {
  ivec2 size = textureSize(uTex, 0);
  ivec2 p = ivec2((vUv * 0.5 + 0.5) * vec2(size));
  int rad = int(min(ceil(uSigma * 2.0), 8.0));
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -rad; i <= rad; i++) {
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    ivec2 q = clamp(p + ivec2(uDirection) * i, ivec2(0), size - 1);
    sum += texelFetch(uTex, q, 0) * w;
    wsum += w;
  }
  outColor = sum / wsum;
}`;

// 3. The filter: an ellipse aligned with the local stroke direction, split into 8 sectors; every pixel
//    takes the (soft-)lowest-variance sector, which flattens detail into brush-like masses but keeps edges.
const KUWA_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uTensor;
uniform float uRadius;
uniform float uSharpness;
uniform float uAlpha;
uniform float uSaturation;
out vec4 outColor;
const int N = 8;
void main() {
  ivec2 size = textureSize(uTensor, 0);
  vec2 inv = 1.0 / vec2(size);
  ivec2 p = ivec2((vUv * 0.5 + 0.5) * vec2(size));
  vec3 J = texelFetch(uTensor, p, 0).xyz;
  float disc = sqrt(max((J.x - J.z) * (J.x - J.z) + 4.0 * J.y * J.y, 0.0));
  float l1 = 0.5 * (J.x + J.z + disc), l2 = 0.5 * (J.x + J.z - disc);
  float A = (l1 - l2) / (l1 + l2 + 1e-6);                      // 0 = flat, 1 = strongly directional
  vec2 g = vec2(l1 - J.x, -J.y);
  vec2 t = length(g) > 1e-6 ? normalize(vec2(-g.y, g.x)) : vec2(1.0, 0.0);   // along the edge
  vec2 n = vec2(-t.y, t.x);
  float a = uRadius * clamp((uAlpha + A) / uAlpha, 1.0, 2.0);   // long axis
  float b = uRadius * clamp(uAlpha / (uAlpha + A), 0.5, 1.0);   // short axis
  int L = int(min(ceil(a), 5.0));
  vec4 m[N];
  vec3 m2[N];
  for (int i = 0; i < N; i++) { m[i] = vec4(0.0); m2[i] = vec3(0.0); }
  vec2 centre = (vec2(p) + 0.5) * inv;
  for (int dy = -L; dy <= L; dy++) {
    for (int dx = -L; dx <= L; dx++) {
      vec2 d = vec2(float(dx), float(dy));
      vec2 q = vec2(dot(d, t) / a, dot(d, n) / b);
      float r2 = dot(q, q);
      if (r2 > 1.0) continue;
      float w = exp(-3.0 * r2);
      int s = int(floor((atan(q.y, q.x) / 6.2831853 + 0.5) * float(N))) % N;
      vec3 c = texture(uScene, centre + d * inv).rgb;
      m[s] += vec4(c * w, w);
      m2[s] += c * c * w;
    }
  }
  vec3 acc = vec3(0.0);
  float wacc = 0.0;
  for (int i = 0; i < N; i++) {
    if (m[i].w < 1e-4) continue;
    vec3 mean = m[i].rgb / m[i].w;
    vec3 v = max(m2[i] / m[i].w - mean * mean, 0.0);
    float sigma = sqrt(dot(v, vec3(1.0)));
    float wi = 1.0 / (1.0 + pow(255.0 * sigma, uSharpness));
    acc += mean * wi;
    wacc += wi;
  }
  vec3 painted = wacc > 0.0 ? acc / wacc : texture(uScene, centre).rgb;
  float lum = dot(painted, vec3(0.299, 0.587, 0.114));
  outColor = vec4(mix(vec3(lum), painted, uSaturation), 1.0);
}`;

const GROUND_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uVP;
out vec3 vWorld;
void main() {
  vWorld = vec3(aPos.x, 0.0, aPos.y);
  gl_Position = uVP * vec4(vWorld, 1.0);
}`;

const FOG = `
uniform float uFog;
uniform vec3 uFogColor;
uniform float uMist, uMistHeight;
uniform vec3 uMistColor;
uniform vec2 uMistOff;
// Ground mist: drifting wisps that lie low in the grass and thin out with height. Needs vnoise().
float mistAt(vec3 w) {
  vec2 p = w.xz * 0.07 - uMistOff;
  float n = vnoise(p) * 0.6 + vnoise(p * 2.7 + 3.0) * 0.4;
  return uMist * smoothstep(0.35, 0.8, n) * exp(-max(w.y, 0.0) / uMistHeight);
}
// lit: how much sun reaches this point. Mist glows where the sun is in it and goes dim in shadow.
vec3 applyFog(vec3 c, float d, float mist, float lit) {
  c = mix(c, uFogColor, uFog * (1.0 - exp(-d * 0.006)));
  return mix(c, uMistColor * mix(0.22, 1.0, lit), clamp(mist, 0.0, 0.85));
}`;

// Sun visibility: the shadow map (blades and rock, seen from the sun) and slow cloud shadows. Needs vnoise().
const LIGHT_LIB = `
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uLightVP;
uniform float uShadowOn;
uniform float uCloud, uCloudScale;
uniform vec2 uCloudOff;
float sunShadow(vec3 w) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 lp = uLightVP * vec4(w, 1.0);
  vec3 q = lp.xyz * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  return textureLod(uShadowMap, vec3(q.xy, q.z - 0.0012), 0.0);
}
float sunShadowSoft(vec3 w) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 lp = uLightVP * vec4(w, 1.0);
  vec3 q = lp.xyz * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  vec2 t = 1.6 / vec2(textureSize(uShadowMap, 0));
  float z = q.z - 0.0012;
  return 0.25 * (textureLod(uShadowMap, vec3(q.xy + t * vec2(-1.0, -0.4), z), 0.0) + textureLod(uShadowMap, vec3(q.xy + t * vec2(0.4, -1.0), z), 0.0)
               + textureLod(uShadowMap, vec3(q.xy + t * vec2(1.0, 0.4), z), 0.0) + textureLod(uShadowMap, vec3(q.xy + t * vec2(-0.4, 1.0), z), 0.0));
}
float cloudLight(vec2 xz) {
  vec2 p = xz * 0.03 * uCloudScale - uCloudOff;
  float n = vnoise(p) * 0.62 + vnoise(p * 2.3 + 7.0) * 0.38;
  return mix(1.0, smoothstep(0.36, 0.62, n), uCloud);
}`;

const SHADOW_LIB = `
uniform sampler2D uMask;      // top-down footprint of the rock (0.5 at its edge)
uniform vec4 uMaskRect;
uniform float uShadowAmt;
// 0..1: contact darkening where the ground meets the rock (the cast shadow itself comes from the shadow map)
float rockShadow(vec2 xz) {
  if (uShadowAmt <= 0.0) return 0.0;
  return smoothstep(0.03, 0.45, texture(uMask, (xz - uMaskRect.xy) / uMaskRect.zw).r) * 0.45 * uShadowAmt;
}
`;

const GROUND_FRAG = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec4 uRect;
uniform sampler2D uWind;
uniform vec3 uCamera;
uniform vec2 uDir;
uniform vec3 uSoil;
uniform vec3 uMeadow;
out vec4 outColor;
${NOISE}
${FOG}
${LIGHT_LIB}
${SHADOW_LIB}
void main() {
  vec2 uv = clamp((vWorld.xz - uRect.xy) / uRect.zw, 0.0, 1.0);
  vec3 w = texture(uWind, uv).rgb;
  float d = distance(uCamera, vWorld);
  vec2 perp = vec2(-uDir.y, uDir.x);
  float streak = vnoise(vec2(dot(vWorld.xz, perp) * 1.6, dot(vWorld.xz, uDir) * 0.25));
  float mottle = clamp(w.r * 0.65, 0.0, 1.0);
  // The floor is painted as a mat of low, dark growth (fine fibres combed with the wind, over mossy clumps),
  // so wherever the blades thin out it reads as shaded undergrowth, never as bare ground.
  float fibre = vnoise(vec2(dot(vWorld.xz, perp) * 6.5, dot(vWorld.xz, uDir) * 1.4) + 3.0);
  float clump = vnoise(vWorld.xz * 2.3 + 8.0) * 0.6 + vnoise(vWorld.xz * 5.1) * 0.4;
  vec3 c = mix(uMeadow * 0.16, uMeadow * 0.5, clamp(fibre * 0.55 + clump * 0.45, 0.0, 1.0));
  c = mix(c, c * vec3(0.8, 1.0, 0.9), smoothstep(0.55, 0.8, clump));          // cooler, mossier clumps
  c *= 0.8 + 0.3 * mottle + 0.15 * streak;
  c = mix(uSoil, c, 0.92);
  float vis = sunShadowSoft(vWorld + vec3(0.0, 0.05, 0.0)) * cloudLight(vWorld.xz);
  c *= mix(0.5, 1.0, vis);
  c *= 1.0 - 0.7 * rockShadow(vWorld.xz);
  outColor = vec4(applyFog(c, d, mistAt(vWorld) * 0.4, vis), 1.0);        // the floor sits under the growth: it takes little mist
}`;

// ---- the logo rock -------------------------------------------------------------------------------
// The logo's silhouette becomes a line of weathered boulders. The shape is a height field built from a signed
// distance texture of the logo: steep flanks and a broad crown, broken into fitted blocks (Voronoi cells, each with
// its own height and tilt, with joints between them), then eroded with ridged noise and a few cracks. It is baked
// once into a texture (ROCK_BAKE_FRAG); the mesh, the normals and the shading all read that texture, so the shape
// function can be as rich as it likes. The surface is a scanned rock, projected along the three world axes.
const ROCK_BAKE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSdf;
uniform vec2 uExtent;      // padded logo rectangle, in logo units (long side of the logo = 1)
uniform float uDMax, uRb, uNoise, uFreq, uRough, uSeed, uInflate, uBlocks;
out vec4 outColor;
${NOISE}
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// x: distance to the nearest cell border, y: a random number per cell, zw: vector to the cell's centre
vec4 cells(vec2 x) {
  vec2 n = floor(x), f = fract(x), mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash2(n + g) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 r = g + hash2(n + g) - f;
    if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec4(md, hash(n + mg + 7.7), mr);
}
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec2 p = (uv - 0.5) * uExtent;
  float d = (textureLod(uSdf, uv, 0.0).r - 0.5) * 2.0 * uDMax + uInflate;   // signed distance to the logo's edge (+ inside), grown by Inflate
  float nz = 0.65 * vnoise(p * uFreq + uSeed) + 0.35 * vnoise(p * uFreq * 2.1 + uSeed * 1.3) - 0.5;
  d += nz * uNoise * 0.04;                                                  // lumpy outline (absolute size, so it can't cut thin strokes apart)
  d += (vnoise(p * uFreq * 9.0 + uSeed * 2.3) - 0.5) * uNoise * 0.012;      // small chips along the edge
  float h = 0.0;
  if (d > 0.0) {
    vec2 q = p * uFreq * 1.3 + uSeed;
    q += (vec2(vnoise(p * uFreq * 2.0 + 3.0), vnoise(p * uFreq * 2.0 + 9.0)) - 0.5) * 0.4;   // warped, so joints are never straight
    vec4 cl = cells(q);
    float joint = pow(smoothstep(0.0, 0.16, cl.x), 0.6);                    // 0 in the gap between two blocks
    float x = clamp(d / uRb, 0.0, 1.0);
    float prof = 1.0 - pow(1.0 - x, 2.6);                                   // steep flank, broad crown
    h = prof * mix(1.0, 0.62 + 0.6 * cl.y, uBlocks);                        // every block its own height
    vec2 tilt = (hash2(vec2(cl.y * 91.0, cl.y * 37.0)) - 0.5) * 0.9 * uBlocks;
    h += dot(cl.zw, tilt) * 0.22 * prof;                                    // ...and its own tilted top
    h *= mix(1.0, 0.5 + 0.5 * joint, uBlocks);
    float ridge = 1.0 - abs(2.0 * vnoise(p * uFreq * 2.6 + uSeed * 1.7) - 1.0);
    h += uRough * ((fbm(p * uFreq * 3.0 + uSeed * 0.5) - 0.5) * 0.16 + (ridge - 0.5) * 0.08) * smoothstep(0.0, 0.3, prof);
    h += uRough * (fbm(p * uFreq * 11.0 + 2.0) - 0.5) * 0.05 * prof;        // fine weathering
    float cr = abs(vnoise(p * uFreq * 1.7 + uSeed * 3.1) - 0.5);
    h -= 0.07 * (1.0 - smoothstep(0.0, 0.02, cr)) * smoothstep(0.15, 0.5, prof);   // carved cracks
    h = max(h, 0.0);
  }
  outColor = vec4(h / 1.6, 0.0, 0.0, 1.0);                                  // in units of the Thickness dial
}`;

const ROCK_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;       // (x, z) in logo units, centred on the logo
uniform mat4 uVP;
uniform mat4 uModel;
uniform sampler2D uHeight;
uniform vec2 uExtent;
uniform float uHScale;
out vec2 vP;
out vec3 vWorld;
out float vH;
void main() {
  float h = textureLod(uHeight, aPos / uExtent + 0.5, 0.0).r * uHScale;
  vec4 w = uModel * vec4(aPos.x, h, aPos.y, 1.0);
  vP = aPos;
  vH = h;
  vWorld = w.xyz;
  gl_Position = uVP * w;
}`;

const ROCK_DEPTH_FRAG = `#version 300 es
precision highp float;
in float vH;
void main() {
  if (vH < 1e-4) discard;
}`;

const DEPTH_FRAG = `#version 300 es
precision highp float;
void main() {}`;

const ROCK_FRAG = `#version 300 es
precision highp float;
in vec2 vP;
in vec3 vWorld;
uniform mat4 uModel;
uniform vec3 uCamera, uSun, uSunColor, uSky, uStone, uMoss, uSunObj, uBounce;
uniform float uBright, uMossAmt, uAmbient, uSunlight, uDetail, uShadow, uHScale;
uniform sampler2D uHeight;
uniform vec2 uExtent, uHTexel;
uniform sampler2D uAlb, uNor, uArm;      // scanned rock: colour, normal, (occlusion, roughness)
uniform float uScanAmt, uScanScale;
uniform sampler2D uStoneTex;             // optional uploaded stone texture
uniform float uHasTex, uTexScale, uTexAmt, uTexBump;
out vec4 outColor;
${NOISE}
${FOG}
${LIGHT_LIB}
float H(vec2 p) { return texture(uHeight, p / uExtent + 0.5).r * uHScale; }
// two samples at different scales and angles, blended by a noise mask, so the texture's tiling never shows
vec3 stoneTex(vec2 p) {
  vec2 a = p * uTexScale;
  vec2 b = mat2(0.8, -0.6, 0.6, 0.8) * p * uTexScale * 0.43 + 0.37;
  return mix(texture(uStoneTex, a).rgb, texture(uStoneTex, b).rgb, smoothstep(0.3, 0.7, vnoise(p * 3.0 + 4.0)));
}
void main() {
  vec2 uv = vP / uExtent + 0.5;
  float h = H(vP);
  if (h <= 0.004 * uHScale) discard;                                    // outside the rock
  vec2 e = uHTexel * 1.5;
  vec3 nObj = normalize(vec3(-(H(vP + vec2(e.x, 0.0)) - H(vP - vec2(e.x, 0.0))) / (2.0 * e.x), 1.0,
                             -(H(vP + vec2(0.0, e.y)) - H(vP - vec2(0.0, e.y))) / (2.0 * e.y)));
  vec3 N = normalize(mat3(uModel) * nObj);

  // ---- scanned surface, projected along the three world axes so steep flanks don't stretch ----
  vec3 tp = vWorld * uScanScale;
  vec3 bw = pow(abs(N), vec3(4.0));
  bw /= bw.x + bw.y + bw.z;
  vec3 alb = texture(uAlb, tp.zy).rgb * bw.x + texture(uAlb, tp.xz).rgb * bw.y + texture(uAlb, tp.xy).rgb * bw.z;
  vec3 arm = texture(uArm, tp.zy).rgb * bw.x + texture(uArm, tp.xz).rgb * bw.y + texture(uArm, tp.xy).rgb * bw.z;
  vec3 tx = texture(uNor, tp.zy).xyz * 2.0 - 1.0, ty = texture(uNor, tp.xz).xyz * 2.0 - 1.0, tz = texture(uNor, tp.xy).xyz * 2.0 - 1.0;
  vec3 dn = vec3(0.0, tx.y, tx.x) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, tz.y, 0.0) * bw.z;
  N = normalize(N + dn * 0.9 * uDetail * uScanAmt);
  float occ = mix(1.0, arm.r, uScanAmt);
  float rough = mix(0.85, arm.g, uScanAmt);

  // ---- albedo ----
  float coarse = fbm(vP * 8.0 + 5.0);
  vec3 stone = mix(uStone * mix(0.78, 1.12, coarse), alb * (uStone / 0.62) * mix(0.88, 1.12, coarse), uScanAmt);
  if (uHasTex > 0.5) {
    vec3 tcol = stoneTex(vP);
    float l0 = dot(tcol, vec3(0.333));                                  // the texture's own relief, from its brightness
    float lx = dot(stoneTex(vP + vec2(0.003, 0.0)), vec3(0.333)), lz = dot(stoneTex(vP + vec2(0.0, 0.003)), vec3(0.333));
    N = normalize(N + mat3(uModel) * vec3(-(lx - l0), 0.0, -(lz - l0)) / length(uModel[0].xyz) * 8.0 * uTexBump);
    stone = mix(stone, tcol * 1.05 * (0.92 + 0.16 * coarse), uTexAmt);
  }
  // hollows against the blurred height: negative in joints and cracks
  float cav = clamp((h - textureLod(uHeight, uv, 4.0).r * uHScale) / uHScale * 2.4, -1.0, 0.4);
  // moss gathers on up-facing stone near the ground and in the joints; a dark, damp skirt where it meets the soil
  float up = smoothstep(0.55, 0.9, N.y);
  float lowness = 1.0 - smoothstep(0.0, 2.2, vWorld.y);
  float moss = clamp(uMossAmt * (up * smoothstep(0.42, 0.62, fbm(vP * 6.0 + 11.0) + lowness * 0.3) + max(-cav, 0.0) * 1.2), 0.0, 1.0);
  vec3 c = mix(stone, uMoss * (0.75 + 0.5 * vnoise(vP * 70.0)), moss);
  rough = mix(rough, 1.0, moss);
  c = mix(c, uMoss * 0.55, (1.0 - smoothstep(0.15, 1.3, vWorld.y)) * min(uMossAmt * 1.6, 0.6));
  c = mix(c, vec3(0.13, 0.12, 0.08), (1.0 - smoothstep(0.0, 0.6, vWorld.y)) * 0.7);

  // ---- light ----
  float ao = occ * clamp(1.0 + cav, 0.3, 1.2) * mix(0.45, 1.0, smoothstep(0.0, 1.4, vWorld.y));
  float sh = 1.0;
  float Llen = length(uSunObj.xz) + 1e-4;
  vec2 Lh = uSunObj.xz / Llen;
  float slope = uSunObj.y / Llen;
  for (int i = 1; i <= 10; i++) {                                       // fine self-shadowing: march toward the sun across the height field
    float t = float(i) * 0.012;
    sh = min(sh, 1.0 - smoothstep(0.0, 0.02, H(vP + Lh * t) - (h + t * slope)));
  }
  sh = mix(1.0, sh, uShadow) * mix(1.0, sunShadowSoft(vWorld + N * 0.3 + uSun * 0.35), uShadow) * cloudLight(vWorld.xz);
  vec3 view = normalize(uCamera - vWorld);
  float diff = max(dot(N, uSun), 0.0);
  vec3 ambient = mix(uBounce, uSky * 1.15, N.y * 0.5 + 0.5) * uAmbient * 1.55;   // sky from above, green bounce off the grass from the sides
  float spec = pow(max(dot(N, normalize(uSun + view)), 0.0), mix(48.0, 6.0, rough)) * (1.0 - rough) * 0.5;
  c = c * (ambient * ao + uSunColor * diff * sh * uSunlight) * uBright + uSunColor * spec * sh * uSunlight * 0.4;
  outColor = vec4(applyFog(c, distance(uCamera, vWorld), mistAt(vWorld), sh), 1.0);
}`;

// depth = true builds the variant drawn into the shadow map (it must not read the map it is writing).
const bladeVert = (depth) => `#version 300 es
precision highp float;
layout(location=0) in vec2 aBlade;   // x: side (-1|1), y: t along the blade
layout(location=1) in vec2 aRoot;    // root xz
layout(location=2) in vec4 aShape;   // height, half width, yaw offset, twist
layout(location=3) in vec2 aRand;    // shade, per-blade random
layout(location=4) in vec4 aClump;   // tuft tone, dryness, tuft phase, unused
uniform mat4 uVP;
uniform float uTime;
uniform float uWind;
uniform float uHeight;
uniform float uHeightContrast;
uniform float uWidthMul;
uniform float uTaper;
uniform float uCurl;
uniform float uBaseBend;
uniform float uGustBend;
uniform float uFlutter;
uniform float uStiff;
uniform vec2 uDir;
uniform vec3 uCamera;
uniform vec3 uThin;      // thinning start, end, keep fraction at the far edge
uniform vec4 uRect;
uniform sampler2D uWindTex;
uniform sampler2D uMask;     // top-down footprint of the rock
uniform vec4 uMaskRect;
uniform vec3 uOver;          // share of blades kept in the rock's joints / their height multiplier, extra height in the skirt around it
uniform sampler2D uRockH;    // the rock's baked height field
uniform vec4 uRockXf;        // world -> logo: position x, z, then cos and sin of the yaw over the scale
uniform vec3 uRockDim;       // logo rectangle (x, z) and the world height of a full-scale texel
uniform float uRockOn, uRockLift;
// World height of the rock's surface above this ground point (-1 where there is no rock). lod > 0 reads a blurred copy.
float rockY(vec2 xz, float lod) {
  vec2 d = xz - uRockXf.xy;
  vec2 uv = vec2(uRockXf.z * d.x - uRockXf.w * d.y, uRockXf.w * d.x + uRockXf.z * d.y) / uRockDim.xy + 0.5;
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return -1.0;
  float h = textureLod(uRockH, uv, lod).r;
  return h > 0.003 ? h * uRockDim.z + uRockLift : -1.0;
}
uniform float uHead;         // 1 for the seed-head stalk layer
uniform vec3 uSun;
${NOISE}
${FOG}
${depth ? "" : LIGHT_LIB}
out float vSun;
out float vMist;
out float vHead;
out vec3 vNormal;
out vec3 vSideVec;
out vec3 vWorld;
out float vSide;
out float vT;
out float vShade;
out float vGust;
out float vTone;
out float vDry;

void main() {
  float t = aBlade.y;
  // Distance thinning: full density near the camera, fading far away. The keep/drop choice
  // is fixed per blade, so nothing flickers. Survivors are widened to keep coverage.
  float dCam = distance(uCamera, vec3(aRoot.x, 0.0, aRoot.y));
  float keepD = mix(1.0, uThin.z, smoothstep(uThin.x, uThin.y, dCam));
  float inside = textureLod(uMask, clamp((aRoot - uMaskRect.xy) / uMaskRect.zw, 0.0, 1.0), 0.0).r;
  float skirt = smoothstep(0.02, 0.4, inside) * (1.0 - smoothstep(0.45, 0.62, inside));  // the uncut fringe pressed against the stone
  float keepP = keepD;
  float keepR = fract(aRand.y * 97.31 + aRand.x * 13.7);
  float widen = pow(1.0 / keepD, 0.7);

  vec4 w4 = textureLod(uWindTex, clamp((aRoot - uRect.xy) / uRect.zw, 0.0, 1.0), 0.0);
  float gust = w4.r;
  vec2 dir0 = normalize((w4.gb - 0.5) * 2.0 + vec2(1e-4));
  float yaw = aShape.z * 0.6;
  vec2 dir = vec2(dir0.x * cos(yaw) - dir0.y * sin(yaw), dir0.x * sin(yaw) + dir0.y * cos(yaw));
  vec2 baseDir = uDir;

  // Constant-curvature arc: total bend A grows with the gust, length is preserved. Each blade
  // has its own stiffness, and a ripple travels through the stand.
  float stiff = mix(1.0, 0.7 + aRand.y * 0.6, uStiff);
  float A = (uBaseBend + gust * uGustBend) * uWind * stiff * mix(1.0, 0.62, uHead);
  A += sin(dot(aRoot, baseDir) * 1.9 - uTime * 3.2 + aClump.z * 6.0) * 0.11 * (0.25 + gust) * uFlutter;
  A += sin(uTime * 2.4 + aRand.y * 40.0 + t * 2.0) * 0.06 * (0.3 + gust) * (0.4 + w4.a) * uFlutter;
  A = clamp(A, 0.15, 2.5);
  float H = 1.5 * pow(max(aShape.x, 0.01) / 1.5, uHeightContrast) * uHeight * (1.0 + uOver.z * skirt);
  // The stone is solid. A blade rooted under it is removed, except in a joint or crack, where a few short ones
  // grow out of the rock's surface. A blade rooted beside it that the wind would lay into the stone stands up
  // against it instead.
  float baseY = 0.0;
  if (uRockOn > 0.5) {
    float r0 = rockY(aRoot, 0.0);
    if (r0 > 0.3) {
      float hollow = rockY(aRoot, 4.5) - r0;                   // below its surroundings: a joint between blocks, or a crack
      if (hollow > 0.2 && keepR < uOver.x) { baseY = r0 - 0.06; H *= uOver.y; A = min(A, 0.9); }
      else keepP = -1.0;
    } else {
      float ahead = max(rockY(aRoot + dir * H * 0.35, 0.0), rockY(aRoot + dir * H * 0.75, 0.0));
      A = mix(A, 0.15, smoothstep(0.15, 0.7, ahead));
    }
  }
  float theta = A * t;
  float out_ = H * (1.0 - cos(theta)) / A;
  float up = H * sin(theta) / A;

  vec2 side2 = vec2(-dir.y, dir.x);
  float tw = aShape.w;
  side2 = vec2(side2.x * cos(tw) - side2.y * sin(tw), side2.x * sin(tw) + side2.y * cos(tw));

  // Widest just above the root, tapering toward the tip.
  float taper = mix(0.5, 1.0, smoothstep(0.0, 0.12, t)) * pow(max(1.0 - t, 0.0), uTaper) + 0.02 * (1.0 - t);
  float curl = (fract(aRand.y * 91.7) - 0.5) * 0.55 * H * t * t * uCurl * (1.0 - 0.7 * uHead);   // natural sideways droop
  // seed heads: a hair-thin stem that swells into a slim spindle over its top third
  if (uHead > 0.5) taper = 0.16 * (1.0 - 0.5 * t) + 0.95 * pow(sin(clamp((t - 0.68) / 0.32, 0.0, 1.0) * 3.14159), 0.8);

  vec3 world = vec3(aRoot.x, baseY, aRoot.y);
  world.xz += dir * out_ + side2 * (aBlade.x * aShape.y * uWidthMul * widen * taper + curl);
  world.y += up;

  vec3 tangent = vec3(dir.x * sin(theta), cos(theta), dir.y * sin(theta));
  vSideVec = vec3(side2.x, 0.0, side2.y);
  vNormal = normalize(cross(vSideVec, tangent));
  vWorld = world;
  vSide = aBlade.x;
  vT = t;
  vShade = aRand.x;
  vTone = aClump.x;
  vDry = aClump.y;
  vGust = clamp(gust * 0.7 + (A - 0.8) * 0.25, 0.0, 1.0);
  vHead = uHead * smoothstep(0.66, 0.74, t);
  vMist = mistAt(world);
  // sun reaching this point: drifting cloud shadow, and the shadow map looked up a little toward the sun so a
  // blade is shaded by its neighbours rather than by itself
  vSun = ${depth ? "1.0" : "cloudLight(world.xz) * sunShadow(world + uSun * 0.3 + vec3(0.0, 0.04, 0.0))"};
  gl_Position = uVP * vec4(world, 1.0);
  if (keepR > keepP) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // outside the clip volume: no fragments are shaded
}`;

const BLADE_FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vSideVec;
in vec3 vWorld;
in float vSide;
in float vT;
in float vShade;
in float vGust;
in float vTone;
in float vDry;
in float vSun;
in float vMist;
in float vHead;
uniform vec3 uCamera;
uniform vec3 uThin;      // same uniform as the vertex shader: where thinning starts/ends
uniform vec3 uMeadow, uFresh, uCool, uStraw, uTipColor, uDryTip, uSoil, uSeedColor;
uniform float uGustSheen;
uniform float uSat, uBright, uToneVar, uPatch, uPatchSize, uDryStrength, uDryTips, uLaneBright;
${SHADOW_LIB}
uniform vec3 uSun, uSunColor, uSky, uBackColor;
uniform float uSunlight, uAmbient, uBacklight, uSheen, uCanopy, uRoot, uCrease, uUnderside;
out vec4 outColor;
${NOISE}
${FOG}
void main() {
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  n = normalize(n + vSideVec * vSide * uCrease);            // central crease: one half catches light, one falls away
  vec3 view = normalize(uCamera - vWorld);
  float wrap = pow(clamp(dot(n, uSun) * 0.5 + 0.5, 0.0, 1.0), 1.4);
  float glow = pow(max(dot(-n, uSun), 0.0), 1.3);
  float sheen = pow(max(dot(n, normalize(uSun + view)), 0.0), 18.0);

  float tone = clamp(0.5 + (vTone - 0.5) * uToneVar, 0.0, 1.0);
  vec3 base = mix(uMeadow, uFresh, tone);
  base = mix(base, uCool, smoothstep(0.65, 1.0, vShade) * 0.55);
  base = mix(base, uStraw, clamp(vDry * uDryStrength, 0.0, 1.0) * 0.6);
  base *= vec3(0.86 + 0.28 * fract(vShade * 13.7), 0.9 + 0.2 * fract(vShade * 31.1), 0.8 + 0.4 * fract(vShade * 7.3));
  base *= 0.82 + 0.36 * fract(vShade * 53.9);
  float patchTone = vnoise(vWorld.xz * 0.10 * uPatchSize) * 0.65 + vnoise(vWorld.xz * 0.27 * uPatchSize + 9.0) * 0.35;   // lusher / drier / cooler patches
  base = mix(base, base * vec3(1.28, 1.10, 0.62), smoothstep(0.50, 0.72, patchTone) * 0.65 * uPatch);
  base = mix(base, base * vec3(0.78, 1.0, 1.12), smoothstep(0.42, 0.25, patchTone) * 0.5 * uPatch);
  float luma = dot(base, vec3(0.299, 0.587, 0.114));
  base = mix(vec3(luma), base, uSat) * uBright;

  float farFade = smoothstep(uThin.x * 1.4, uThin.y * 1.2, distance(uCamera, vWorld));   // no root darkening far away: it only shimmers
  vec3 tip = mix(base * 1.2, uTipColor, 0.25);
  vec3 c = mix(uSoil, base, mix(smoothstep(0.0, 0.45, vT), 1.0, farFade * 0.7));
  c = mix(c, tip, smoothstep(0.35, 1.0, vT) * (0.15 + vGust * 0.85));
  float dryTip = step(1.0 - clamp(uDryTips * 0.28, 0.0, 1.0), fract(vShade * 29.3)) * smoothstep(0.78, 1.0, vT);   // some blades are browned at the tip
  c = mix(c, uDryTip * (0.8 + 0.4 * vTone), dryTip * 0.8);
  c = mix(c, uSeedColor * (0.75 + 0.5 * fract(vShade * 17.3)), vHead);       // the seed head itself

  float canopy = mix(1.0 - 0.55 * uCanopy, 1.0, smoothstep(0.0, 1.6, vWorld.y));   // short blades sit in the shade of tall ones
  float ao = mix(1.0, mix(1.0 - 0.38 * uRoot, 1.0, smoothstep(0.0, 0.5, vT)) * canopy, 1.0 - farFade);
  vec3 ambient = mix(vec3(0.27, 0.31, 0.16), uSky, n.y * 0.5 + 0.5) * uAmbient;
  ao = mix(ao, 1.0, vHead);
  c *= (ambient + wrap * uSunColor * uSunlight * vSun) * ao;
  if (!gl_FrontFacing) c = mix(c, c * vec3(1.14, 1.14, 1.0) + vec3(0.025, 0.03, 0.0), uUnderside);   // paler underside where blades flip
  c *= mix(1.0 - uLaneBright, 1.0 + uLaneBright, vGust);
  c += uBackColor * glow * (0.20 + vT * 0.55) * (0.5 + vGust * 0.5 + vHead) * ao * uBacklight * vSun;   // sun glowing through the blade
  c += vec3(0.85, 0.92, 0.70) * sheen * uSheen * smoothstep(0.2, 1.0, vT) * vSun;
  // combed-flat grass in a gust turns its face to the sky and flashes pale: the silver wave that crosses a meadow
  float flash = pow(max(dot(n, normalize(uSun + view)), 0.0), 7.0) * vGust * smoothstep(0.25, 1.0, vT);
  c += uSunColor * flash * uGustSheen * vSun;
  c *= mix(0.8, 1.0, abs(vSide));                          // darker midrib, lighter edges
  c *= 1.0 - 0.6 * rockShadow(vWorld.xz) * mix(1.0, 0.55, vT);   // the rock's shadow, deeper low in the grass
  outColor = vec4(applyFog(c, distance(uCamera, vWorld), vMist * mix(0.45, 1.0, smoothstep(0.0, 0.6, vT)), vSun), 1.0);
}`;

// ---- flowers -----------------------------------------------------------------------------------
// Each flower is a thin swaying stem (a strip, same constant-curvature bend as the blades but stiffer)
// plus a small five-petal head: a quad at the stem tip, tilted partly toward the sky so it reads from above.
const FLOWER_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aV;        // x: side / corner x, y: t along stem / corner y, z: 0 stem, 1 head
layout(location=1) in vec2 aRoot;
layout(location=2) in vec4 aFlower;   // stem height, head size, colour pick, random
uniform mat4 uVP;
uniform float uTime, uWind, uSize, uHeight, uBend;
uniform vec4 uRect;
uniform sampler2D uWindTex;
uniform sampler2D uMask;
uniform vec4 uMaskRect;
uniform vec3 uPal[6];
uniform vec3 uSun;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vPart;
out float vT;
out vec3 vColor;
out vec3 vLight;    // sun direction in the head's own (uv, normal) frame
out float vSeed;
out float vSun;
${NOISE}
${LIGHT_LIB}
void main() {
  vec4 w4 = textureLod(uWindTex, clamp((aRoot - uRect.xy) / uRect.zw, 0.0, 1.0), 0.0);
  float inside = textureLod(uMask, clamp((aRoot - uMaskRect.xy) / uMaskRect.zw, 0.0, 1.0), 0.0).r;
  vec2 dir = normalize((w4.gb - 0.5) * 2.0 + vec2(1e-4));
  float gust = w4.r;
  float A = (0.5 + gust * 0.9) * uWind * uBend * (0.75 + aFlower.w * 0.5);
  A += sin(uTime * 2.8 + aFlower.w * 40.0) * 0.07 * (0.3 + gust);
  A = clamp(A, 0.12, 1.9);
  float H = aFlower.x * uHeight;
  float t = aV.z < 0.5 ? aV.y : 1.0;
  float theta = A * t;
  vec3 tip = vec3(aRoot.x, 0.0, aRoot.y) + vec3(dir.x * H * (1.0 - cos(theta)) / A, H * sin(theta) / A, dir.y * H * (1.0 - cos(theta)) / A);
  vec2 side2 = vec2(-dir.y, dir.x);
  vec3 tang = normalize(vec3(dir.x * sin(A), cos(A), dir.y * sin(A)));
  vec3 world;
  vPart = aV.z;
  vT = aV.y;
  if (aV.z < 0.5) {
    world = tip + vec3(side2.x, 0.0, side2.y) * aV.x * 0.022 * (1.0 - 0.35 * aV.y);
    vNormal = vec3(0.0, 1.0, 0.0);
  } else {
    vec3 n = normalize(mix(tang, vec3(0.0, 1.0, 0.0), 0.6));
    vec3 r = abs(n.z) > 0.98 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 0.0, 1.0), n));
    vec3 u = cross(n, r);
    float ang = aFlower.w * 6.2831;
    vec2 c = vec2(aV.x * cos(ang) - aV.y * sin(ang), aV.x * sin(ang) + aV.y * cos(ang));
    world = tip + (r * c.x + u * c.y) * aFlower.y * uSize * 0.5 + n * 0.01;
    vNormal = n;
    float sr = dot(uSun, r), su = dot(uSun, u);
    vLight = vec3(sr * cos(ang) + su * sin(ang), -sr * sin(ang) + su * cos(ang), dot(uSun, n));
  }
  vUv = aV.xy;
  vSeed = aFlower.w;
  vColor = uPal[int(clamp(aFlower.z, 0.0, 0.999) * 6.0)];
  vSun = cloudLight(tip.xz) * sunShadow(tip + uSun * 0.3);
  vWorld = world;
  gl_Position = uVP * vec4(world, 1.0);
  if (inside > 0.3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);    // not under the character
}`;

// Shared by the planted flowers and the airborne ones. Flat and matte on purpose (no dimensional shading, which
// read as plastic), but organic: petals differ in length, some flowers have six petals, tone drifts petal to petal.
const FLOWER_LIB = `
float fh(float x) { return fract(sin(x * 127.1 + 17.3) * 43758.5453); }
float petalCount(float seed) { return fh(seed * 9.1) < 0.3 ? 6.0 : 5.0; }
float outline(vec2 p, float seed) {
  float n = petalCount(seed);
  float a = atan(p.y, p.x);
  float idx = floor(a * n / 6.2831853 + 0.5);
  float len = 1.0 + 0.2 * (fh(idx + seed * 31.0) - 0.5);                 // unequal petals
  return (0.6 + 0.3 * cos(n * a)) * len;
}
vec4 flowerHead(vec2 uv, vec3 base, vec3 center, vec3 light, float seed) {
  float n = petalCount(seed);
  float a = atan(uv.y, uv.x);
  float r = length(uv);
  float petal = outline(uv, seed);
  float edge = petal - r;
  if (edge < 0.0) return vec4(0.0);
  float pr = r / petal;
  float idx = floor(a * n / 6.2831853 + 0.5);

  // Flat and matte: no dome lighting at all. Only a little organic variation: each petal is a slightly
  // different tone, tips a touch lighter than the throat, faint radial veins.
  vec3 c = base * (0.94 + 0.12 * fh(idx + seed * 17.0));
  c = mix(c * 0.93, min(c * 1.03 + 0.02, vec3(1.0)), smoothstep(0.1, 0.95, pr));
  float vein = smoothstep(0.82, 1.0, abs(cos(a * n * 2.0 + idx)));
  c *= 1.0 - 0.05 * vein * smoothstep(0.2, 0.9, pr);
  // fuzzy speckled centre
  float disc = 1.0 - smoothstep(0.17, 0.27, r + (fh(floor(uv.x * 16.0) + floor(uv.y * 16.0) * 7.0 + seed * 5.0) - 0.5) * 0.06);
  float fleck = fh(floor(uv.x * 22.0) * 3.0 + floor(uv.y * 22.0) * 11.0 + seed * 3.0);
  c = mix(c, center * (0.82 + 0.3 * fleck), disc);
  return vec4(c, smoothstep(0.0, 0.09, edge));
}
`;

const FLOWER_FRAG = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vPart;
in float vT;
in vec3 vColor;
in vec3 vLight;
in float vSeed;
in float vSun;
uniform vec3 uCamera, uSun, uSunColor, uSky, uCenter;
out vec4 outColor;
${NOISE}
${FOG}
${FLOWER_LIB}
void main() {
  float d = distance(uCamera, vWorld);
  vec3 N = normalize(gl_FrontFacing ? vNormal : -vNormal);
  float lit = 0.72 + 0.5 * max(dot(N, uSun), 0.0);
  if (vPart < 0.5) {
    vec3 c = mix(vec3(0.16, 0.33, 0.10), vec3(0.33, 0.52, 0.17), vT) * lit * mix(0.5, 1.0, vSun);
    outColor = vec4(applyFog(c, d, mistAt(vWorld), vSun), 1.0);
    return;
  }
  vec4 fl = flowerHead(vUv, vColor, uCenter, vLight, vSeed);
  if (fl.a <= 0.0) discard;
  vec3 light = mix(uSky * 0.9 + 0.12, uSunColor * 1.25, vSun);                // petals take the colour of the light they sit in
  outColor = vec4(applyFog(fl.rgb * light, d, mistAt(vWorld), vSun), fl.a);                                 // alpha-to-coverage softens the edge under MSAA
}`;

// ---- wind debris: flowers only ---------------------------------------------------------------
// Stateless particles: each one lives in a repeating cycle. At the start of a cycle it picks a spot in the
// field; it only shows (and lifts off) while a strong gust is passing over that spot, then rises, tumbles and
// is carried downwind, shrinking away at the end of its life.
const PARTICLE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSeed;
uniform mat4 uVP;
uniform float uTime, uLife, uLift, uSpeed, uSize, uThreshold;
uniform vec4 uSpawn;
uniform vec4 uRect;
uniform sampler2D uWindTex;
uniform vec3 uCamRight, uCamUp, uSun;
uniform vec3 uPal[6];
out vec2 vUv;
out vec3 vColor;
out vec3 vWorld;
out vec3 vLight;
out float vSeed;
float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  float T = uLife * (0.7 + 0.6 * aSeed.x);
  float cyc = uTime / T + aSeed.y;
  float k = floor(cyc);
  float u = fract(cyc);
  float age = u * T;
  vec2 sp = uSpawn.xy + vec2(h11(k * 1.37 + aSeed.z * 91.0), h11(k * 2.71 + aSeed.w * 57.0)) * uSpawn.zw;
  vec4 w = textureLod(uWindTex, clamp((sp - uRect.xy) / uRect.zw, 0.0, 1.0), 0.0);
  float gate = smoothstep(uThreshold, uThreshold + 0.2, w.r);
  vec2 dir = normalize((w.gb - 0.5) * 2.0 + vec2(1e-4));

  float rise = 1.0 - exp(-u * 4.0);
  float y = 0.3 + uLift * (1.2 + 3.5 * aSeed.z) * rise * (0.75 + 0.25 * sin(u * 9.0 + aSeed.w * 6.283));
  vec2 drift = dir * uSpeed * (2.5 + 3.0 * aSeed.x) * age + vec2(-dir.y, dir.x) * sin(age * 2.0 + aSeed.z * 6.283) * 0.7;
  vec3 world = vec3(sp.x + drift.x, y, sp.y + drift.y);

  float s = smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.72, 1.0, u)) * gate;
  float ang = age * (1.0 + 3.0 * aSeed.y) + aSeed.w * 6.283;
  vec2 c = vec2(aCorner.x * cos(ang) - aCorner.y * sin(ang), aCorner.x * sin(ang) + aCorner.y * cos(ang));
  world += (uCamRight * c.x + uCamUp * c.y) * uSize * 0.14 * s;

  vec3 n = cross(uCamRight, uCamUp);
  float sr = dot(uSun, uCamRight), su = dot(uSun, uCamUp);
  vLight = vec3(sr * cos(ang) + su * sin(ang), -sr * sin(ang) + su * cos(ang), dot(uSun, n));
  vSeed = aSeed.x;
  vUv = aCorner;
  vColor = uPal[int(fract(aSeed.x * 11.3) * 5.99)];
  vWorld = world;
  gl_Position = uVP * vec4(world, 1.0);
  if (s < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const PARTICLE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vColor;
in vec3 vWorld;
in vec3 vLight;
in float vSeed;
uniform vec3 uCamera, uCenter, uTint;
out vec4 outColor;
${NOISE}
${FOG}
${FLOWER_LIB}
void main() {
  vec4 fl = flowerHead(vUv, vColor, uCenter, vLight, vSeed);
  if (fl.a <= 0.0) discard;
  outColor = vec4(applyFog(fl.rgb * uTint, distance(uCamera, vWorld), mistAt(vWorld), 1.0), fl.a);
}`;

// ---- motes: pollen and dust hanging in the air, drifting downwind and catching the sun ---------------
// Stateless like the debris: each mote's place is its seed plus the wind's drift, wrapped inside the view.
const MOTE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSeed;
uniform mat4 uVP;
uniform float uTime, uSize;
uniform vec4 uSpawn;
uniform vec2 uDrift;
uniform vec3 uCamRight, uCamUp;
out vec2 vUv;
out float vGlow;
void main() {
  vec2 q = fract(aSeed.xy + uDrift / uSpawn.zw * (0.6 + 0.8 * aSeed.z));
  float edge = smoothstep(0.0, 0.06, q.x) * smoothstep(1.0, 0.94, q.x) * smoothstep(0.0, 0.06, q.y) * smoothstep(1.0, 0.94, q.y);
  vec3 world = vec3(uSpawn.x + q.x * uSpawn.z, 1.2 + aSeed.z * 5.5, uSpawn.y + q.y * uSpawn.w);
  world.y += sin(uTime * 0.6 + aSeed.w * 6.283) * 0.45;
  world.xz += vec2(sin(uTime * 0.43 + aSeed.x * 40.0), cos(uTime * 0.37 + aSeed.y * 40.0)) * 0.5;
  float twinkle = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (1.2 + 2.6 * aSeed.x) + aSeed.y * 40.0), 2.0);
  world += (uCamRight * aCorner.x + uCamUp * aCorner.y) * uSize * (0.035 + 0.05 * aSeed.w);
  vUv = aCorner;
  vGlow = twinkle * edge;
  gl_Position = uVP * vec4(world, 1.0);
}`;

const MOTE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in float vGlow;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  float a = max(1.0 - dot(vUv, vUv), 0.0);
  outColor = vec4(uColor * a * a * vGlow, 1.0);      // drawn additively
}`;

// ---- helpers ----------------------------------------------------------------

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

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function program(gl, vert, frag) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const cache = {};
  p.u = (name) => (cache[name] ??= gl.getUniformLocation(p, name));
  return p;
}

const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rad = (deg) => (deg * Math.PI) / 180;

const hexCache = new Map();
function hex(h) {
  let c = hexCache.get(h);
  if (!c) {
    const n = parseInt(String(h).replace("#", "").padEnd(6, "0").slice(0, 6), 16);
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    hexCache.set(h, c);
  }
  return c;
}

function camera(eye, target, roll, fovY, aspect) {
  const fwd = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const right = norm(cross(fwd, [Math.sin(roll), Math.cos(roll), 0]));
  const up = cross(right, fwd);
  const view = [right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0, -dot(right, eye), -dot(up, eye), dot(fwd, eye), 1];
  const f = 1 / Math.tan(fovY / 2), near = 0.1, far = 1500, nf = 1 / (near - far);
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  const vp = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      vp[c * 4 + r] = proj[r] * view[c * 4] + proj[4 + r] * view[c * 4 + 1] + proj[8 + r] * view[c * 4 + 2] + proj[12 + r] * view[c * 4 + 3];
  return { vp, right, up, fwd, tanY: Math.tan(fovY / 2), tanX: Math.tan(fovY / 2) * aspect };
}

// Blades grow in tufts. Tuft centres are scattered uniformly in screen space (random NDC
// points cast onto the ground), so density stays even however the perspective stretches;
// each tuft shares a tone, dryness, height and lean, which is what makes the field read as
// vegetation rather than noise.
const FLOATS = 12;

function makeBlades(gl, count, o) {
  const SEGMENTS = o.segments;
  const rand = rng(o.seed);
  const data = new Float32Array(count * FLOATS);
  const cam = camera(o.eye, o.target, 0, o.fov, o.aspect);
  const tufts = Math.ceil(count / o.perTuft);
  let i = 0;
  for (let k = 0; k < tufts && i < count; k++) {
    const nx = (rand() * 2 - 1) * 1.35;
    const ny = (rand() * 2 - 1) * 1.3;
    const dir = [
      cam.fwd[0] + nx * cam.tanX * cam.right[0] + ny * cam.tanY * cam.up[0],
      cam.fwd[1] + nx * cam.tanX * cam.right[1] + ny * cam.tanY * cam.up[1],
      cam.fwd[2] + nx * cam.tanX * cam.right[2] + ny * cam.tanY * cam.up[2],
    ];
    const dist = dir[1] < -0.05 ? Math.min(-o.eye[1] / dir[1], 90) : 90;
    const cx = o.eye[0] + dir[0] * dist;
    const cz = o.eye[2] + dir[2] * dist;

    const tone = 0.3 + rand() * 0.7;
    const dry = rand() < o.dryChance ? 0.3 + rand() * 0.4 : 0;
    const heightScale = o.stalks ? 1.5 + rand() * 0.7 : 0.4 + Math.pow(rand(), 1.6) * 1.3;   // mostly short, a few tall tufts; seed stalks stand above them
    const yawBias = (rand() - 0.5) * 0.35;
    const radius = (0.35 + rand() * 0.4) * o.radiusMul * Math.min(2.2, Math.max(0.8, dist / 14));   // far tufts grow so they still cover the ground
    const phase = rand();

    for (let j = 0; j < o.perTuft && i < count; j++, i++) {
      const r = radius * Math.sqrt(-2 * Math.log(1 - rand() * 0.98)) * 0.55;
      const a = rand() * Math.PI * 2;
      const b = i * FLOATS;
      const stalk = !o.stalks && rand() < 0.04;
      data[b] = cx + Math.cos(a) * r;
      data[b + 1] = cz + Math.sin(a) * r;
      data[b + 2] = 1.5 * heightScale * (o.stalks ? 0.8 + rand() * 0.4 : 0.55 + rand() * 0.9) * (1 - 0.3 * Math.min(1, r / (radius * 1.2))) * (stalk ? 1.7 : 1) * o.heightMul;
      data[b + 3] = 0.03 * o.widthMul * (1 + dist / 45) * (0.55 + rand() * 0.9) * (stalk ? 0.6 : 1);
      data[b + 4] = yawBias + (rand() - 0.5) * 0.7;
      data[b + 5] = (rand() - 0.5) * 1.6;
      data[b + 6] = Math.min(1, Math.max(0, rand() * 0.6 + tone * 0.4));
      data[b + 7] = rand();
      data[b + 8] = tone;
      data[b + 9] = dry;
      data[b + 10] = phase;
      data[b + 11] = 0;
    }
  }
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  // one strip for the picture, and (for layers that cast shadows) a coarser one for the shadow map
  const stripVao = (segments) => {
    const strip = new Float32Array((segments + 1) * 4);
    for (let s = 0; s <= segments; s++) strip.set([-1, s / segments, 1, s / segments], s * 4);
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, strip, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    [[1, 2, 0], [2, 4, 8], [3, 2, 24], [4, 4, 32]].forEach(([loc, size, off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS * 4, off);
      gl.vertexAttribDivisor(loc, 1);
    });
    gl.bindVertexArray(null);
    return { vao, buf };
  };
  const main = stripVao(SEGMENTS);
  const shadowSegs = o.stalks ? SEGMENTS : SHADOW_SEGMENTS;      // a seed head needs its segments to keep its shape
  const shadow = o.castShadow ? stripVao(shadowSegs) : null;
  return {
    vao: main.vao, shadowVao: shadow?.vao ?? null, buffers: [inst, main.buf, ...(shadow ? [shadow.buf] : [])],
    count, vertices: (SEGMENTS + 1) * 2, shadowVertices: (shadowSegs + 1) * 2, head: !!o.stalks, low: !!o.low,
  };
}

function destroyLayers(gl, layers) {
  layers.forEach((l) => {
    l.buffers.forEach((b) => gl.deleteBuffer(b));
    gl.deleteVertexArray(l.vao);
    if (l.shadowVao) gl.deleteVertexArray(l.shadowVao);
  });
}

// Depth-only target the sun "sees" the meadow through. Sampled with hardware comparison (sampler2DShadow).
function makeShadowTarget(gl, size) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, size };
}

// Orthographic view-projection looking down the sun's rays, fitted to a box over the ground rectangle
// [minX, minZ, sizeX, sizeZ] from y = -0.5 up to yMax.
function lightMatrix(sun, rect, yMax) {
  const f = [-sun[0], -sun[1], -sun[2]];
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const x of [rect[0], rect[0] + rect[2]]) for (const z of [rect[1], rect[1] + rect[3]]) for (const y of [-0.5, yMax]) {
    const q = [dot(r, [x, y, z]), dot(u, [x, y, z]), dot(f, [x, y, z])];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
  }
  lo[2] -= 2; hi[2] += 2;
  const sc = [0, 1, 2].map((k) => 2 / (hi[k] - lo[k]));
  const tr = [0, 1, 2].map((k) => -(hi[k] + lo[k]) / (hi[k] - lo[k]));
  return new Float32Array([
    r[0] * sc[0], u[0] * sc[1], f[0] * sc[2], 0,
    r[1] * sc[0], u[1] * sc[1], f[1] * sc[2], 0,
    r[2] * sc[0], u[2] * sc[1], f[2] * sc[2], 0,
    tr[0], tr[1], tr[2], 1,
  ]);
}

function makeGround(gl) {
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-900, 60, 900, 60, -900, -900, 900, -900]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, buf };
}

function makeWindTarget(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, WIND_RES, WIND_RES, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

// Offscreen scene target: an anti-aliased render buffer, resolved to a texture for post-processing.
function makeColorTarget(gl, w, h, internal, format, type, linear = false) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

// hdr: half-float colour, so sunlit tips can be brighter than white until the grade rolls them off (and bloom finds them).
function makeSceneTarget(gl, w, h, paint, samples, paintScale, hdr) {
  const ss = Math.min(samples, gl.getParameter(gl.MAX_SAMPLES));
  const msColor = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, ss, hdr ? gl.RGBA16F : gl.RGBA8, w, h);
  const msDepth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, ss, gl.DEPTH_COMPONENT24, w, h);
  const msFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);

  const resTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, resTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const resFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, resFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // painterly passes run at a fraction of the screen resolution
  const pw = Math.max(2, Math.round(w * paintScale)), ph = Math.max(2, Math.round(h * paintScale));
  const extra = paint
    ? {
        pw, ph,
        tensorA: makeColorTarget(gl, pw, ph, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
        tensorB: makeColorTarget(gl, pw, ph, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
        painted: makeColorTarget(gl, pw, ph, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, true),
      }
    : null;
  // bloom: two blurred levels, a quarter and an eighth of the picture
  const fmt = hdr ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
  const level = (div) => makeColorTarget(gl, Math.max(2, Math.round(w / div)), Math.max(2, Math.round(h / div)), ...fmt, true);
  const bloom = { a1: level(4), a2: level(4), b1: level(8), b2: level(8) };
  return { w, h, samples: samples, paintScale, msColor, msDepth, msFbo, resTex, resFbo, extra, bloom };
}

function destroySceneTarget(gl, t) {
  gl.deleteRenderbuffer(t.msColor);
  gl.deleteRenderbuffer(t.msDepth);
  gl.deleteFramebuffer(t.msFbo);
  gl.deleteTexture(t.resTex);
  gl.deleteFramebuffer(t.resFbo);
  Object.values(t.bloom).forEach((x) => {
    gl.deleteTexture(x.tex);
    gl.deleteFramebuffer(x.fbo);
  });
  if (t.extra) {
    Object.values(t.extra).filter((x) => x.tex).forEach((x) => {
      gl.deleteTexture(x.tex);
      gl.deleteFramebuffer(x.fbo);
    });
  }
}

// ---- flowers: clustered, so they read as little drifts of colour --------------------------------
const FLOWER_STEM_SEGMENTS = 6;

function makeFlowers(gl, count, o) {
  const rand = rng(o.seed + 501);
  const cam = camera(o.eye, o.target, 0, o.fov, o.aspect);
  const clusters = Math.max(1, Math.ceil(count / o.perCluster));
  const data = new Float32Array(count * 6);
  let i = 0;
  for (let k = 0; k < clusters && i < count; k++) {
    const nx = (rand() * 2 - 1) * 1.3;
    const ny = (rand() * 2 - 1) * 1.25;
    const dir = [
      cam.fwd[0] + nx * cam.tanX * cam.right[0] + ny * cam.tanY * cam.up[0],
      cam.fwd[1] + nx * cam.tanX * cam.right[1] + ny * cam.tanY * cam.up[1],
      cam.fwd[2] + nx * cam.tanX * cam.right[2] + ny * cam.tanY * cam.up[2],
    ];
    const dist = dir[1] < -0.05 ? Math.min(-o.eye[1] / dir[1], 70) : 70;
    const cx = o.eye[0] + dir[0] * dist;
    const cz = o.eye[2] + dir[2] * dist;
    const hue = rand();
    const radius = (0.8 + rand() * 1.2) * o.spread * Math.min(2.2, Math.max(0.8, dist / 14));
    for (let j = 0; j < o.perCluster && i < count; j++, i++) {
      const r = radius * Math.sqrt(-2 * Math.log(1 - rand() * 0.98)) * 0.5;
      const a = rand() * Math.PI * 2;
      const b = i * 6;
      data[b] = cx + Math.cos(a) * r;
      data[b + 1] = cz + Math.sin(a) * r;
      data[b + 2] = 0.9 + rand() * 0.8;                       // stem height (world units)
      data[b + 3] = (0.34 + rand() * 0.26) * (1 + dist / 70); // head diameter
      data[b + 4] = rand() < 0.78 ? hue : rand();            // colour pick: mostly the cluster's colour
      data[b + 5] = rand();
    }
  }
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  const makeVao = (verts) => {
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 24, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    return { vao, buf };
  };
  const stem = new Float32Array((FLOWER_STEM_SEGMENTS + 1) * 6);
  for (let s = 0; s <= FLOWER_STEM_SEGMENTS; s++) stem.set([-1, s / FLOWER_STEM_SEGMENTS, 0, 1, s / FLOWER_STEM_SEGMENTS, 0], s * 6);
  const head = new Float32Array([-1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1, 1]);
  const stemV = makeVao(stem), headV = makeVao(head);
  return { count: i, instBuf, stemV, headV, stemVerts: (FLOWER_STEM_SEGMENTS + 1) * 2, headVerts: 4 };
}

function destroyFlowers(gl, f) {
  if (!f) return;
  gl.deleteBuffer(f.instBuf);
  [f.stemV, f.headV].forEach((x) => { gl.deleteBuffer(x.buf); gl.deleteVertexArray(x.vao); });
}

// Fixed pool of debris particles (static random seeds; all motion is computed in the vertex shader).
function makeParticles(gl, max) {
  const rand = rng(77);
  const seeds = new Float32Array(max * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  const vao = gl.createVertexArray();
  const cornerBuf = gl.createBuffer();
  const seedBuf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  return { vao, bufs: [cornerBuf, seedBuf], max };
}

// Axis-aligned box on the ground covering what the camera sees (used as the debris spawn area).
function groundRect(eye, target, fov, aspect) {
  const cam = camera(eye, target, 0, fov, aspect);
  let mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9;
  for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const d = [0, 1, 2].map((k) => cam.fwd[k] + nx * 1.1 * cam.tanX * cam.right[k] + ny * 1.1 * cam.tanY * cam.up[k]);
    const t = d[1] < -0.05 ? Math.min(-eye[1] / d[1], 45) : 45;
    const x = eye[0] + d[0] * t, z = eye[2] + d[2] * t;
    mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mnz = Math.min(mnz, z); mxz = Math.max(mxz, z);
  }
  return [mnx, mnz, mxx - mnx, mxz - mnz];
}

// Six shades of a single base colour, from the base itself up to a paler tint. Never darker: darkening a yellow
// shifts it to ochre/brown, which looked wrong in the grass. `variation` sets how pale the lightest gets.
function flowerPalette(base, variation) {
  const out = new Float32Array(18);
  const c = hex(base);
  for (let n = 0; n < 6; n++) {
    const l = (n / 5) * variation;
    for (let k = 0; k < 3; k++) out[n * 3 + k] = c[k] + (1 - c[k]) * l * 0.65;
  }
  return out;
}

// ---- the logo rock: image -> distance field + grid mesh, and its top-down footprint --------------------

const ROCK_WORK = 512;          // working resolution (long side, pixels)
const ROCK_PAD = 0.14;          // empty margin around the logo, in logo units
const ROCK_DMAX = 0.12;         // distances are stored up to this many logo units
const MASK_RES = 256;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function boxBlur(a, w, h, r, passes) {
  const t = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        t[y * w + x] = sum / (2 * r + 1);
        sum += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / (2 * r + 1);
        sum += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x];
      }
    }
  }
}

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher): distance from every inside pixel to the nearest outside one.
function distanceInside(inside, w, h) {
  const INF = 1e20;
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = inside[i] ? INF : 0;
  const n = Math.max(w, h);
  const d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
  const dt = (len) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      while (true) {
        const p = v[k];
        s = ((d[q] + q * q) - (d[p] + p * p)) / (2 * q - 2 * p);
        if (s <= z[k]) k--; else break;
        if (k < 0) { k = 0; break; }
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      d[q] = (q - p) * (q - p) + d[p];
    }
  };
  const col = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) d[y] = f[y * w + x];
    dt(h);
    for (let y = 0; y < h; y++) col[y] = d[y], f[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) d[x] = f[y * w + x];
    dt(w);
    for (let x = 0; x < w; x++) f[y * w + x] = Math.sqrt(d[x]);
  }
  return f;
}

async function loadRock(gl, url = "/models/logo/logo.png", invert = false, floatOK = true) {
  const img = await loadImage(url);
  const srcW = img.naturalWidth || 512, srcH = img.naturalHeight || 512;   // SVGs without a size report 0
  const long = Math.max(srcW, srcH);
  const iw = srcW / long, ih = srcH / long;                         // logo size in logo units (long side = 1)
  const ew = iw + 2 * ROCK_PAD, eh = ih + 2 * ROCK_PAD;           // padded rectangle
  const cw = Math.round(ROCK_WORK * (ew / Math.max(ew, eh))), ch = Math.round(ROCK_WORK * (eh / Math.max(ew, eh)));
  const ppu = cw / ew;                                             // pixels per logo unit

  // draw the (tiny) logo smoothly upscaled
  const cv = document.createElement("canvas");
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cw / 2 - (iw / 2) * ppu, ch / 2 - (ih / 2) * ppu, iw * ppu, ih * ppu);
  const px = ctx.getImageData(0, 0, cw, ch).data;
  // the image's own rectangle inside the padded canvas; everything outside it is empty padding
  const x0 = Math.max(0, Math.round(cw / 2 - (iw / 2) * ppu)), x1 = Math.min(cw - 1, Math.round(cw / 2 + (iw / 2) * ppu) - 1);
  const y0 = Math.max(0, Math.round(ch / 2 - (ih / 2) * ppu)), y1 = Math.min(ch - 1, Math.round(ch / 2 + (ih / 2) * ppu) - 1);
  const luma = (i) => (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
  let anyAlpha = false;
  for (let y = y0 + 2; y <= y1 - 2 && !anyAlpha; y++) for (let x = x0 + 2; x <= x1 - 2; x++) if (px[(y * cw + x) * 4 + 3] < 250) { anyAlpha = true; break; }
  // Without transparency the background is whatever the image corners are: a dark logo on light paper (the usual
  // case) or a light logo on a dark ground. Detect which, so either works; `invert` flips it if that guess is wrong.
  const cornerLuma = [[x0 + 2, y0 + 2], [x1 - 2, y0 + 2], [x0 + 2, y1 - 2], [x1 - 2, y1 - 2]].reduce((acc, [x, y]) => acc + luma(y * cw + x), 0) / 4;
  const darkGround = cornerLuma < 0.45;
  const cover = new Float32Array(cw * ch);                          // how much of each pixel is the logo
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * cw + x;
      const v = anyAlpha ? px[i * 4 + 3] / 255 : darkGround ? luma(i) : 1 - luma(i);
      cover[i] = invert ? 1 - v : v;
    }
  }
  boxBlur(cover, cw, ch, 3, 2);                                     // smooths the pixel staircase of a 76px source
  const inside = new Uint8Array(cw * ch);
  for (let i = 0; i < inside.length; i++) inside[i] = cover[i] > 0.42 ? 1 : 0;

  // signed distance to the edge in logo units (positive inside, negative outside), lightly smoothed so the rock
  // reads as organic. Having the outside distance too lets the shape be grown (Inflate) to fatten thin strokes.
  const inDist = distanceInside(inside, cw, ch);
  const outside = new Uint8Array(cw * ch);
  for (let i = 0; i < outside.length; i++) outside[i] = inside[i] ? 0 : 1;
  const outDist = distanceInside(outside, cw, ch);
  const dl = new Float32Array(cw * ch);
  for (let i = 0; i < dl.length; i++) dl[i] = (inside[i] ? inDist[i] : -outDist[i]) / ppu;
  boxBlur(dl, cw, ch, 3, 3);
  const bytes = new Uint8Array(cw * ch);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round((dl[i] / (2 * ROCK_DMAX) + 0.5) * 255)));

  const sdf = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sdf);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cw, ch, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // white-on-transparent silhouette, used to draw the top-down footprint for the grass
  const sil = document.createElement("canvas");
  sil.width = cw; sil.height = ch;
  const sctx = sil.getContext("2d");
  const simg = sctx.createImageData(cw, ch);
  for (let i = 0; i < inside.length; i++) { simg.data[i * 4] = simg.data[i * 4 + 1] = simg.data[i * 4 + 2] = 255; simg.data[i * 4 + 3] = inside[i] ? 255 : 0; }
  sctx.putImageData(simg, 0, 0);

  // flat grid; heights come from the shader
  const long2 = Math.max(ew, eh);
  const nx = Math.max(8, Math.round(340 * (ew / long2))), nz = Math.max(8, Math.round(340 * (eh / long2)));
  const verts = new Float32Array((nx + 1) * (nz + 1) * 2);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) verts.set([(i / nx - 0.5) * ew, (j / nz - 0.5) * eh], (j * (nx + 1) + i) * 2);
  const idx = new Uint32Array(nx * nz * 6);
  let o = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.set([a, c, b, b, c, d], o); o += 6;
  }
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  // the baked height field (filled by bakeRock whenever a shape control moves)
  const hw = cw * 2, hh = ch * 2;
  const heightTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  if (floatOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, hw, hh, 0, gl.RED, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, hw, hh, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const heightFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, heightFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, heightTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { vao, vbo, ibo, sdf, count: idx.length, extent: [ew, eh], sil, cw, ch, heightTex, heightFbo, hw, hh, bakeKey: "" };
}

// Renders the rock's shape into its height texture. Thickness is not baked (it only scales the result).
function bakeRock(gl, prog, rock, ch, emptyVao) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, rock.heightFbo);
  gl.viewport(0, 0, rock.hw, rock.hh);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, rock.sdf);
  gl.uniform1i(prog.u("uSdf"), 2);
  gl.uniform2fv(prog.u("uExtent"), rock.extent);
  gl.uniform1f(prog.u("uDMax"), ROCK_DMAX);
  gl.uniform1f(prog.u("uRb"), ch.roundness);
  gl.uniform1f(prog.u("uNoise"), ch.jaggedness);
  gl.uniform1f(prog.u("uFreq"), ch.grain);
  gl.uniform1f(prog.u("uRough"), ch.roughness);
  gl.uniform1f(prog.u("uSeed"), ch.seed);
  gl.uniform1f(prog.u("uInflate"), ch.inflate);
  gl.uniform1f(prog.u("uBlocks"), ch.blocks);
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, rock.heightTex);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.activeTexture(gl.TEXTURE0);
}

function destroyRock(gl, r) {
  [r.vbo, r.ibo].forEach((b) => gl.deleteBuffer(b));
  gl.deleteVertexArray(r.vao);
  gl.deleteTexture(r.sdf);
  gl.deleteTexture(r.heightTex);
  gl.deleteFramebuffer(r.heightFbo);
}

// Model matrix (column-major): uniform scale (world units per logo unit), yaw about Y, translation.
function rockModel(ch) {
  const s = ch.scale, yaw = rad(ch.rotation), c = Math.cos(yaw), sn = Math.sin(yaw);
  return new Float32Array([s * c, 0, -s * sn, 0, 0, s, 0, 0, s * sn, 0, s * c, 0, ch.x, ch.lift, ch.z, 1]);
}

// Draws the rock's silhouette, seen from above, into a small R8 texture. Grass rooted inside it is thinned and
// shortened in the vertex shader so blades don't spear through the stone.
function buildRockMask(gl, tex, rock, ch) {
  const [ew, eh] = rock.extent;
  const r = Math.max(ew, eh) * 0.5 * ch.scale * 1.15 + 1;
  const rect = [ch.x - r, ch.z - r, 2 * r, 2 * r];
  const yaw = rad(ch.rotation), c = Math.cos(yaw), sn = Math.sin(yaw), s = ch.scale;
  const kx = ew / rock.cw, kz = eh / rock.ch;                       // logo units per source pixel
  const cv = document.createElement("canvas");
  cv.width = cv.height = MASK_RES;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MASK_RES, MASK_RES);
  // source pixel (col, row) -> logo (x, z) -> world -> mask pixel
  ctx.setTransform(
    (s * c * kx * MASK_RES) / rect[2], (-s * sn * kx * MASK_RES) / rect[3],
    (s * sn * kz * MASK_RES) / rect[2], (s * c * kz * MASK_RES) / rect[3],
    ((s * c * (-ew / 2) + s * sn * (-eh / 2) + ch.x - rect[0]) / rect[2]) * MASK_RES,
    ((-s * sn * (-ew / 2) + s * c * (-eh / 2) + ch.z - rect[1]) / rect[3]) * MASK_RES,
  );
  ctx.drawImage(rock.sil, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const data = ctx.getImageData(0, 0, MASK_RES, MASK_RES).data;
  const m = new Float32Array(MASK_RES * MASK_RES);
  for (let i = 0; i < m.length; i++) m[i] = data[i * 4] / 255;
  boxBlur(m, MASK_RES, MASK_RES, 3, 2);                              // feathered, so 0.5 marks the stone's edge and the falloff outside it is the skirt
  const bytes = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) bytes[i] = Math.min(255, Math.round(m[i] * 255));
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MASK_RES, MASK_RES, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  return rect;
}

// ---- component --------------------------------------------------------------

const Meadow = forwardRef(function Meadow({ values, logoUrl, stoneUrl, onNotice }, ref) {
  const canvasRef = useRef(null);
  const valuesRef = useRef(values);
  const apiRef = useRef(null);
  const captureRef = useRef(null);
  const statsRef = useRef(null);
  const [failed, setFailed] = useState(false);

  valuesRef.current = values;
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const baked = bakedKey(values);

  useImperativeHandle(ref, () => ({
    // Resolves with a PNG blob of the next rendered frame.
    snapshot: () =>
      new Promise((resolve) => {
        captureRef.current = resolve;
      }),
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) {
      setFailed(true);
      return undefined;
    }

    let progs;
    try {
      progs = {
        wind: program(gl, FULLSCREEN_VERT, WIND_FRAG),
        ground: program(gl, GROUND_VERT, GROUND_FRAG),
        blade: program(gl, bladeVert(false), BLADE_FRAG),
        bladeDepth: program(gl, bladeVert(true), DEPTH_FRAG),
        rock: program(gl, ROCK_VERT, ROCK_FRAG),
        rockDepth: program(gl, ROCK_VERT, ROCK_DEPTH_FRAG),
        rockBake: program(gl, FULLSCREEN_VERT, ROCK_BAKE_FRAG),
        mote: program(gl, MOTE_VERT, MOTE_FRAG),
        bloom: program(gl, FULLSCREEN_VERT, BLOOM_FRAG),
        flower: program(gl, FLOWER_VERT, FLOWER_FRAG),
        particle: program(gl, PARTICLE_VERT, PARTICLE_FRAG),
        post: program(gl, FULLSCREEN_VERT, POST_FRAG),
        tensor: program(gl, FULLSCREEN_VERT, TENSOR_FRAG),
        blur: program(gl, FULLSCREEN_VERT, BLUR_FRAG),
        kuwa: program(gl, FULLSCREEN_VERT, KUWA_FRAG),
      };
    } catch (err) {
      console.error(err);
      setFailed(true);
      return undefined;
    }

    const small = matchMedia("(max-width: 700px)").matches;
    const counts = small ? SMALL_COUNT : BASE_COUNT;
    let layers = [];
    let flowers = null;
    const particles = makeParticles(gl, small ? 500 : 1400);
    const ground = makeGround(gl);
    const windTarget = makeWindTarget(gl);
    const emptyVao = gl.createVertexArray();
    // The painterly pass needs half-float render targets for its structure tensor.
    const floatOK = !!gl.getExtension("EXT_color_buffer_float");      // half-float render targets: HDR scene, bloom, the rock's height field
    const paintSupported = floatOK || !!gl.getExtension("EXT_color_buffer_half_float");
    const shadowMap = makeShadowTarget(gl, small ? 1024 : 2048);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, shadowMap.tex);
    gl.activeTexture(gl.TEXTURE0);

    // The scanned rock surface (units 8-10 when drawing the rock): colour, normal, and occlusion/roughness.
    const scanTex = ["albedo", "normal", "arm"].map(() => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 255, 255]));
      return t;
    });
    let scanReady = false;
    Promise.all(["albedo", "normal", "arm"].map((n) => loadImage(`/meadow/rock_${n}.webp`)))
      .then((imgs) => {
        if (disposed) return;
        const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        imgs.forEach((img, i) => {
          gl.bindTexture(gl.TEXTURE_2D, scanTex[i]);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
          if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
        });
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        scanReady = true;
      })
      .catch((err) => console.error("rock surface textures failed to load", err));
    let scene = null;
    let rock = null;
    let disposed = false;
    let cloudW = [0, 0], mistW = [0, 0], moteW = [0, 0];   // how far the cloud shadows, mist and motes have drifted (world units)
    const maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let maskRect = [0, 0, 1, 1];
    let maskKey = "";
    let maskTimer = 0;

    // Optional uploaded stone texture (unit 3 when drawing the rock).
    const stoneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, stoneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([160, 154, 142, 255]));
    let hasStone = false;
    let rockToken = 0;
    let stoneToken = 0;

    // Plants the blades for the current camera and growth settings.
    apiRef.current = {
      // Builds a new rock from an image (any logo: transparent PNG, dark-on-light, light-on-dark, SVG).
      async setLogo(url, invert) {
        const token = ++rockToken;
        try {
          const r = await loadRock(gl, url, invert, floatOK);
          if (disposed || token !== rockToken) { destroyRock(gl, r); return; }
          const old = rock;
          rock = r;
          maskKey = "";
          maskRect = [0, 0, 1, 1];            // rebuild the grass footprint straight away
          if (old) destroyRock(gl, old);
        } catch (err) {
          console.error("rock failed to build", err);
          if (token === rockToken) noticeRef.current?.("Couldn't read that image");
        }
      },
      // Wraps the rock in an uploaded stone texture (null removes it).
      async setStone(url) {
        const token = ++stoneToken;
        if (!url) { hasStone = false; return; }
        try {
          const img = await loadImage(url);
          if (disposed || token !== stoneToken) return;
          gl.bindTexture(gl.TEXTURE_2D, stoneTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
          const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
          if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
          hasStone = true;
        } catch (err) {
          console.error("stone texture failed to load", err);
          if (token === stoneToken) noticeRef.current?.("Couldn't read that texture");
        }
      },
      rebuild(v) {
        const { camera: c, growth: g } = v;
        const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight) || 1;
        const base = {
          eye: [0, c.height, c.distance],
          target: [0, 0, c.lookAhead],
          fov: rad(c.fov),
          aspect,
          seed: g.seed,
          segments: g.segments,
        };
        const next = [makeBlades(gl, Math.round(counts.tall * g.density), {
          ...base, perTuft: g.bladesPerTuft, radiusMul: g.tuftSize, heightMul: 1, widthMul: 1, dryChance: g.dryTufts, castShadow: true,
        })];
        if (g.seedHeads > 0.01) {
          // sparse tall stalks carrying seed heads, standing above the tufts where they catch the low sun
          next.push(makeBlades(gl, Math.round((small ? STALK_COUNT_SMALL : STALK_COUNT) * g.density * g.seedHeads), {
            ...base, seed: g.seed + 31, segments: 10, perTuft: 3, radiusMul: g.tuftSize * 1.6, heightMul: 1, widthMul: 1, dryChance: 0, stalks: true, castShadow: true,
          }));
        }
        if (g.undergrowth > 0.01) {
          // a dense short layer under the tall tufts so the ground never shows through
          next.push(makeBlades(gl, Math.round(counts.under * g.density * g.undergrowth), {
            ...base, seed: g.seed + 12, perTuft: 8, radiusMul: g.tuftSize * 0.5, heightMul: g.undergrowthHeight, widthMul: 1.4, dryChance: 0, low: true,
          }));
        }
        // A carpet of very short, broad blades hugging the floor. It ignores the Density and Undergrowth dials on
        // purpose: whatever is done to the grass above, the ground stays covered.
        next.push(makeBlades(gl, small ? CARPET_COUNT_SMALL : CARPET_COUNT, {
          ...base, seed: g.seed + 57, segments: 3, perTuft: 5, radiusMul: 0.45, heightMul: 0.24, widthMul: 2.4, dryChance: 0, low: true,
        }));
        destroyLayers(gl, layers);
        layers = next;
        const fl = v.flowers;
        destroyFlowers(gl, flowers);
        flowers = fl.density > 0.01
          ? makeFlowers(gl, Math.round((small ? FLOWER_COUNT_SMALL : FLOWER_COUNT) * fl.density), { ...base, perCluster: fl.clusterSize, spread: fl.spread })
          : null;
      },
    };

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    canvas.addEventListener("pointermove", onMove);

    const f1 = (p, n, x) => gl.uniform1f(p.u(n), x);
    const f3 = (p, n, a) => gl.uniform3f(p.u(n), a[0], a[1], a[2]);

    let raf = 0;
    let visible = true;
    let time = 0;
    let last = performance.now();
    // Adaptive quality ladder: [render scale, painterly-pass scale multiplier]. When frames run slow it steps down
    // one rung (painterly quality is given up before resolution); when there is headroom it steps back up.
    const LADDER = [[1, 1], [0.9, 1], [0.85, 0.7], [0.75, 0.5], [0.65, 0.35], [0.55, 0]];
    let ema = 16, frames = 0, cooldown = 0, level = 0;
    let adv = [0, 0], laneT = 0;   // pattern drift and lane clock, integrated so changes in direction or speed never jump or race

    // Optional GPU profiler (EXT_disjoint_timer_query): milliseconds per stage, shown in the Stats overlay.
    const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    let statsOn = false;
    let openQuery = null;
    const pendingQ = [];
    const gpuMs = {};
    const qBegin = (name) => {
      if (!timer || !statsOn || openQuery || pendingQ.length > 24) return;
      const q = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
      openQuery = { name, q };
    };
    const qEnd = () => {
      if (!openQuery) return;
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      pendingQ.push(openQuery);
      openQuery = null;
    };
    const qPoll = () => {
      while (pendingQ.length) {
        const p = pendingQ[0];
        if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
        pendingQ.shift();
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
          const ms = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
          gpuMs[p.name] = gpuMs[p.name] === undefined ? ms : gpuMs[p.name] * 0.9 + ms * 0.1;
        }
        gl.deleteQuery(p.q);
      }
    };

    const frame = (now) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const v = valuesRef.current;
      const { camera: cm, wind: wd, lanes: ln, grass: gr, color: co, light: li, atmosphere: at, post } = v;
      statsOn = !!v.canvas.stats;
      const rawMs = now - last;
      const dt = Math.min(Math.max(rawMs / 1000, 0), 0.05);
      last = now;
      // Adaptive resolution: when frames run slow, render fewer pixels; creep back up when there is headroom.
      ema = ema * 0.92 + Math.min(rawMs, 100) * 0.08;
      if (++frames % 24 === 0) {
        if (cooldown > 0) cooldown -= 24;
        if (!v.canvas.adaptive) level = 0;
        else if (ema > 23 && level < LADDER.length - 1) { level++; cooldown = 240; }
        else if (ema < 15.5 && level > 0 && cooldown <= 0) level--;
      }
      const [resScale, paintMul] = LADDER[level];
      const stepT = dt * (0.6 + wd.strength * 0.5) * wd.speed;
      time += stepT;
      laneT += stepT * ln.speed;
      const li0 = v.light, db0 = v.rock;

      // The rock's height field is baked only when one of its shape controls (or the logo) changes.
      if (rock && db0) {
        const key = [db0.roundness, db0.jaggedness, db0.grain, db0.roughness, db0.seed, db0.inflate, db0.blocks].join("|");
        if (rock.bakeKey !== key) {
          rock.bakeKey = key;
          bakeRock(gl, progs.rockBake, rock, db0, emptyVao);
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, v.canvas.pixelRatio) * resScale;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const samples = Number(v.canvas.antialiasing);
      // painterly buffers are only allocated while the effect is actually on
      const wantPaint = paintSupported && v.paint.amount > 0.001 && paintMul > 0;
      const paintScale = v.paint.quality * (paintMul || 1);
      if (!scene || scene.w !== w || scene.h !== h || scene.samples !== samples || !!scene.extra !== wantPaint || (wantPaint && Math.abs(scene.paintScale - paintScale) > 0.04)) {
        if (scene) destroySceneTarget(gl, scene);
        scene = makeSceneTarget(gl, w, h, wantPaint, samples, paintScale, floatOK);
      }

      // The wind swings slowly around its mean, so for stretches it blows more sideways.
      const meanAngle = rad(wd.direction);
      const swing = (0.8 * Math.sin(time * 0.07) + 0.45 * Math.sin(time * 0.19 + 2.0) + 0.2 * Math.sin(time * 0.43 + 4.0)) * wd.wander;
      const windDir = [Math.sin(meanAngle + swing), -Math.cos(meanAngle + swing)];
      const baseDir = [Math.sin(meanAngle), -Math.cos(meanAngle)];
      adv = [adv[0] + windDir[0] * stepT, adv[1] + windDir[1] * stepT];
      cloudW = [cloudW[0] + windDir[0] * stepT * 1.6 * li0.cloudSpeed, cloudW[1] + windDir[1] * stepT * 1.6 * li0.cloudSpeed];
      mistW = [mistW[0] + windDir[0] * stepT * 0.9, mistW[1] + windDir[1] * stepT * 0.9];
      moteW = [moteW[0] + windDir[0] * stepT * 1.1, moteW[1] + windDir[1] * stepT * 1.1];

      // 1. wind field -> texture
      qBegin("wind");
      gl.bindFramebuffer(gl.FRAMEBUFFER, windTarget.fbo);
      gl.viewport(0, 0, WIND_RES, WIND_RES);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(progs.wind);
      gl.uniform4fv(progs.wind.u("uRect"), WIND_RECT);
      f1(progs.wind, "uTime", time);
      gl.uniform2fv(progs.wind.u("uDir"), windDir);
      gl.uniform2fv(progs.wind.u("uBase"), baseDir);
      gl.uniform2fv(progs.wind.u("uAdv"), adv);
      f1(progs.wind, "uLaneT", laneT);
      f1(progs.wind, "uLaneWidth", ln.width);
      f1(progs.wind, "uLaneSwing", ln.swing);
      f1(progs.wind, "uMeander", ln.meander);
      f1(progs.wind, "uLaneBright", ln.brightness);
      f1(progs.wind, "uSwirl", ln.swirls);
      f1(progs.wind, "uSwirlSize", ln.swirlSize);
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      qEnd();

      // camera: slow drift plus optional pointer parallax, a touch of roll like a handheld shot.
      // With followPointer off the camera eases back to centre instead of snapping.
      pointer.x += ((cm.followPointer ? pointer.tx : 0) - pointer.x) * 0.04;
      pointer.y += ((cm.followPointer ? pointer.ty : 0) - pointer.y) * 0.04;
      const px = pointer.x * cm.parallax;
      const py = pointer.y * cm.parallax;
      const eye = [Math.sin(time * 0.25) * 0.5 * cm.drift + px * 1.2, cm.height - py * 0.5, cm.distance + Math.sin(time * 0.19) * 0.4 * cm.drift];
      const target = [px * 1.5, 0, cm.lookAhead + Math.sin(time * 0.15) * 0.5 * cm.drift - py];
      const cam = camera(eye, target, rad(cm.roll) + Math.sin(time * 0.1) * 0.04 * cm.drift, rad(cm.fov), w / h);

      const fogRgb = hex(at.hazeColor);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, windTarget.tex);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.activeTexture(gl.TEXTURE0);

      const rk = v.rock;
      const ch = rk;
      const showRock = !!(rock && ch && ch.show);
      const sAz = rad(li.sunAzimuth), sEl = rad(li.sunElevation);
      const sunDir = [Math.cos(sEl) * Math.sin(sAz), Math.sin(sEl), -Math.cos(sEl) * Math.cos(sAz)];
      const sunHLen = Math.hypot(sunDir[0], sunDir[2]) || 1;
      const sunXZ = [sunDir[0] / sunHLen, sunDir[2] / sunHLen];
      const shadowAmt = showRock && rk.shadow > 0.01 ? rk.shadow : 0;       // contact darkening at the rock's foot
      const sunRgb = hex(li.sunColor), skyRgb = hex(li.skyColor);

      // What the camera can see of the ground, and the sun's view of it (stretched toward the sun, where the casters stand).
      const viewRect = groundRect([0, cm.height, cm.distance], [0, 0, cm.lookAhead], rad(cm.fov), w / h);
      const reach = Math.min(5 / Math.tan(sEl), 16);
      const lx = sunXZ[0] * reach, lz = sunXZ[1] * reach;
      const lightVP = lightMatrix(sunDir, [
        viewRect[0] - 3 + Math.min(lx, 0), viewRect[1] - 3 + Math.min(lz, 0),
        viewRect[2] + 6 + Math.abs(lx), viewRect[3] + 6 + Math.abs(lz),
      ], 5);
      const shadowsOn = !!li.shadows;

      const setAir = (P) => {
        f1(P, "uFog", at.haze);
        f3(P, "uFogColor", fogRgb);
        f1(P, "uMist", at.mist);
        f3(P, "uMistColor", hex(at.mistColor));
        f1(P, "uMistHeight", at.mistHeight);
        gl.uniform2f(P.u("uMistOff"), mistW[0] * 0.07, mistW[1] * 0.07);
      };
      const setLight = (P) => {
        gl.uniform1i(P.u("uShadowMap"), 6);
        gl.uniformMatrix4fv(P.u("uLightVP"), false, lightVP);
        f1(P, "uShadowOn", shadowsOn ? 1 : 0);
        f1(P, "uCloud", li.cloudShadow);
        f1(P, "uCloudScale", 1 / li.cloudSize);
        gl.uniform2f(P.u("uCloudOff"), (cloudW[0] * 0.03) / li.cloudSize, (cloudW[1] * 0.03) / li.cloudSize);
      };
      // Everything that shapes and moves a blade: shared by the picture and the shadow map.
      const setBladeGeom = (P, vp) => {
        gl.uniformMatrix4fv(P.u("uVP"), false, vp);
        gl.uniform4fv(P.u("uRect"), WIND_RECT);
        gl.uniform1i(P.u("uWindTex"), 0);
        f1(P, "uTime", time);
        f1(P, "uWind", wd.strength);
        gl.uniform2fv(P.u("uDir"), windDir);
        gl.uniform3fv(P.u("uCamera"), eye);
        f1(P, "uHeight", gr.height);
        f1(P, "uHeightContrast", gr.heightContrast);
        f1(P, "uWidthMul", gr.width);
        f1(P, "uTaper", gr.tipSharpness);
        f1(P, "uCurl", gr.curl);
        f1(P, "uStiff", gr.stiffnessVariation);
        f1(P, "uBaseBend", wd.baseBend);
        f1(P, "uGustBend", wd.gustBend);
        f1(P, "uFlutter", wd.flutter);
        gl.uniform1i(P.u("uMask"), 5);
        gl.uniform4fv(P.u("uMaskRect"), maskRect);
        gl.uniform3f(P.u("uOver"), showRock ? ch.grassKeep : 1, showRock ? ch.grassHeight : 1, showRock ? ch.grassSkirt : 0);
        f1(P, "uRockOn", showRock ? 1 : 0);
        gl.uniform1i(P.u("uRockH"), 7);
        if (showRock) {
          gl.activeTexture(gl.TEXTURE7);
          gl.bindTexture(gl.TEXTURE_2D, rock.heightTex);
          gl.activeTexture(gl.TEXTURE0);
          const yaw = rad(ch.rotation);
          gl.uniform4f(P.u("uRockXf"), ch.x, ch.z, Math.cos(yaw) / ch.scale, Math.sin(yaw) / ch.scale);
          gl.uniform3f(P.u("uRockDim"), rock.extent[0], rock.extent[1], ch.thickness * 1.6 * ch.scale);
          f1(P, "uRockLift", ch.lift);
        }
        gl.uniform3f(P.u("uThin"), at.thinStart, Math.max(at.thinEnd, at.thinStart + 1), at.thinKeep);
        f3(P, "uSun", sunDir);
        setAir(P);
      };
      const setRockGeom = (P, vp) => {
        gl.uniformMatrix4fv(P.u("uVP"), false, vp);
        gl.uniformMatrix4fv(P.u("uModel"), false, rockModel(ch));
        gl.activeTexture(gl.TEXTURE7);
        gl.bindTexture(gl.TEXTURE_2D, rock.heightTex);
        gl.uniform1i(P.u("uHeight"), 7);
        gl.uniform2fv(P.u("uExtent"), rock.extent);
        f1(P, "uHScale", ch.thickness * 1.6);
        gl.activeTexture(gl.TEXTURE0);
      };

      // 1b. the sun's view: blades and rock into the shadow map
      if (shadowsOn) {
        qBegin("shadow map");
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowMap.fbo);
        gl.viewport(0, 0, shadowMap.size, shadowMap.size);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(2, 4);
        const D = progs.bladeDepth;
        gl.useProgram(D);
        setBladeGeom(D, lightVP);
        for (const layer of layers) {
          if (!layer.shadowVao) continue;
          f1(D, "uHead", layer.head ? 1 : 0);
          gl.bindVertexArray(layer.shadowVao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, layer.shadowVertices, layer.count);
        }
        if (showRock) {
          gl.useProgram(progs.rockDepth);
          setRockGeom(progs.rockDepth, lightVP);
          gl.bindVertexArray(rock.vao);
          gl.drawElements(gl.TRIANGLES, rock.count, gl.UNSIGNED_INT, 0);
        }
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, shadowMap.tex);
        gl.activeTexture(gl.TEXTURE0);
        qEnd();
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.msFbo);
      gl.viewport(0, 0, w, h);
      gl.clearColor(fogRgb[0] * 0.4, fogRgb[1] * 0.4, fogRgb[2] * 0.4, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 2. ground under the blades
      qBegin("ground + character");
      gl.useProgram(progs.ground);
      gl.uniformMatrix4fv(progs.ground.u("uVP"), false, cam.vp);
      gl.uniform4fv(progs.ground.u("uRect"), WIND_RECT);
      gl.uniform1i(progs.ground.u("uWind"), 0);
      gl.uniform3fv(progs.ground.u("uCamera"), eye);
      gl.uniform2fv(progs.ground.u("uDir"), windDir);
      gl.uniform1i(progs.ground.u("uMask"), 5);
      gl.uniform4fv(progs.ground.u("uMaskRect"), maskRect);
      f1(progs.ground, "uShadowAmt", shadowAmt);
      f3(progs.ground, "uSoil", hex(co.soil));
      f3(progs.ground, "uMeadow", hex(co.meadow));
      setAir(progs.ground);
      setLight(progs.ground);
      gl.bindVertexArray(ground.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 2b. the logo rock (static, depth-tested so grass can sweep over and around it)
      if (showRock) {
        const key = [ch.x, ch.z, ch.rotation, ch.scale].join("|");
        if (key !== maskKey) {
          maskKey = key;
          clearTimeout(maskTimer);
          const snap = { x: ch.x, z: ch.z, rotation: ch.rotation, scale: ch.scale };
          maskTimer = setTimeout(() => {
            if (rock && !disposed) maskRect = buildRockMask(gl, maskTex, rock, snap);
          }, maskRect[2] === 1 ? 0 : 120);
        }
        const C = progs.rock;
        gl.useProgram(C);
        setRockGeom(C, cam.vp);
        gl.uniform2f(C.u("uHTexel"), rock.extent[0] / rock.hw, rock.extent[1] / rock.hh);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, stoneTex);
        gl.uniform1i(C.u("uStoneTex"), 3);
        ["uAlb", "uNor", "uArm"].forEach((name, i) => {
          gl.activeTexture(gl.TEXTURE8 + i);
          gl.bindTexture(gl.TEXTURE_2D, scanTex[i]);
          gl.uniform1i(C.u(name), 8 + i);
        });
        gl.activeTexture(gl.TEXTURE0);
        f1(C, "uScanAmt", scanReady ? ch.scanAmount : 0);
        f1(C, "uScanScale", ch.scanScale);
        f1(C, "uHasTex", hasStone ? 1 : 0);
        f1(C, "uTexScale", ch.textureScale);
        f1(C, "uTexAmt", ch.textureAmount);
        f1(C, "uTexBump", ch.textureRelief);
        gl.uniform3fv(C.u("uCamera"), eye);
        f3(C, "uSun", sunDir);
        const yawR = rad(ch.rotation);
        f3(C, "uSunObj", [Math.cos(yawR) * sunDir[0] - Math.sin(yawR) * sunDir[2], sunDir[1], Math.sin(yawR) * sunDir[0] + Math.cos(yawR) * sunDir[2]]);
        f1(C, "uDetail", ch.detail);
        f1(C, "uShadow", ch.shadow);
        f3(C, "uSunColor", sunRgb);
        f3(C, "uSky", skyRgb);
        f3(C, "uStone", hex(ch.stone));
        f3(C, "uMoss", hex(ch.mossColor));
        f3(C, "uBounce", hex(co.meadow).map((x) => x * 0.6));
        f1(C, "uMossAmt", ch.moss);
        f1(C, "uBright", ch.brightness);
        f1(C, "uAmbient", ch.ambient * li.ambient);
        f1(C, "uSunlight", li.sunlight);
        setAir(C);
        setLight(C);
        gl.bindVertexArray(rock.vao);
        gl.drawElements(gl.TRIANGLES, rock.count, gl.UNSIGNED_INT, 0);
      }

      qEnd();
      // 3. blades
      qBegin("blades");
      const B = progs.blade;
      gl.useProgram(B);
      setBladeGeom(B, cam.vp);
      setLight(B);
      f1(B, "uShadowAmt", shadowAmt);
      f3(B, "uMeadow", hex(co.meadow));
      f3(B, "uFresh", hex(co.fresh));
      f3(B, "uCool", hex(co.cool));
      f3(B, "uStraw", hex(co.straw));
      f3(B, "uTipColor", hex(co.tip));
      f3(B, "uDryTip", hex(co.dryTip));
      f3(B, "uSoil", hex(co.soil));
      f3(B, "uSeedColor", hex(co.seedHead));
      f1(B, "uGustSheen", li.gustSheen);
      f1(B, "uSat", co.saturation);
      f1(B, "uBright", co.brightness);
      f1(B, "uToneVar", co.toneVariation);
      f1(B, "uPatch", co.patchStrength);
      f1(B, "uPatchSize", co.patchSize);
      f1(B, "uDryStrength", co.dryStrength);
      f1(B, "uDryTips", co.dryTips);
      f1(B, "uLaneBright", ln.brightness);
      f3(B, "uSunColor", sunRgb);
      f3(B, "uSky", skyRgb);
      f3(B, "uBackColor", hex(li.backlightColor));
      f1(B, "uSunlight", li.sunlight);
      f1(B, "uAmbient", li.ambient);
      f1(B, "uBacklight", li.backlight);
      f1(B, "uSheen", li.sheen);
      f1(B, "uCanopy", li.canopyShadow);
      f1(B, "uRoot", li.rootShade);
      f1(B, "uCrease", li.crease);
      f1(B, "uUnderside", li.underside);
      for (const layer of layers) {
        f1(B, "uHead", layer.head ? 1 : 0);
        gl.bindVertexArray(layer.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, layer.vertices, layer.count);
      }

      // 3b. flowers: stems, then heads (alpha-to-coverage gives the petals soft edges under MSAA)
      const fl = v.flowers;
      const pal = flowerPalette(fl.color, fl.shades);
      const sunV = [Math.cos(rad(li.sunElevation)) * Math.sin(rad(li.sunAzimuth)), Math.sin(rad(li.sunElevation)), -Math.cos(rad(li.sunElevation)) * Math.cos(rad(li.sunAzimuth))];
      if (flowers && fl.show) {
        const F = progs.flower;
        gl.useProgram(F);
        gl.uniformMatrix4fv(F.u("uVP"), false, cam.vp);
        gl.uniform4fv(F.u("uRect"), WIND_RECT);
        gl.uniform1i(F.u("uWindTex"), 0);
        gl.uniform1i(F.u("uMask"), 5);
        gl.uniform4fv(F.u("uMaskRect"), maskRect);
        f1(F, "uTime", time);
        f1(F, "uWind", wd.strength);
        f1(F, "uSize", fl.size);
        f1(F, "uHeight", fl.height);
        f1(F, "uBend", fl.sway);
        gl.uniform3fv(F.u("uPal[0]"), pal);
        gl.uniform3fv(F.u("uCamera"), eye);
        f3(F, "uSun", sunV);
        f3(F, "uSunColor", sunRgb);
        f3(F, "uSky", skyRgb);
        f3(F, "uCenter", hex(fl.center));
        setAir(F);
        setLight(F);
        gl.bindVertexArray(flowers.stemV.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, flowers.stemVerts, flowers.count);
        gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        gl.bindVertexArray(flowers.headV.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, flowers.headVerts, flowers.count);
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      }

      // 3c. wind debris: flowers lifted off by gusts and blown downwind
      const db = v.debris;
      if (db.amount > 0.01) {
        const P = progs.particle;
        gl.useProgram(P);
        gl.uniformMatrix4fv(P.u("uVP"), false, cam.vp);
        gl.uniform4fv(P.u("uRect"), WIND_RECT);
        gl.uniform4fv(P.u("uSpawn"), viewRect);
        gl.uniform1i(P.u("uWindTex"), 0);
        f1(P, "uTime", time);
        f1(P, "uLife", db.lifetime);
        f1(P, "uLift", db.lift);
        f1(P, "uSpeed", db.speed);
        f1(P, "uSize", db.size);
        f1(P, "uThreshold", db.gustThreshold);
        gl.uniform3fv(P.u("uCamRight"), cam.right);
        gl.uniform3fv(P.u("uCamUp"), cam.up);
        gl.uniform3fv(P.u("uPal[0]"), pal);
        f3(P, "uSun", sunV);
        gl.uniform3fv(P.u("uCamera"), eye);
        f3(P, "uCenter", hex(fl.center));
        f3(P, "uTint", sunRgb.map((x) => x * 1.2));
        setAir(P);
        gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        gl.bindVertexArray(particles.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(particles.max, Math.round(particles.max * Math.min(db.amount, 1))));
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      }

      // 3d. motes: pollen and dust in the air, drawn additively so the bloom picks them up
      if (at.motes > 0.01) {
        const M = progs.mote;
        gl.useProgram(M);
        gl.uniformMatrix4fv(M.u("uVP"), false, cam.vp);
        gl.uniform4fv(M.u("uSpawn"), viewRect);
        gl.uniform2fv(M.u("uDrift"), moteW);
        f1(M, "uTime", time);
        f1(M, "uSize", 0.75);
        gl.uniform3fv(M.u("uCamRight"), cam.right);
        gl.uniform3fv(M.u("uCamUp"), cam.up);
        f3(M, "uColor", sunRgb.map((x) => x * 0.8 * Math.min(li.sunlight, 1.6)));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.depthMask(false);
        gl.bindVertexArray(particles.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.round(particles.max * 0.6 * Math.min(at.motes, 1)));
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      qEnd();
      // 4. resolve the anti-aliased scene, then paint and grade it
      qBegin("MSAA resolve");
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, scene.msFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.resFbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      qEnd();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(emptyVao);
      const pt = v.paint;
      const painting = wantPaint && !!scene.extra;
      if (painting) {
        const X = scene.extra;
        qBegin("paint (Kuwahara)");
        gl.viewport(0, 0, X.pw, X.ph);
        const pass = (prog, target, inputs, setup) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
          gl.useProgram(prog);
          inputs.forEach(([tex, unit, name]) => {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(prog.u(name), unit);
          });
          setup?.();
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        // structure tensor (this pass also downsamples) -> smoothed horizontally -> smoothed vertically
        pass(progs.tensor, X.tensorA, [[scene.resTex, 1, "uScene"]], () => gl.uniform2f(progs.tensor.u("uTexel"), 1 / X.pw, 1 / X.ph));
        pass(progs.blur, X.tensorB, [[X.tensorA.tex, 1, "uTex"]], () => {
          gl.uniform2f(progs.blur.u("uDirection"), 1, 0);
          f1(progs.blur, "uSigma", pt.smoothing);
        });
        pass(progs.blur, X.tensorA, [[X.tensorB.tex, 1, "uTex"]], () => {
          gl.uniform2f(progs.blur.u("uDirection"), 0, 1);
          f1(progs.blur, "uSigma", pt.smoothing);
        });
        pass(progs.kuwa, X.painted, [[scene.resTex, 1, "uScene"], [X.tensorA.tex, 2, "uTensor"]], () => {
          // brush size is set in on-screen pixels, so the look is independent of render resolution
          f1(progs.kuwa, "uRadius", pt.radius * 0.55 * (X.pw / Math.max(1, canvas.clientWidth)));
          f1(progs.kuwa, "uSharpness", pt.sharpness);
          f1(progs.kuwa, "uAlpha", pt.anisotropy);
          f1(progs.kuwa, "uSaturation", pt.saturation);
        });
        qEnd();
        gl.viewport(0, 0, w, h);
      }

      // 4b. bloom: keep what is brighter than the threshold, blur it at a quarter and an eighth of the picture
      const BL = scene.bloom;
      if (post.bloom > 0.005) {
        qBegin("bloom");
        const pass = (prog, target, tex, setup) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
          gl.viewport(0, 0, target.w, target.h);
          gl.useProgram(prog);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(prog.u("uTex"), 1);
          setup();
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        const blur = (a, b, sigma) => {
          pass(progs.blur, b, a.tex, () => { gl.uniform2f(progs.blur.u("uDirection"), 1, 0); f1(progs.blur, "uSigma", sigma); });
          pass(progs.blur, a, b.tex, () => { gl.uniform2f(progs.blur.u("uDirection"), 0, 1); f1(progs.blur, "uSigma", sigma); });
        };
        pass(progs.bloom, BL.a1, scene.resTex, () => { gl.uniform2f(progs.bloom.u("uTexel"), 1 / w, 1 / h); f1(progs.bloom, "uThreshold", post.bloomThreshold); });
        blur(BL.a1, BL.a2, 2.5);
        pass(progs.bloom, BL.b1, BL.a1.tex, () => { gl.uniform2f(progs.bloom.u("uTexel"), 1 / BL.a1.w, 1 / BL.a1.h); f1(progs.bloom, "uThreshold", 0); });
        blur(BL.b1, BL.b2, 3);
        gl.viewport(0, 0, w, h);
        qEnd();
      }

      // 5. blend the painted layer over the sharp scene and grade it onto the screen
      qBegin("final grade");
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(progs.post);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, scene.resTex);
      gl.uniform1i(progs.post.u("uScene"), 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, painting ? scene.extra.painted.tex : scene.resTex);
      gl.uniform1i(progs.post.u("uPaint"), 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, BL.a1.tex);
      gl.uniform1i(progs.post.u("uBloomA"), 3);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, BL.b1.tex);
      gl.uniform1i(progs.post.u("uBloomB"), 4);
      f1(progs.post, "uBloom", post.bloom);
      f1(progs.post, "uSaturation", post.saturation);
      f1(progs.post, "uTone", post.tone);
      f3(progs.post, "uShadowTint", hex(post.shadowTint));
      f3(progs.post, "uHighTint", hex(post.highlightTint));
      f1(progs.post, "uPaintAmount", painting ? pt.amount : 0);
      f1(progs.post, "uTime", time);
      f1(progs.post, "uExposure", post.exposure);
      f1(progs.post, "uContrast", post.contrast);
      f1(progs.post, "uVignette", post.vignette);
      f1(progs.post, "uGrain", post.grain);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      qEnd();

      if (timer) qPoll();
      if (statsRef.current) {
        statsRef.current.hidden = !statsOn;
        if (statsOn && frames % 20 === 0) {
          const rows = Object.entries(gpuMs);
          const total = rows.reduce((a, [, ms]) => a + ms, 0);
          const blades = layers.reduce((a, l) => a + l.count, 0);
          statsRef.current.textContent = timer
            ? [...rows.map(([k, ms]) => `${k.padEnd(20)}${ms.toFixed(2).padStart(7)} ms`), `${"GPU total".padEnd(20)}${total.toFixed(2).padStart(7)} ms`, `${"frame (wall)".padEnd(20)}${ema.toFixed(1).padStart(7)} ms`, `canvas ${w}x${h}  scale ${resScale.toFixed(1)}`, `blades ${(blades / 1000).toFixed(0)}k x ${(layers[0]?.vertices ?? 0)} verts`].join("\n")
            : "GPU timer not available in this browser";
        }
      }

      if (captureRef.current) {
        const done = captureRef.current;
        captureRef.current = null;
        canvas.toBlob((blob) => done(blob), "image/png");   // read in the same task as the draw, so the buffer is still valid
      }

      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!raf && visible && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", start);
    start();

    return () => {
      disposed = true;
      clearTimeout(maskTimer);
      destroyFlowers(gl, flowers);
      particles.bufs.forEach((b) => gl.deleteBuffer(b));
      gl.deleteVertexArray(particles.vao);
      if (rock) destroyRock(gl, rock);
      gl.deleteTexture(stoneTex);
      gl.deleteTexture(maskTex);
      scanTex.forEach((t) => gl.deleteTexture(t));
      gl.deleteTexture(shadowMap.tex);
      gl.deleteFramebuffer(shadowMap.fbo);
      apiRef.current = null;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", start);
      canvas.removeEventListener("pointermove", onMove);
      destroyLayers(gl, layers);
      gl.deleteBuffer(ground.buf);
      gl.deleteVertexArray(ground.vao);
      gl.deleteVertexArray(emptyVao);
      if (scene) destroySceneTarget(gl, scene);
      gl.deleteTexture(windTarget.tex);
      gl.deleteFramebuffer(windTarget.fbo);
      Object.values(progs).forEach((p) => gl.deleteProgram(p));
    };
  }, []);

  // Build the rock from the current logo (and rebuild if Invert flips).
  const invertLogo = !!values.rock.invertLogo;
  useEffect(() => {
    apiRef.current?.setLogo(logoUrl, invertLogo);
  }, [logoUrl, invertLogo]);

  useEffect(() => {
    apiRef.current?.setStone(stoneUrl);
  }, [stoneUrl]);

  // Re-plant the blades when a control that changes where they grow moves (debounced).
  useEffect(() => {
    const first = !apiRef.current?.planted;
    const id = setTimeout(() => {
      if (apiRef.current) {
        apiRef.current.rebuild(valuesRef.current);
        apiRef.current.planted = true;
      }
    }, first ? 0 : 250);
    return () => clearTimeout(id);
  }, [baked]);

  return (
    <div className="absolute inset-0 bg-[#0a240a]">
      <canvas ref={canvasRef} className="h-full w-full touch-none" />
      {failed && <p className="absolute inset-0 grid place-items-center text-sm text-white/80">WebGL2 is not available in this browser.</p>}
      <pre ref={statsRef} hidden className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 p-2 font-mono text-[10px] leading-tight text-white" />
    </div>
  );
});

export default Meadow;
