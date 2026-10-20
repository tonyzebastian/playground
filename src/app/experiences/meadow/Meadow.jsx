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
uniform float uPaintAmount;
uniform float uTime;
uniform float uExposure;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
out vec4 outColor;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec3 c = texture(uScene, uv).rgb;
  if (uPaintAmount > 0.0) c = mix(c, texture(uPaint, uv).rgb, uPaintAmount);
  c *= uExposure;
  c = clamp(c, 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c *= 1.0 - uVignette * dot(vUv, vUv) * 0.5;
  c += (hash21(gl_FragCoord.xy + floor(uTime * 24.0) * 17.0) - 0.5) * uGrain;
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
vec3 applyFog(vec3 c, float d) {
  float f = uFog * (1.0 - exp(-d * 0.006));
  return mix(c, uFogColor, f);
}`;

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
void main() {
  vec2 uv = clamp((vWorld.xz - uRect.xy) / uRect.zw, 0.0, 1.0);
  vec3 w = texture(uWind, uv).rgb;
  float d = distance(uCamera, vWorld);
  vec2 perp = vec2(-uDir.y, uDir.x);
  float streak = vnoise(vec2(dot(vWorld.xz, perp) * 1.6, dot(vWorld.xz, uDir) * 0.25));
  float mottle = clamp(w.r * 0.65, 0.0, 1.0);
  vec3 c = mix(uSoil * 0.75, uMeadow * 0.42, clamp(mottle + streak * 0.25 - 0.1, 0.0, 1.0));
  outColor = vec4(applyFog(c, d), 1.0);
}`;

// ---- the logo rock -------------------------------------------------------------------------------
// The logo's silhouette becomes a boulder. A signed-distance texture of the logo (distance inward from its edge)
// drives a rounded bevel, so thin strokes turn into pillowy stone ridges; noise breaks the outline up and a few
// ridged octaves give it a chiselled surface. The height field is evaluated in the vertex shader (mesh) and again
// per pixel (normals), so the stone keeps fine detail without a dense mesh.
const ROCK_LIB = `
uniform sampler2D uSdf;
uniform vec2 uExtent;      // padded logo rectangle, in logo units (long side of the logo = 1)
uniform float uDMax, uT, uRb, uNoise, uFreq, uRough, uSeed, uInflate;
float rockH(vec2 p) {
  vec2 uv = p / uExtent + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float d = (textureLod(uSdf, uv, 0.0).r - 0.5) * 2.0 * uDMax + uInflate;   // signed distance to the logo's edge (+ inside), grown by Inflate
  float nz = 0.65 * vnoise(p * uFreq + uSeed) + 0.35 * vnoise(p * uFreq * 2.1 + uSeed * 1.3) - 0.5;   // low-frequency wobble only
  d += nz * uNoise * 0.04;                                          // lumpy outline (absolute size, so it can't cut thin strokes apart)
  if (d <= 0.0) return 0.0;
  float x = clamp(d / uRb, 0.0, 1.0);
  float prof = 1.0 - pow(1.0 - x, 1.8);                              // rounded shoulder, finite slope at the edge
  float ridge = 1.0 - abs(2.0 * vnoise(p * uFreq * 2.6 + uSeed * 1.7) - 1.0);
  float h = uT * prof;
  h += uT * uRough * ((vnoise(p * uFreq * 3.0 + uSeed * 0.5) - 0.5) * 0.12 + (ridge - 0.5) * 0.08) * smoothstep(0.0, 0.3, prof);
  return max(h, 0.0);
}
`;

const ROCK_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;       // (x, z) in logo units, centred on the logo
uniform mat4 uVP;
uniform mat4 uModel;
out vec2 vP;
out vec3 vWorld;
${NOISE}
${ROCK_LIB}
void main() {
  float h = rockH(aPos);
  vec4 w = uModel * vec4(aPos.x, h, aPos.y, 1.0);
  vP = aPos;
  vWorld = w.xyz;
  gl_Position = uVP * w;
}`;

const ROCK_FRAG = `#version 300 es
precision highp float;
in vec2 vP;
in vec3 vWorld;
uniform mat4 uModel;
uniform vec3 uCamera, uSun, uSunColor, uSky, uStone, uMoss;
uniform float uBright, uMossAmt, uAmbient, uSunlight;
out vec4 outColor;
${NOISE}
${ROCK_LIB}
${FOG}
void main() {
  float h = rockH(vP);
  if (h <= 0.0004) discard;                                            // outside the rock
  const float e = 0.004;
  float hx = rockH(vP + vec2(e, 0.0)), hz = rockH(vP + vec2(0.0, e));
  vec3 nObj = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
  vec2 bump = vec2(vnoise(vP * 140.0 + 3.0), vnoise(vP * 140.0 + 17.0)) - 0.5;
  nObj = normalize(nObj + vec3(bump.x, 0.0, bump.y) * 0.22 * uRough);  // fine grit
  vec3 N = normalize(mat3(uModel) * nObj);

  // stone: broad tonal patches, fine grain, dark crack lines
  float coarse = fbm(vP * 9.0 + 5.0);
  float fine = vnoise(vP * 70.0);
  vec3 stone = mix(uStone * 0.74, uStone * 1.2, coarse) * (0.9 + 0.2 * fine);
  float crack = smoothstep(0.9, 1.0, 1.0 - abs(2.0 * vnoise(vP * 22.0 + 9.0) - 1.0));
  stone *= 1.0 - 0.38 * crack;

  // moss collects on upward-facing, lower parts, in patches
  float up = smoothstep(0.5, 0.9, N.y);
  float patchy = fbm(vP * 6.0 + 11.0);
  float moss = uMossAmt * up * smoothstep(0.4, 0.62, patchy + (1.0 - h / uT) * 0.22);
  vec3 c = mix(stone, uMoss * (0.8 + 0.4 * fine), moss);

  float ao = mix(0.42, 1.0, smoothstep(0.0, 0.3, h / uT));             // darker where the stone meets the ground
  vec3 ambient = mix(vec3(0.4, 0.37, 0.3), mix(uSky, vec3(0.55, 0.52, 0.45), 0.55), N.y * 0.5 + 0.5) * uAmbient;   // warm bounce, little blue
  c *= (ambient + uSunColor * max(dot(N, uSun), 0.0) * uSunlight * 0.9) * ao * uBright;
  outColor = vec4(applyFog(c, distance(uCamera, vWorld)), 1.0);
}`;

const BLADE_VERT = `#version 300 es
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
uniform vec2 uOver;          // grass kept / height multiplier where it grows through him
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
  float keepP = keepD * mix(1.0, uOver.x, inside);
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
  float A = (uBaseBend + gust * uGustBend) * uWind * stiff;
  A += sin(dot(aRoot, baseDir) * 1.9 - uTime * 3.2 + aClump.z * 6.0) * 0.11 * (0.25 + gust) * uFlutter;
  A += sin(uTime * 2.4 + aRand.y * 40.0 + t * 2.0) * 0.06 * (0.3 + gust) * (0.4 + w4.a) * uFlutter;
  A = clamp(A, 0.15, 2.5);
  float H = 1.5 * pow(max(aShape.x, 0.01) / 1.5, uHeightContrast) * uHeight * mix(1.0, uOver.y, inside);
  float theta = A * t;
  float out_ = H * (1.0 - cos(theta)) / A;
  float up = H * sin(theta) / A;

  vec2 side2 = vec2(-dir.y, dir.x);
  float tw = aShape.w;
  side2 = vec2(side2.x * cos(tw) - side2.y * sin(tw), side2.x * sin(tw) + side2.y * cos(tw));

  // Widest just above the root, tapering toward the tip.
  float taper = mix(0.5, 1.0, smoothstep(0.0, 0.12, t)) * pow(max(1.0 - t, 0.0), uTaper) + 0.02 * (1.0 - t);
  float curl = (fract(aRand.y * 91.7) - 0.5) * 0.55 * H * t * t * uCurl;   // natural sideways droop

  vec3 world = vec3(aRoot.x, 0.0, aRoot.y);
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
uniform vec3 uCamera;
uniform vec3 uMeadow, uFresh, uCool, uStraw, uTipColor, uDryTip, uSoil;
uniform float uSat, uBright, uToneVar, uPatch, uPatchSize, uDryStrength, uDryTips, uLaneBright;
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

  float farFade = smoothstep(25.0, 55.0, distance(uCamera, vWorld));   // no root darkening far away: it only shimmers
  vec3 tip = mix(base * 1.2, uTipColor, 0.25);
  vec3 c = mix(uSoil, base, mix(smoothstep(0.0, 0.45, vT), 1.0, farFade * 0.7));
  c = mix(c, tip, smoothstep(0.35, 1.0, vT) * (0.15 + vGust * 0.85));
  float dryTip = step(1.0 - clamp(uDryTips * 0.28, 0.0, 1.0), fract(vShade * 29.3)) * smoothstep(0.78, 1.0, vT);   // some blades are browned at the tip
  c = mix(c, uDryTip * (0.8 + 0.4 * vTone), dryTip * 0.8);

  float canopy = mix(1.0 - 0.55 * uCanopy, 1.0, smoothstep(0.0, 1.6, vWorld.y));   // short blades sit in the shade of tall ones
  float ao = mix(1.0, mix(1.0 - 0.38 * uRoot, 1.0, smoothstep(0.0, 0.5, vT)) * canopy, 1.0 - farFade);
  vec3 ambient = mix(vec3(0.27, 0.31, 0.16), uSky, n.y * 0.5 + 0.5) * uAmbient;
  c *= (ambient + wrap * uSunColor * uSunlight) * ao;
  if (!gl_FrontFacing) c = mix(c, c * vec3(1.14, 1.14, 1.0) + vec3(0.025, 0.03, 0.0), uUnderside);   // paler underside where blades flip
  c *= mix(1.0 - uLaneBright, 1.0 + uLaneBright, vGust);
  c += uBackColor * glow * (0.20 + vT * 0.55) * (0.5 + vGust * 0.5) * ao * uBacklight;   // sun glowing through the blade
  c += vec3(0.85, 0.92, 0.70) * sheen * uSheen * smoothstep(0.2, 1.0, vT);
  c *= mix(0.8, 1.0, abs(vSide));                          // darker midrib, lighter edges
  outColor = vec4(applyFog(c, distance(uCamera, vWorld)), 1.0);
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
uniform vec3 uCamera, uSun, uSunColor, uCenter;
out vec4 outColor;
${FOG}
${FLOWER_LIB}
void main() {
  float d = distance(uCamera, vWorld);
  vec3 N = normalize(gl_FrontFacing ? vNormal : -vNormal);
  float lit = 0.72 + 0.5 * max(dot(N, uSun), 0.0);
  if (vPart < 0.5) {
    vec3 c = mix(vec3(0.16, 0.33, 0.10), vec3(0.33, 0.52, 0.17), vT) * lit;
    outColor = vec4(applyFog(c, d), 1.0);
    return;
  }
  vec4 fl = flowerHead(vUv, vColor, uCenter, vLight, vSeed);
  if (fl.a <= 0.0) discard;
  outColor = vec4(applyFog(fl.rgb, d), fl.a);                                 // alpha-to-coverage softens the edge under MSAA
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
uniform vec3 uCamera, uCenter;
out vec4 outColor;
${FOG}
${FLOWER_LIB}
void main() {
  vec4 fl = flowerHead(vUv, vColor, uCenter, vLight, vSeed);
  if (fl.a <= 0.0) discard;
  outColor = vec4(applyFog(fl.rgb, distance(uCamera, vWorld)), fl.a);
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
    const heightScale = 0.4 + Math.pow(rand(), 1.6) * 1.3;   // mostly short, a few tall tufts
    const yawBias = (rand() - 0.5) * 0.35;
    const radius = (0.35 + rand() * 0.4) * o.radiusMul * Math.min(2.2, Math.max(0.8, dist / 14));   // far tufts grow so they still cover the ground
    const phase = rand();

    for (let j = 0; j < o.perTuft && i < count; j++, i++) {
      const r = radius * Math.sqrt(-2 * Math.log(1 - rand() * 0.98)) * 0.55;
      const a = rand() * Math.PI * 2;
      const b = i * FLOATS;
      const stalk = rand() < 0.04;
      data[b] = cx + Math.cos(a) * r;
      data[b + 1] = cz + Math.sin(a) * r;
      data[b + 2] = 1.5 * heightScale * (0.55 + rand() * 0.9) * (1 - 0.3 * Math.min(1, r / (radius * 1.2))) * (stalk ? 1.7 : 1) * o.heightMul;
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
  const strip = new Float32Array((SEGMENTS + 1) * 4);
  for (let s = 0; s <= SEGMENTS; s++) strip.set([-1, s / SEGMENTS, 1, s / SEGMENTS], s * 4);
  const vao = gl.createVertexArray();
  const b1 = gl.createBuffer();
  const b2 = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, b1);
  gl.bufferData(gl.ARRAY_BUFFER, strip, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, b2);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  [[1, 2, 0], [2, 4, 8], [3, 2, 24], [4, 4, 32]].forEach(([loc, size, off]) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS * 4, off);
    gl.vertexAttribDivisor(loc, 1);
  });
  gl.bindVertexArray(null);
  return { vao, buffers: [b1, b2], count, vertices: (SEGMENTS + 1) * 2 };
}

