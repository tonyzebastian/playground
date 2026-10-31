import { createFrameLoop } from '@/lib/frame-loop';
import { FROST_MOODS } from './frostConfig';
import { createStreet, EYE, FOCAL, HORIZON, LIGHT_STRIDE, MAX_BUILDINGS, MAX_GLARE, MAX_LIGHTS, MAX_PEOPLE, MAX_POOLS, MAX_TREES, MAX_VEHICLES } from './street';
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
uniform vec4 uBuildings[${MAX_BUILDINGS * 3}];
uniform int uBuildingCount;
uniform vec4 uVehicles[${MAX_VEHICLES * 3}];
uniform int uVehicleCount;
uniform vec4 uTrees[${MAX_TREES * 2}];
uniform int uTreeCount;
uniform vec4 uPeople[${MAX_PEOPLE * 2}];
uniform int uPeopleCount;
uniform vec4 uPools[${MAX_POOLS * 2}];
uniform int uPoolCount;
out vec4 outColor;
${HASH}

const float F = ${FOCAL.toFixed(4)};
const float EYE = ${EYE.toFixed(4)};
const float HZ = ${HORIZON.toFixed(4)};

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

vec3 paintColor(float k) {
  if (k < -1.5) return vec3(0.62, 0.64, 0.66);   // truck box
  if (k < -0.5) return vec3(0.5, 0.1, 0.07);     // bus
  if (k < 0.5) return vec3(0.03);
  if (k < 1.5) return vec3(0.45, 0.47, 0.5);
  if (k < 2.5) return vec3(0.72, 0.73, 0.75);
  if (k < 3.5) return vec3(0.42, 0.05, 0.04);
  if (k < 4.5) return vec3(0.05, 0.08, 0.18);
  if (k < 5.5) return vec3(0.18);
  return vec3(0.1, 0.2, 0.22);
}

// The air: dark overhead, glowing where the street opens onto the city.
vec3 sky(vec2 p) {
  float cx = uAspect * 0.5;
  vec3 c = mix(uSkyHorizon, uSkyTop, smoothstep(HZ - 0.05, 1.0, p.y));
  vec2 g = (p - vec2(cx, HZ)) * vec2(1.6, 4.0);
  c += uGlow * exp(-dot(g, g) * 3.0) * 0.55;
  return c;
}

// Distance haze: everything far away sinks into the glow at the end of the street.
vec3 hazeOf(vec2 p) {
  return mix(uSkyHorizon, uGlow, 0.35) * 0.9;
}

// Towers beyond the end of the street, in layers that fade with distance.
vec3 city(vec2 p, vec3 base) {
  float cx = uAspect * 0.5;
  vec3 c = base;
  for (int k = 3; k >= 0; k--) {
    float D = 380.0 * pow(1.9, float(k));
    float lateral = (p.x - cx) * D / F;
    float w = 26.0 + float(k) * 12.0;
    float id = floor(lateral / w + float(k) * 3.7);
    float fx = fract(lateral / w + float(k) * 3.7);
    float h = hash12(vec2(id, float(k)));
    float H = 18.0 + 150.0 * h * h;
    // Some towers carry a spire.
    float spire = step(0.86, hash12(vec2(id, float(k) + 9.0))) * step(abs(fx - 0.5), 0.05) * 40.0;
    float top = HZ + (H - EYE) * F / D;
    float spireTop = HZ + (H + spire - EYE) * F / D;
    float inside = step(0.08, fx) * step(fx, 0.92);
    float hit = max(step(p.y, top) * inside, step(p.y, spireTop) * step(0.5, spire));
    if (hit > 0.5 && p.y > HZ - 0.02) {
      float haze = 0.35 + 0.17 * float(k);
      vec3 t = mix(uBuilding * 0.7, hazeOf(p), haze);
      // A scatter of faint lit windows.
      vec2 wv = vec2(lateral / 3.0, (p.y - HZ) * D / F / 3.2);
      float lit = step(0.9, hash12(floor(wv) + id)) * box(fract(wv), vec2(0.25), vec2(0.75));
      c = t + uWindow * lit * 0.5 * (1.0 - haze) * uWindows;
    }
  }
  return c;
}

