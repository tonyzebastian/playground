// Flock in Flight, the game: owns the renderer, the camera and the frame loop,
// and wires the world, flock, threats, weather and sound together.
//
// The camera looks down on the flock while it cruises and swings in behind it
// as it dives. The cursor steers; holding dives.
import * as THREE from 'three';
import { createFrameLoop } from '@/lib/frame-loop';
import { loadKit, loadTrees } from './assets';
import { createAudio } from './audio';
import { CRUISE, createFlock } from './flock';
import { createFx } from './fx';
import { heightAt } from './ground';
import { blurMaterial, brightMaterial, createUniforms, postMaterial, raysMaterial } from './materials';
import { clamp, damp, lerp, smoothstep } from './noise';
import { createSky } from './sky';
import { createThreats } from './threats';
import { TUNE } from './tuning';
import { createWorld } from './world';

const START_BIRDS = 7;

// Views the player can switch between (C). `behind` is how far the camera has
// swung in behind the flock: null lets it follow the dive, as the game was
// designed; the others hold one view at every height. The chase views, their
// roll with the bank and the way they widen with speed follow Petalwake
// (MIT, Jacob Miller, https://github.com/jjcm/petalwake).
export const CAMERAS = [
  { name: 'Follow', behind: null, back: 1, height: 1, fov: 0 },
  { name: 'Chase', behind: 1, back: 1.55, height: 2, fov: 0 }, // far enough back to keep the whole flock in frame
  { name: 'Far chase', behind: 1, back: 2.6, height: 4.2, fov: -8 },
  { name: 'Overhead', behind: 0, back: 1, height: 1, fov: 0 },
];