function destroyLayers(gl, layers) {
  layers.forEach((l) => {
    l.buffers.forEach((b) => gl.deleteBuffer(b));
    gl.deleteVertexArray(l.vao);
  });
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
  return { tex, fbo };
}

function makeSceneTarget(gl, w, h, paint, samples, paintScale) {
  const ss = Math.min(samples, gl.getParameter(gl.MAX_SAMPLES));
  const msColor = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, ss, gl.RGBA8, w, h);
  const msDepth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, ss, gl.DEPTH_COMPONENT24, w, h);
  const msFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);

  const resTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, resTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
  return { w, h, samples: samples, paintScale, msColor, msDepth, msFbo, resTex, resFbo, extra };
}

function destroySceneTarget(gl, t) {
  gl.deleteRenderbuffer(t.msColor);
  gl.deleteRenderbuffer(t.msDepth);
  gl.deleteFramebuffer(t.msFbo);
  gl.deleteTexture(t.resTex);
  gl.deleteFramebuffer(t.resFbo);
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

async function loadRock(gl, url = "/models/logo/logo.png") {
  const img = await loadImage(url);
  const long = Math.max(img.width, img.height);
  const iw = img.width / long, ih = img.height / long;            // logo size in logo units (long side = 1)
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
  let anyAlpha = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { anyAlpha = true; break; }
  const cover = new Float32Array(cw * ch);                          // how much of each pixel is the logo
  for (let i = 0; i < cover.length; i++) {
    cover[i] = anyAlpha ? px[i * 4 + 3] / 255 : 1 - (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
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
  const nx = Math.max(8, Math.round(240 * (ew / long2))), nz = Math.max(8, Math.round(240 * (eh / long2)));
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
  return { vao, vbo, ibo, sdf, count: idx.length, extent: [ew, eh], sil, cw, ch };
}

function destroyRock(gl, r) {
  [r.vbo, r.ibo].forEach((b) => gl.deleteBuffer(b));
  gl.deleteVertexArray(r.vao);
  gl.deleteTexture(r.sdf);
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
  boxBlur(m, MASK_RES, MASK_RES, 3, 2);                              // wide feather: the grass thins out in a soft halo around the stone
  const bytes = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) bytes[i] = Math.min(255, Math.round(m[i] * 255 * 2.6));
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MASK_RES, MASK_RES, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  return rect;
}

// ---- component --------------------------------------------------------------

const Meadow = forwardRef(function Meadow({ values }, ref) {
  const canvasRef = useRef(null);
  const valuesRef = useRef(values);
  const apiRef = useRef(null);
  const captureRef = useRef(null);
  const statsRef = useRef(null);
  const [failed, setFailed] = useState(false);

  valuesRef.current = values;
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
        blade: program(gl, BLADE_VERT, BLADE_FRAG),
        rock: program(gl, ROCK_VERT, ROCK_FRAG),
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
    const paintSupported = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    let scene = null;
    let rock = null;
    let disposed = false;
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
    loadRock(gl)
      .then((r) => {
        if (disposed) destroyRock(gl, r);
        else rock = r;
      })
      .catch((err) => console.error("rock failed to build", err));

    // Plants the blades for the current camera and growth settings.
    apiRef.current = {
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
          ...base, perTuft: g.bladesPerTuft, radiusMul: g.tuftSize, heightMul: 1, widthMul: 1, dryChance: g.dryTufts,
        })];
        if (g.undergrowth > 0.01) {
          // a dense short layer under the tall tufts so the ground never shows through
          next.push(makeBlades(gl, Math.round(counts.under * g.density * g.undergrowth), {
            ...base, seed: g.seed + 12, perTuft: 8, radiusMul: g.tuftSize * 0.5, heightMul: g.undergrowthHeight, widthMul: 1.4, dryChance: 0,
          }));
        }
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
        scene = makeSceneTarget(gl, w, h, wantPaint, samples, paintScale);
      }

      // The wind swings slowly around its mean, so for stretches it blows more sideways.
      const meanAngle = rad(wd.direction);
      const swing = (0.8 * Math.sin(time * 0.07) + 0.45 * Math.sin(time * 0.19 + 2.0) + 0.2 * Math.sin(time * 0.43 + 4.0)) * wd.wander;
      const windDir = [Math.sin(meanAngle + swing), -Math.cos(meanAngle + swing)];
      const baseDir = [Math.sin(meanAngle), -Math.cos(meanAngle)];
      adv = [adv[0] + windDir[0] * stepT, adv[1] + windDir[1] * stepT];

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
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.msFbo);
      gl.viewport(0, 0, w, h);

      // camera: slow drift plus pointer parallax, a touch of roll like a handheld shot
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      const px = pointer.x * cm.parallax;
      const py = pointer.y * cm.parallax;
      const eye = [Math.sin(time * 0.25) * 0.5 * cm.drift + px * 1.2, cm.height - py * 0.5, cm.distance + Math.sin(time * 0.19) * 0.4 * cm.drift];
      const target = [px * 1.5, 0, cm.lookAhead + Math.sin(time * 0.15) * 0.5 * cm.drift - py];
      const cam = camera(eye, target, rad(cm.roll) + Math.sin(time * 0.1) * 0.04 * cm.drift, rad(cm.fov), w / h);

      const fogRgb = hex(at.hazeColor);
      gl.clearColor(fogRgb[0] * 0.4, fogRgb[1] * 0.4, fogRgb[2] * 0.4, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, windTarget.tex);

      // 2. ground under the blades
      qBegin("ground + character");
      gl.useProgram(progs.ground);
      gl.uniformMatrix4fv(progs.ground.u("uVP"), false, cam.vp);
      gl.uniform4fv(progs.ground.u("uRect"), WIND_RECT);
      gl.uniform1i(progs.ground.u("uWind"), 0);
      gl.uniform3fv(progs.ground.u("uCamera"), eye);
      gl.uniform2fv(progs.ground.u("uDir"), windDir);
      f3(progs.ground, "uSoil", hex(co.soil));
      f3(progs.ground, "uMeadow", hex(co.meadow));
      f1(progs.ground, "uFog", at.haze);
      f3(progs.ground, "uFogColor", fogRgb);
      gl.bindVertexArray(ground.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 2b. the logo rock (static, depth-tested so grass can sweep over and around it)
      const ch = v.rock;
      const showRock = !!(rock && ch && ch.show);
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
        gl.uniformMatrix4fv(C.u("uVP"), false, cam.vp);
        gl.uniformMatrix4fv(C.u("uModel"), false, rockModel(ch));
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, rock.sdf);
        gl.uniform1i(C.u("uSdf"), 2);
        gl.uniform2fv(C.u("uExtent"), rock.extent);
        f1(C, "uDMax", ROCK_DMAX);
        f1(C, "uT", ch.thickness);
        f1(C, "uRb", ch.roundness);
        f1(C, "uNoise", ch.jaggedness);
        f1(C, "uFreq", ch.grain);
        f1(C, "uRough", ch.roughness);
        f1(C, "uSeed", ch.seed);
        f1(C, "uInflate", ch.inflate);
        gl.uniform3fv(C.u("uCamera"), eye);
        f3(C, "uSun", [Math.cos(rad(li.sunElevation)) * Math.sin(rad(li.sunAzimuth)), Math.sin(rad(li.sunElevation)), -Math.cos(rad(li.sunElevation)) * Math.cos(rad(li.sunAzimuth))]);
        f3(C, "uSunColor", hex(li.sunColor));
        f3(C, "uSky", hex(li.skyColor));
        f3(C, "uStone", hex(ch.stone));
        f3(C, "uMoss", hex(ch.mossColor));
        f1(C, "uMossAmt", ch.moss);
        f1(C, "uBright", ch.brightness);
        f1(C, "uAmbient", ch.ambient);
        f1(C, "uSunlight", li.sunlight * 1.25);
        f1(C, "uFog", at.haze);
        f3(C, "uFogColor", fogRgb);
        gl.bindVertexArray(rock.vao);
        gl.drawElements(gl.TRIANGLES, rock.count, gl.UNSIGNED_INT, 0);
        gl.activeTexture(gl.TEXTURE0);
      }

      qEnd();
      // 3. blades
      qBegin("blades");
      const B = progs.blade;
      gl.useProgram(B);
      gl.uniformMatrix4fv(B.u("uVP"), false, cam.vp);
      gl.uniform4fv(B.u("uRect"), WIND_RECT);
      gl.uniform1i(B.u("uWindTex"), 0);
      f1(B, "uTime", time);
      f1(B, "uWind", wd.strength);
      gl.uniform2fv(B.u("uDir"), windDir);
      gl.uniform3fv(B.u("uCamera"), eye);
      f1(B, "uHeight", gr.height);
      f1(B, "uHeightContrast", gr.heightContrast);
      f1(B, "uWidthMul", gr.width);
      f1(B, "uTaper", gr.tipSharpness);
      f1(B, "uCurl", gr.curl);
      f1(B, "uStiff", gr.stiffnessVariation);
      f1(B, "uBaseBend", wd.baseBend);
      f1(B, "uGustBend", wd.gustBend);
      f1(B, "uFlutter", wd.flutter);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.uniform1i(B.u("uMask"), 5);
      gl.uniform4fv(B.u("uMaskRect"), maskRect);
      gl.uniform2f(B.u("uOver"), showRock ? ch.grassKeep : 1, showRock ? ch.grassHeight : 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform3f(B.u("uThin"), at.thinStart, Math.max(at.thinEnd, at.thinStart + 1), at.thinKeep);
      f3(B, "uMeadow", hex(co.meadow));
      f3(B, "uFresh", hex(co.fresh));
      f3(B, "uCool", hex(co.cool));
      f3(B, "uStraw", hex(co.straw));
      f3(B, "uTipColor", hex(co.tip));
      f3(B, "uDryTip", hex(co.dryTip));
      f3(B, "uSoil", hex(co.soil));
      f1(B, "uSat", co.saturation);
      f1(B, "uBright", co.brightness);
      f1(B, "uToneVar", co.toneVariation);
      f1(B, "uPatch", co.patchStrength);
      f1(B, "uPatchSize", co.patchSize);
      f1(B, "uDryStrength", co.dryStrength);
      f1(B, "uDryTips", co.dryTips);
      f1(B, "uLaneBright", ln.brightness);
      const az = rad(li.sunAzimuth), el = rad(li.sunElevation);
      f3(B, "uSun", [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)]);
      f3(B, "uSunColor", hex(li.sunColor));
      f3(B, "uSky", hex(li.skyColor));
      f3(B, "uBackColor", hex(li.backlightColor));
      f1(B, "uSunlight", li.sunlight);
      f1(B, "uAmbient", li.ambient);
      f1(B, "uBacklight", li.backlight);
      f1(B, "uSheen", li.sheen);
      f1(B, "uCanopy", li.canopyShadow);
      f1(B, "uRoot", li.rootShade);
      f1(B, "uCrease", li.crease);
      f1(B, "uUnderside", li.underside);
      f1(B, "uFog", at.haze);
      f3(B, "uFogColor", fogRgb);
      for (const layer of layers) {
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
        f3(F, "uSunColor", hex(li.sunColor));
        f3(F, "uCenter", hex(fl.center));
        f1(F, "uFog", at.haze);
        f3(F, "uFogColor", fogRgb);
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
        gl.uniform4fv(P.u("uSpawn"), groundRect([0, cm.height, cm.distance], [0, 0, cm.lookAhead], rad(cm.fov), w / h));
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
        f1(P, "uFog", at.haze);
        f3(P, "uFogColor", fogRgb);
        gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        gl.bindVertexArray(particles.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(particles.max, Math.round(particles.max * Math.min(db.amount, 1))));
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
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
      gl.deleteTexture(maskTex);
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