// The buildings along both sides. Each pixel is traced to the nearest facade, end wall or
// rooftop. Returns the colour and writes the distance hit (1e5 if nothing).
vec3 street(vec2 p, out float hitD) {
  float cx = uAspect * 0.5;
  float dx = p.x - cx;
  hitD = 1e5;
  int hitI = -1;
  float hu = 0.0;
  float hv = 0.0;
  float face = 0.0;   // 0 front, 1 end wall, 2 rooftop clutter
  for (int i = 0; i < ${MAX_BUILDINGS}; i++) {
    if (i >= uBuildingCount) break;
    vec4 A = uBuildings[i * 3];       // side, d0, d1, height
    vec4 C = uBuildings[i * 3 + 2];   // shop + type*8, tone, depth, wash
    if (A.x * dx <= 0.0) continue;
    float d = A.x * F / dx;
    if (d >= A.y && d <= A.z && d < hitD) {
      float h = (p.y - HZ) * d / F + EYE;
      if (h >= 0.0 && h <= A.w) { hitD = d; hitI = i; hu = d - A.y; hv = h; face = 0.0; }
      else if (h > A.w) {
        // Plant rooms and tanks on the roof.
        float unit = floor((d - A.y) / 5.0 + float(i));
        float clutter = step(0.55, hash12(vec2(unit, float(i)))) * (1.5 + 2.5 * hash12(vec2(unit, float(i) + 3.0)));
        if (h < A.w + clutter) { hitD = d; hitI = i; hu = d - A.y; hv = h; face = 2.0; }
      }
    }
    // The end wall facing us, where the building starts.
    float sidePx = dx * A.y / F;
    float into = abs(sidePx) - abs(A.x);
    if (into > 0.0 && into < C.z && A.y < hitD) {
      float h = (p.y - HZ) * A.y / F + EYE;
      if (h >= 0.0 && h <= A.w) { hitD = A.y; hitI = i; hu = into; hv = h; face = 1.0; }
    }
  }
  if (hitI < 0) return vec3(0.0);

  vec4 A = uBuildings[hitI * 3];
  vec4 B = uBuildings[hitI * 3 + 1];   // floor height, column width, lit share, warmth
  vec4 C = uBuildings[hitI * 3 + 2];
  float seed = float(hitI) * 17.31;
  float shop = mod(C.x, 8.0);
  float type = floor(C.x / 8.0 + 0.01);
  vec3 wall = uBuilding * C.y * (0.85 + 0.3 * hash12(vec2(seed, 2.0)));
  // A painterly unevenness across each wall.
  wall *= 0.85 + 0.3 * vnoise(vec2(hu * 0.15 + seed, hv * 0.1));
  if (face > 1.5) return mix(wall * 0.6, hazeOf(p), 1.0 - exp(-hitD / 260.0));
  if (face > 0.5) wall *= 0.55;
  // Street light washes the lower floors; some facades glow warm all the way up.
  wall *= 0.7 + 0.5 * exp(-hv / 6.0);
  wall += uGlow * C.w * 0.22 * exp(-hv / 10.0) * (face > 0.5 ? 0.4 : 1.0);
  if (type > 2.5) wall = mix(wall, mix(uSkyTop, uSkyHorizon, 0.5 + 0.4 * hv / A.w) * 0.8, 0.6);

  vec3 lit3 = vec3(0.0);
  vec2 grid = vec2(hu / B.y, hv / B.x);
  vec2 cell = floor(grid);
  vec2 f = fract(grid);
  if (cell.y < 0.5 && shop > 0.5 && face < 0.5) {
    // Shopfront: a bright, uneven interior, a dark awning, a lit sign board above.
    float bay = floor(cell.x * 0.5);
    float pane = box(f, vec2(0.04, 0.06), vec2(0.96, 0.62)) * step(0.06, fract(grid.x * 0.5));
    float inside = 0.55 + 0.7 * vnoise(vec2(grid.x * 3.0, seed));
    inside *= 1.0 - 0.35 * step(0.5, fract(f.y * 4.0)) * step(0.25, f.y);
    lit3 += shopColor(shop) * pane * inside * 3.0;
    float board = box(f, vec2(0.03, 0.72), vec2(0.97, 0.94)) * step(0.35, hash12(vec2(bay, seed + 4.0)));
    lit3 += shopColor(1.0 + floor(hash12(vec2(bay, seed + 9.0)) * 4.0)) * board * 1.8;
    wall *= 1.0 - 0.5 * box(f, vec2(0.0, 0.62), vec2(1.0, 0.72));
  } else {
    float h = hash12(cell + seed + face * 5.0);
    float h2 = hash12(cell + seed + 7.7);
    float clock = floor(uTime / (35.0 + h * 90.0) + h * 7.0);
    float lit = step(hash12(cell + seed + clock * 1.37), B.z * (face > 0.5 ? 0.5 : 1.0));
    vec3 tint = mix(vec3(0.78, 0.88, 1.0), uWindow, clamp(0.35 + B.w * 0.65 + (h - 0.5) * 0.6, 0.0, 1.0));
    float level = 0.3 + 0.9 * hash12(cell + seed + 3.3);
    float pane;
    if (type > 0.5 && type < 1.5) {
      pane = box(f, vec2(0.0, 0.32), vec2(1.0, 0.86)) * step(0.05, f.x);
      lit = step(hash12(vec2(floor(grid.x * 0.3), cell.y) + seed + clock), B.z * 1.2);
      tint = mix(vec3(0.82, 0.9, 1.0), tint, 0.3);
    } else if (type > 1.5) {
      pane = box(f, vec2(0.32, 0.14), vec2(0.68, 0.86));
    } else {
      vec2 lo = vec2(0.14 + 0.16 * h2, 0.22 + 0.1 * hash12(cell.yy + seed));
      pane = box(f, lo, vec2(1.0 - lo.x, 0.8)) * step(0.1, h2);
    }
    float split = hash12(cell + seed + 11.0);
    float curtain = split < 0.45 ? 1.0 : smoothstep(split - 0.05, split + 0.05, f.x) * 0.75 + 0.25;
    float hot = 0.6 + 0.6 * exp(-dot(f - vec2(0.3 + 0.4 * h, 0.4), f - vec2(0.3 + 0.4 * h, 0.4)) * 10.0);
    if (h > 0.985) { level *= 0.4 + 0.6 * vnoise(vec2(uTime * 4.0, seed)); tint = vec3(0.6, 0.75, 1.0); }
    float recess = 1.0 - 0.45 * smoothstep(0.6, 0.86, f.y);
    lit3 += tint * pane * lit * level * curtain * hot * recess * 2.4;
    wall *= 1.0 - 0.2 * pane * (1.0 - lit);
  }
  vec3 c = wall + lit3 * uWindows;
  return mix(c, hazeOf(p), 1.0 - exp(-hitD / 260.0));
}