export async function createGame(canvas, { preview = false, onEvent = () => {}, onWarnings = null } = {}) {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const lite = preview || coarse || Math.min(window.innerWidth, window.innerHeight) < 600;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 2600);
  // Desktop draws the scene in HDR with a readable depth, which bloom, god
  // rays and motion blur need; the lite path keeps the plain 8-bit target.
  const hdr = !lite && renderer.extensions.has('EXT_color_buffer_float');
  const target = hdr
    ? new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(4, 4) })
    : new THREE.WebGLRenderTarget(4, 4, { samples: lite ? 0 : 4 });
  const small = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  const glowA = hdr ? small() : null;
  const glowB = hdr ? small() : null;
  const raysT = hdr ? small() : null;
  const bright = brightMaterial();
  const blur = blurMaterial();
  const rays = raysMaterial();
  const viewProj = new THREE.Matrix4();
  const sunAt = new THREE.Vector3();
  const U = createUniforms();
  const post = postMaterial(U);
  post.uniforms.tScene.value = target.texture;
  if (hdr) {
    post.uniforms.tDepth.value = bright.uniforms.tDepth.value = target.depthTexture;
    post.uniforms.tBloom.value = glowA.texture;
    post.uniforms.tRays.value = raysT.texture;
    bright.uniforms.tScene.value = target.texture;
  }
  const postScene = new THREE.Scene();
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  postQuad.frustumCulled = false;
  postScene.add(postQuad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Sun shadows: the scene's shadow casters (layer 1) drawn from the sun into a
  // depth texture that the painter shader reads. Desktop only.
  const SHADOW = lite ? 0 : 2048;
  const SHADOW_REACH = 200;
  const shadowTarget = SHADOW ? new THREE.WebGLRenderTarget(SHADOW, SHADOW) : null;
  const shadowCam = new THREE.OrthographicCamera(-SHADOW_REACH, SHADOW_REACH, SHADOW_REACH, -SHADOW_REACH, 120, 960);
  shadowCam.layers.set(1);
  if (shadowTarget) {
    shadowTarget.depthTexture = new THREE.DepthTexture(SHADOW, SHADOW);
    U.uShadowTexel.value = 1 / SHADOW;
  }
  const focus = new THREE.Vector3();
  const axis = new THREE.Vector3();
  function renderShadows(x, z) {
    // Follow the flock in whole texels, so shadow edges do not crawl.
    focus.set(x, 0, z);
    shadowCam.position.copy(focus).addScaledVector(U.uSun.value, 420);
    shadowCam.lookAt(focus);
    shadowCam.updateMatrixWorld();
    const texel = (SHADOW_REACH * 2) / SHADOW;
    for (const col of [0, 1]) {
      axis.setFromMatrixColumn(shadowCam.matrixWorld, col);
      const d = focus.dot(axis);
      focus.addScaledVector(axis, Math.round(d / texel) * texel - d);
    }
    shadowCam.position.copy(focus).addScaledVector(U.uSun.value, 420);
    shadowCam.updateMatrixWorld();
    U.uShadowOn.value = 0;
    U.uShadowMap.value = null;
    renderer.setRenderTarget(shadowTarget);
    renderer.render(scene, shadowCam);
    U.uShadowMatrix.value.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
    U.uShadowMap.value = shadowTarget.depthTexture;
    U.uShadowOn.value = 1;
  }

  let kit;
  try {
    const [models, baked] = await Promise.all([loadKit(), loadTrees()]);
    kit = { ...models, trees: baked.trees, ground: { grass: baked.grass, dirt: baked.dirt } };
  } catch (error) {
    renderer.dispose();
    throw error;
  }

  const audio = createAudio();
  const fx = createFx(scene, U, kit);
  const world = createWorld(scene, U, kit, { lite, fx });
  const sky = createSky(scene, U, { lite });
  const flock = createFlock(scene, U, kit, fx);
  const G = { scene, U, kit, fx, world, sky, flock, audio, camera, lite, level: 0, dist: 0, shake: 0, hit };
  const threats = createThreats(G);

  let state = 'attract'; // attract | play | over
  let time = 0;
  let startZ = 0;
  let invuln = 0;
  let hurt = 0;
  let recruited = 0;
  let overTimer = 0;
  let lastCause = '';
  let hudTimer = 0;
  let camK = 0;
  let camMode = preview ? 0 : 1; // the game opens in the chase view; the gallery card keeps the overhead one
  let camBack = 1;
  let camUp = 1;
  let camRoll = 0;
  let lastX = 0;
  let aspect = 1;
  let xr = 42;
  let zoom = 1;
  const input = { nx: 0, ny: 0, dive: false, climb: false };
  const auto = { nx: 0, ny: 0, dive: false, climb: false };
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const v = new THREE.Vector3();
  const warnList = [];
  const warnOut = [];

  flock.reset(START_BIRDS, 0);
  world.update(0, 0, true);

  function hit(bird, cause, item, force = false) {
    if (state !== 'play' || (invuln > 0 && !force) || G.god || TUNE.threats.invincible) return;
    if (item) item.hits++;
    const left = flock.lose(bird, (Math.random() - 0.5) * 14, 5, 12);
    invuln = 0.75;
    hurt = 1;
    G.shake = 1;
    lastCause = cause;
    audio.hit();
    onEvent('birds', { birds: left, change: -1, cause });
    if (left === 0) {
      state = 'over';
      overTimer = 1.5;
      audio.over();
    }
  }

  function start() {
    audio.start();
    state = 'play';
    startZ = flock.ctrl.z;
    G.level = 0;
    G.dist = 0;
    recruited = 0;
    invuln = 2;
    threats.reset();
    sky.reset();
    flock.reset(START_BIRDS, startZ);
    onEvent('state', { state });
    onEvent('birds', { birds: START_BIRDS, change: 0 });
  }

  // Draw one full-screen pass into a target.
  function pass(material, into) {
    postQuad.material = material;
    renderer.setRenderTarget(into);
    renderer.render(postScene, postCam);
  }

  function resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, preview ? 1.25 : lite ? 1.6 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    target.setSize(Math.round(w * dpr), Math.round(h * dpr));
    if (hdr) {
      const qw = Math.max(2, Math.round((w * dpr) / 4));
      const qh = Math.max(2, Math.round((h * dpr) / 4));
      for (const t of [glowA, glowB, raysT]) t.setSize(qw, qh);
      bright.uniforms.uTexel.value.set(1 / (w * dpr), 1 / (h * dpr));
    }
    aspect = w / h;
    camera.aspect = aspect;
    // The gallery card sits closer, so the flock still reads at thumbnail size.
    zoom = clamp(1.15 / aspect, 1, 1.7) * (preview ? 0.6 : 1);
    xr = Math.min(42, 28.6 * zoom * aspect * 0.8);
    post.uniforms.uTexel.value.set(1 / (w * dpr), 1 / (h * dpr));
    post.uniforms.uAspect.value = aspect;
    fx.setViewport(h * dpr, 50);
  }

  function frame(dt) {
    time += dt;
    U.uTime.value = time;
    const c = flock.ctrl;
    const playing = state === 'play';

    auto.nx = Math.sin(time * 0.23) * 0.4 + Math.sin(time * 0.11) * 0.2;
    auto.ny = Math.sin(time * 0.17) * 0.3;
    c.speed = playing ? lerp(TUNE.flight.speed, TUNE.flight.diveSpeed, c.low) + Math.min(14, G.level * 1.2) : 28;
    if (reduced && !playing) c.speed = 8;
    flock.update(dt, playing ? input : auto, xr, playing ? Math.sin(time * 0.7) * 9 * sky.storm : 0);
    world.update(c.z);

    if (playing) {
      G.dist = startZ - c.z;
      G.level = Math.floor(G.dist / 1100);
      invuln -= dt;
    }
    threats.update(dt, xr, playing);
    const joined = flock.takeJoined();
    if (joined) {
      recruited += joined;
      audio.recruit();
      onEvent('birds', { birds: flock.birds.length, change: joined });
    }
    if (state === 'over' && overTimer > 0) {
      overTimer -= dt;
      if (overTimer <= 0) onEvent('state', { state, distance: G.dist, recruited, cause: lastCause });
    }

    // Camera: above the flock while cruising, behind it when low.
    const cam = TUNE.camera;
    const view = CAMERAS[camMode];
    camK += ((view.behind ?? c.low) - camK) * damp(cam.swing, dt);
    camBack += (view.back - camBack) * damp(2.4, dt);
    camUp += (view.height - camUp) * damp(2.4, dt);
    // Lean with the turn, and widen a little as the flock gathers speed.
    const vx = (c.x - lastX) / Math.max(dt, 1e-3);
    lastX = c.x;
    camRoll += (clamp(-vx * 0.012, -0.3, 0.3) * cam.roll - camRoll) * damp(4.2, dt);
    const rush = clamp((c.speed - TUNE.flight.speed) / 30);
    const e = smoothstep(0, 1, camK);
    const cx = c.x * lerp(0.35, 0.84, e);
    const top = Math.max(CRUISE, c.y); // the camera rides up with a flock that climbs
    // In a long dive the birds trail their leader: the chase camera stays with the birds.
    let by = c.y;
    if (flock.birds.length) by = flock.birds.reduce((sum, b) => sum + b.pos.y, 0) / flock.birds.length;
    camPos.set(cx, lerp(top + cam.height * zoom, by + cam.chaseHeight * camUp, e), lerp(c.z + cam.back * zoom, flock.leader.z + cam.chaseBack * camBack, e));
    camLook.set(c.x * lerp(0.35, 0.9, e), lerp(top, by + 0.5, e), lerp(c.z - cam.lookAhead, flock.leader.z - 60, e));
    camPos.y = Math.max(camPos.y, heightAt(camPos.x, camPos.z) + 3);
    G.shake *= Math.exp(-dt * 6);
    if (G.shake > 0.01 && !reduced) camPos.add(v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(G.shake * 1.6));
    camera.position.copy(camPos);
    camera.fov = lerp(cam.fov, cam.chaseFov + view.fov + rush * cam.speedFov, e);
    camera.updateProjectionMatrix();
    camera.lookAt(camLook);
    if (!reduced) camera.rotateZ(camRoll * e);

    sky.update(dt, c.z, camPos, c.speed);
    flock.draw();
    fx.update(dt);
    audio.update({ speed: c.speed / 60, low: c.low, high: c.high, rainK: sky.rain, storm: sky.storm, playing });

    U.uLight.value.set(TUNE.light.sun, TUNE.light.ambient, TUNE.light.sunShadows, TUNE.light.rim);
    post.uniforms.uGrade.value.set(TUNE.grade.exposure, TUNE.grade.saturation, TUNE.grade.contrast, TUNE.grade.highlights);
    post.uniforms.uGrade2.value.set(TUNE.grade.warmth, TUNE.grade.vignette);
    hurt *= Math.exp(-dt * 2.2);
    post.uniforms.uHurt.value = hurt;
    post.uniforms.uSpeed.value = reduced ? 0 : e;
    if (shadowTarget) renderShadows(c.x * 0.6, c.z - 70);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    if (hdr) {
      const g = TUNE.grade;
      // The glow: bright parts at quarter size, blurred twice, the second time wider.
      bright.uniforms.uThreshold.value = g.bloomThreshold;
      pass(bright, glowA);
      for (const reach of [1, 2.4]) {
        blur.uniforms.tSrc.value = glowA.texture;
        blur.uniforms.uStep.value.set(reach / glowA.width, 0);
        pass(blur, glowB);
        blur.uniforms.tSrc.value = glowB.texture;
        blur.uniforms.uStep.value.set(0, reach / glowA.height);
        pass(blur, glowA);
      }
      // God rays, only while the sun is in or near the picture.
      sunAt.copy(camera.position).addScaledVector(U.uSun.value, 1000).project(camera);
      const sunSeen = sunAt.z < 1 ? (1 - smoothstep(1, 1.9, Math.max(Math.abs(sunAt.x), Math.abs(sunAt.y)))) * (1 - sky.storm) : 0;
      if (sunSeen > 0 && g.godRays > 0) {
        rays.uniforms.tSrc.value = glowA.texture;
        rays.uniforms.uSun.value.set(sunAt.x * 0.5 + 0.5, sunAt.y * 0.5 + 0.5);
        rays.uniforms.uAspect.value = aspect;
        pass(rays, raysT);
      }
      // Motion blur follows the camera's own movement, the same at any frame rate.
      post.uniforms.uFx.value.set(g.bloom, sunSeen * g.godRays, reduced ? 0 : g.motionBlur * lerp(0.35, 1, e) * Math.min(2, 1 / 60 / Math.max(dt, 1e-3)));
      post.uniforms.uPrevViewProj.value.copy(viewProj);
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      post.uniforms.uInvViewProj.value.copy(viewProj).invert();
    }
    postQuad.material = post;
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);

    if (playing) {
      hudTimer -= dt;
      if (hudTimer <= 0) {
        hudTimer = 0.2;
        onEvent('hud', { distance: G.dist, level: G.level, low: c.low, storm: sky.storm });
      }
    }
    if (onWarnings) {
      warnOut.length = 0;
      if (playing) {
        for (const w of threats.warnings(warnList)) {
          v.set(w.x, w.y, w.z).project(camera);
          if (v.z > 1) continue;
          const on = Math.abs(v.x) < 0.94 && Math.abs(v.y) < 0.86;
          if (on && w.kind !== 'storm' && !w.always && !w.bottom) continue;
          warnOut.push({ kind: w.kind, x: clamp(v.x, -0.9, 0.9) * 0.5 + 0.5, y: w.bottom ? 0.83 : 0.5 - clamp(v.y, -0.7, 0.7) * 0.5, alpha: 1 - smoothstep(380, 560, w.ahead) });
        }
      }
      onWarnings(warnOut);
    }
  }

  // Development handle for poking at the scene from the console.
  if (process.env.NODE_ENV !== 'production') window.__flock = { G, flock, threats, sky, world };

  const stop = createFrameLoop(canvas, frame);
  const onVisibility = () => (document.hidden ? audio.suspend() : audio.resume());
  document.addEventListener('visibilitychange', onVisibility);

  return {
    start,
    resize,
    coarse,
    setPointer(nx, ny) {
      input.nx = nx;
      input.ny = ny;
    },
    setDive(on) {
      input.dive = on;
    },
    setClimb(on) {
      input.climb = on;
    },
    // Switch to the next view; returns its name.
    nextCamera() {
      camMode = (camMode + 1) % CAMERAS.length;
      return CAMERAS[camMode].name;
    },
    setMuted: (m) => audio.setMuted(m),
    dispose() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      threats.dispose();
      flock.dispose();
      sky.dispose();
      world.dispose();
      fx.dispose();
      audio.dispose();
      target.dispose();
      for (const t of [glowA, glowB, raysT]) if (t) t.dispose();
      for (const m of [bright, blur, rays]) m.dispose();
      if (shadowTarget) shadowTarget.dispose();
      post.dispose();
      postQuad.geometry.dispose();
      renderer.dispose();
    },
  };
}