// Everything above the ground: buildings, the city beyond, the sky.
vec3 above(vec2 p, out float hitD) {
  vec3 c = street(p, hitD);
  if (hitD > 9e4) c = city(p, sky(p));
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uAspect, uv.y);
  float cx = uAspect * 0.5;

  float hitD;
  vec3 col = above(p, hitD);

  // The ground, where it is nearer than any building: a wet road that mirrors the street.
  if (p.y < HZ) {
    float dg = EYE * F / (HZ - p.y);
    if (dg < hitD) {
      float sideG = (p.x - cx) * dg / F;
      float a = abs(sideG);
      vec3 ground = a < 5.2 ? uGround * 0.8 : uGround * 1.5;
      ground += vec3(0.04) * smoothstep(0.12, 0.0, abs(a - 5.2)) * exp(-dg / 60.0);
      // Painted centre line, broken up the road.
      ground += vec3(0.18) * step(abs(sideG), 0.07) * step(fract(dg / 7.0), 0.45) * exp(-dg / 50.0);
      // Puddles: patches that mirror almost perfectly, ripples elsewhere.
      float puddle = smoothstep(0.45, 0.7, vnoise(vec2(sideG * 0.35, dg * 0.12)));
      vec2 rp = vec2(p.x + (vnoise(vec2(p.x * 60.0, p.y * 260.0)) - 0.5) * 0.006 * (1.0 - puddle), 2.0 * HZ - p.y);
      float rd;
      vec3 refl = above(rp, rd);
      float fresnel = mix(0.25, 0.85, exp(-(HZ - p.y) * 6.0));
      col = mix(ground, refl * 0.85, clamp(fresnel + puddle * 0.3, 0.0, 0.95));
      hitD = dg;
    }
  }

  // Trees on the pavements: a trunk and a ragged crown; the gaps drift a little.
  for (int i = 0; i < ${MAX_TREES}; i++) {
    if (i >= uTreeCount) break;
    vec4 T = uTrees[i * 2];
    vec4 U = uTrees[i * 2 + 1];
    if (abs(p.x - T.x) < U.x && p.y > T.y && p.y < T.z) col = mix(col, vec3(0.006), 0.9);
    vec2 dd = (p - vec2(T.x, T.z)) / T.w;
    if (dot(dd, dd) > 2.5) continue;
    dd.y *= 1.15;
    float n = vnoise(dd * 2.6 + U.y) * 0.5 + vnoise(dd * 6.5 + U.y * 2.0) * 0.3 + vnoise(dd * 14.0 + U.y) * 0.2;
    float edge = length(dd) - (0.62 + 0.45 * n);
    float gaps = smoothstep(0.58, 0.75, vnoise(dd * 11.0 + U.y + vec2(uTime * 0.12, uTime * 0.05)));
    float mask = smoothstep(0.06, -0.06, edge) * (1.0 - gaps * 0.8);
    col = mix(col, vec3(0.006, 0.009, 0.007) + uGlow * 0.06 * smoothstep(0.6, -0.8, dd.y), mask);
  }

  // Vehicles, far to near, as boxes: the end facing us, then the roof and side running away.
  for (int i = 0; i < ${MAX_VEHICLES}; i++) {
    if (i >= uVehicleCount) break;
    vec4 N = uVehicles[i * 3];       // near face: x0, x1, y0, y1
    vec4 R = uVehicles[i * 3 + 1];   // far face
    vec4 C = uVehicles[i * 3 + 2];   // type, lit end (0 head, 1 tail, 2 none), glow, paint
    float lo = 0.0;
    float hi = 1.0;
    // p lies inside the face interpolated between near (t = 0) and far (t = 1).
    float a1 = R.x - N.x; float b1 = p.x - N.x;
    if (abs(a1) > 1e-6) { if (a1 > 0.0) hi = min(hi, b1 / a1); else lo = max(lo, b1 / a1); } else if (b1 < 0.0) continue;
    float a2 = N.y - R.y; float b2 = N.y - p.x;
    if (abs(a2) > 1e-6) { if (a2 > 0.0) hi = min(hi, b2 / a2); else lo = max(lo, b2 / a2); } else if (b2 < 0.0) continue;
    float a3 = R.z - N.z; float b3 = p.y - N.z;
    if (abs(a3) > 1e-6) { if (a3 > 0.0) hi = min(hi, b3 / a3); else lo = max(lo, b3 / a3); } else if (b3 < 0.0) continue;
    float a4 = N.w - R.w; float b4 = N.w - p.y;
    if (abs(a4) > 1e-6) { if (a4 > 0.0) hi = min(hi, b4 / a4); else lo = max(lo, b4 / a4); } else if (b4 < 0.0) continue;
    if (lo > hi) continue;
    vec3 paint = paintColor(C.w);
    float lum = dot(paint, vec3(0.3, 0.6, 0.1));
    vec3 body;
    if (lo < 1e-4) {
      // The end facing us: lower body, glass above (narrower on a car), lamps at the corners.
      float u = (p.x - N.x) / max(N.y - N.x, 1e-4);
      float v = (p.y - N.z) / max(N.w - N.z, 1e-4);
      body = paint * 0.12 + uSkyHorizon * 0.15 * v + uGlow * 0.05;
      if (C.x < 0.5 || C.x > 2.5) {
        if (v > 0.58 && (u < 0.1 + (v - 0.58) * 0.4 || u > 0.9 - (v - 0.58) * 0.4)) continue;
        if (v > 0.6 && v < 0.94) body = vec3(0.01) + uSkyHorizon * 0.25 * (1.0 - v) + uGlow * 0.4 * exp(-pow((u - 0.3 - v * 0.2) / 0.06, 2.0));
      } else if (C.x < 1.5) {
        if (v > 0.45 && v < 0.85) body = mix(body, uWindow * 0.8, step(0.08, u) * step(u, 0.92));
      } else if (v > 0.55 && v < 0.85 && C.y < 1.5) {
        body = vec3(0.01) + uSkyHorizon * 0.2;
      }
      vec3 lamp = C.y < 0.5 ? vec3(1.0, 0.93, 0.82) : vec3(1.0, 0.12, 0.06);
      float corners = exp(-pow((u - 0.13) / 0.12, 2.0)) + exp(-pow((u - 0.87) / 0.12, 2.0));
      body += lamp * C.z * 0.8 * corners * exp(-pow((v - 0.4) / 0.18, 2.0));
      // A sheen of street light along the top edge.
      body += (uGlow * 0.6 + uSkyHorizon * 0.4) * exp(-pow((v - 0.55) / 0.04, 2.0)) * (0.4 + 0.6 * lum);
    } else {
      // Roof and side, running away from us.
      float yTop = mix(N.w, R.w, lo);
      bool roof = p.y > yTop - 0.002 * (1.0 + lo);
      body = roof ? paint * 0.18 + uSkyHorizon * 0.35 + uGlow * 0.15 : paint * 0.08 + uSkyHorizon * 0.08;
      if (!roof && C.x > 0.5 && C.x < 1.5) body = mix(body, uWindow * 0.7, step(0.45, fract(lo * 6.0)) * step(p.y, yTop - 0.004) * step(mix(N.z, R.z, lo) + (yTop - mix(N.z, R.z, lo)) * 0.45, p.y));
    }
    col = body;
  }

  // Lamplight pooled on the pavements, road and walls.
  for (int i = 0; i < ${MAX_POOLS}; i++) {
    if (i >= uPoolCount) break;
    vec4 P = uPools[i * 2];
    vec3 c = uPools[i * 2 + 1].rgb;
    vec2 d = (p - P.xy) * vec2(1.0, p.y < HZ ? 3.0 : 0.8);
    col += c * P.w * exp(-dot(d, d) / (P.z * P.z)) * (p.y < HZ ? 0.4 : 0.15);
  }

  // People on the pavements: dark shapes, soft at the edges.
  for (int i = 0; i < ${MAX_PEOPLE}; i++) {
    if (i >= uPeopleCount) break;
    vec4 P = uPeople[i * 2];
    vec4 Q = uPeople[i * 2 + 1];
    vec2 q = (p - P.xy) / P.z;
    if (abs(q.x) > 0.6 || q.y < -0.15 || q.y > 1.25) continue;
    float swing = sin(Q.x) * 0.07;
    float torso = length(max(abs(q - vec2(0.0, 0.6)) - vec2(0.07, 0.19), 0.0)) - 0.06;
    float head = length(q - vec2(0.0, 0.88)) - 0.065;
    vec2 hip = vec2(0.0, 0.4);
    vec2 l1 = q - hip; vec2 s1 = vec2(swing, 0.0) - hip;
    vec2 l2 = q - hip; vec2 s2 = vec2(-swing, 0.0) - hip;
    float leg1 = length(l1 - s1 * clamp(dot(l1, s1) / dot(s1, s1), 0.0, 1.0)) - 0.04;
    float leg2 = length(l2 - s2 * clamp(dot(l2, s2) / dot(s2, s2), 0.0, 1.0)) - 0.04;
    float sdf = min(min(torso, head), min(leg1, leg2));
    if (P.w > 0.5) {
      vec2 e = (q - vec2(0.05, 0.98)) / vec2(0.36, 0.17);
      sdf = min(sdf, max((length(e) - 1.0) * 0.17, 0.98 - q.y));
    }
    float mask = smoothstep(0.05, -0.05, sdf) * Q.z;
    vec2 sh = q * vec2(2.4, 9.0);
    col *= 1.0 - exp(-dot(sh, sh)) * 0.7 * Q.z;
    col = mix(col, vec3(Q.y * 0.25) + uSkyHorizon * 0.06 * smoothstep(0.75, 1.1, q.y), mask);
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
out vec2 vBeam;
out vec2 vBeamPos;
out vec2 vBeamWidth;
void main() {
  float kind = floor(aB.w + 0.001);
  float seed = fract(aB.w);
  float r = uSharp > 0.5 ? 0.0035 + aA.z * 0.05 : aA.z * uRadiusScale;
  vec2 motion = aC.xy;
  vec2 extent;
  vec2 center;
  if (kind > 1.5) {
    // A headlight beam: from the light, along aC.xy, widening as it goes.
    extent = abs(motion) * 0.5 + vec2(aA.z);
    center = aA.xy + motion * 0.5;
  } else if (kind > 0.5) {
    float len = aC.z;
    extent = vec2(r * 2.0 + abs(motion.x) * 0.5, r * (len * 0.5 + 1.4) + abs(motion.y) * 0.5);
    center = aA.xy - vec2(0.0, r * len * 0.5);
  } else {
    extent = vec2(r * (uSharp > 0.5 ? 3.0 : 3.4)) + abs(motion) * 0.5;
    center = aA.xy;
  }
  vec2 p = center + aCorner * extent;
  vLocal = (p - aA.xy) / r;
  vBeam = motion;
  vBeamPos = p - aA.xy;
  vBeamWidth = vec2(aC.z, aA.z);
  vSmear = motion * 0.5 / r;
  vKind = kind;
  vSeed = seed;
  vLength = aC.z;
  vScreen = p;
  // Lights toward the frame edges are clipped by the lens into a cat's eye.
  vOffset = (aA.xy - vec2(uAspect * 0.5, 0.5)) * 1.1;
  // A smeared light spreads the same light over a longer shape.
  float smear = kind > 1.5 ? 1.0 : 1.0 + length(motion) / max(r, 1e-4) * 0.55;
  float energy = kind > 1.5 ? 0.35 : uSharp > 0.5 ? 1.0 : pow(0.05 / max(r, 0.004), 1.4) * 0.42;
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
in vec2 vBeam;
in vec2 vBeamPos;
in vec2 vBeamWidth;
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

  if (vKind > 1.5) {
    // Headlight beam on wet tarmac: bright near the car, spreading and fading along the road,
    // broken up by the uneven wet surface.
    float L2 = max(dot(vBeam, vBeam), 1e-6);
    float t = dot(vBeamPos, vBeam) / L2;
    float across = length(vBeamPos - vBeam * t);
    float w = mix(vBeamWidth.x, vBeamWidth.y, clamp(t, 0.0, 1.0));
    float x = across / max(w, 1e-4);
    float sheen = 0.6 + 0.4 * vnoise(vScreen * vec2(60.0, 14.0) + vSeed * 9.0);
    v = exp(-x * x * 1.6) * smoothstep(-0.02, 0.06, t) * pow(max(1.0 - t, 0.0), 1.4) * sheen * 1.4;
  } else if (vKind > 0.5) {
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
  const sceneU = uniforms(sceneProgram, ['uRes', 'uAspect', 'uTime', 'uStore', 'uWindows', 'uSkyTop', 'uSkyHorizon', 'uGround', 'uBuilding', 'uWindow', 'uGlow', 'uBuildings', 'uBuildingCount', 'uVehicles', 'uVehicleCount', 'uPeople', 'uPeopleCount', 'uTrees', 'uTreeCount', 'uPools', 'uPoolCount']);
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
    gl.uniform4fv(sceneU.uBuildings, street.buildingData);
    gl.uniform1i(sceneU.uBuildingCount, counts.buildingCount);
    gl.uniform4fv(sceneU.uVehicles, street.vehicleData);
    gl.uniform1i(sceneU.uVehicleCount, counts.vehicleCount);
    gl.uniform4fv(sceneU.uTrees, street.treeData);
    gl.uniform1i(sceneU.uTreeCount, counts.treeCount);
    gl.uniform4fv(sceneU.uPeople, street.peopleData);
    gl.uniform1i(sceneU.uPeopleCount, counts.peopleCount);
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
