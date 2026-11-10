// Sound for Flock in Flight. Everything is a recording loaded from
// /sounds/flock (built by scripts/flock/build_sounds.py): two pieces of music
// that alternate, three ambience beds, and a small set of one-shot effects.
// The mix is deliberately quiet: music first, weather under it, effects short
// and soft. Nothing loads or plays until `start()` runs from a user gesture.
import { TUNE } from './tuning';

const MUSIC = ['music_piano', 'music_guitar'];
const BEDS = ['wind', 'rain', 'meadow'];
const SHOTS = ['thunder', 'jet', 'prop', 'hawk', 'shot', 'boom', 'dive', 'join', 'hit', 'over', 'call'];

export function createAudio(base = '/sounds/flock/') {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let muted = false;
  let wasLow = false;
  let lastDive = 0;
  let nextCall = 0;
  let track = 0;
  let nextTrack = 0;
  const buffers = {};
  const beds = {};
  const last = {};

  function start() {
    if (ctx) {
      ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    // A gentle limiter, so no single sound can jump out of the mix.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -20;
    limiter.knee.value = 18;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.4;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : TUNE.sound.master;
    master.connect(limiter).connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.5;
    musicGain.connect(master);

    for (const name of [...MUSIC, ...BEDS, ...SHOTS]) {
      fetch(`${base}${name}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx && ctx.decodeAudioData(data))
        .then((buffer) => {
          if (!buffer || !ctx) return;
          buffers[name] = buffer;
          if (BEDS.includes(name)) beds[name] = makeBed(buffer);
        })
        .catch(() => {});
    }
  }

  // A recording looped by overlapping copies of itself, so there is no seam.
  function makeBed(buffer) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const cross = 4;
    const bed = { gain, next: 0 };
    bed.pump = () => {
      if (bed.next > ctx.currentTime + 1) return;
      const t = Math.max(bed.next, ctx.currentTime + 0.05);
      const src = ctx.createBufferSource();
      const env = ctx.createGain();
      src.buffer = buffer;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + cross);
      env.gain.setValueAtTime(1, t + buffer.duration - cross);
      env.gain.linearRampToValueAtTime(0, t + buffer.duration);
      src.connect(env).connect(gain);
      src.start(t);
      bed.next = t + buffer.duration - cross;
    };
    return bed;
  }

  // The two pieces alternate, each fading in as the last one fades out.
  function pumpMusic() {
    const buffer = buffers[MUSIC[track % MUSIC.length]];
    if (!buffer || nextTrack > ctx.currentTime + 1) return;
    const fade = 5;
    const t = Math.max(nextTrack, ctx.currentTime + 0.1);
    const src = ctx.createBufferSource();
    const env = ctx.createGain();
    src.buffer = buffer;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + fade);
    env.gain.setValueAtTime(1, t + buffer.duration - fade);
    env.gain.linearRampToValueAtTime(0, t + buffer.duration);
    src.connect(env).connect(musicGain);
    src.start(t);
    nextTrack = t + buffer.duration - fade;
    track++;
  }

  // Play an effect once, with a short fade in and out so it never clicks.
  // `gap` is the least time between two plays of the same sound.
  function play(name, { gain = 1, rate = 1, delay = 0, pan = 0, gap = 0.15 } = {}) {
    const buffer = buffers[name];
    if (!ctx || ctx.state !== 'running' || !buffer) return;
    const t = ctx.currentTime + delay;
    if (!delay && last[name] && t - last[name] < gap) return;
    if (!delay) last[name] = t;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const length = buffer.duration / rate;
    g.gain.setValueAtTime(0, t);
    const peak = gain * TUNE.sound.effects;
    g.gain.linearRampToValueAtTime(peak, t + 0.015);
    g.gain.setValueAtTime(peak, t + Math.max(0.02, length - 0.12));
    g.gain.linearRampToValueAtTime(0, t + length);
    let node = src.connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node = node.connect(p);
    }
    node.connect(master);
    src.start(t);
  }

  function update({ speed = 0.5, low = 0, high = 0, rainK = 0, storm = 0, playing = false }) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const level = (bed, v) => {
      if (!bed) return;
      bed.pump();
      bed.gain.gain.setTargetAtTime(v * TUNE.sound.ambience, t, 0.8);
    };
    level(beds.wind, 0.05 + speed * 0.05 + low * 0.04 + high * 0.07 + storm * 0.08);
    level(beds.rain, rainK * 0.28);
    level(beds.meadow, (0.03 + low * 0.12) * (1 - rainK));
    pumpMusic();
    // The music steps back a little in a storm, and while waiting on the title card.
    musicGain.gain.setTargetAtTime(TUNE.sound.music * (playing ? 1 : 0.8) * (1 - storm * 0.35), t, 1);
    if (!muted) master.gain.setTargetAtTime(TUNE.sound.master, t, 0.1);

    // Now and then one of the flock calls out, from somewhere in the formation.
    if (t > nextCall) {
      if (nextCall && storm < 0.5) play('call', { gain: 0.14 * TUNE.sound.birdCalls, rate: 0.92 + Math.random() * 0.2, pan: Math.random() - 0.5 });
      nextCall = t + TUNE.sound.callEvery * (0.6 + Math.random() * 0.8);
    }

    // The rush of air as the flock tips into a dive: not more than once every few seconds.
    const isLow = low > 0.3;
    if (playing && isLow && !wasLow && t - lastDive > 4) {
      lastDive = t;
      play('dive', { gain: 0.12 });
    }
    wasLow = isLow;
  }

  return {
    start,
    update,
    setMuted(v) {
      muted = v;
      if (master) master.gain.setTargetAtTime(v ? 0 : TUNE.sound.master, ctx.currentTime, 0.08);
    },
    suspend: () => ctx && ctx.suspend(),
    resume: () => ctx && ctx.resume(),
    hit: () => play('hit', { gain: 0.16, gap: 0.4 }),
    recruit: () => [1, 1.26, 1.5].forEach((rate, i) => play('join', { gain: 0.2, rate, delay: i * 0.12 })),
    shot: (near = 1) => play('shot', { gain: 0.05 + 0.13 * near, rate: 0.95 + Math.random() * 0.1, gap: 0.5 }),
    thunder: () => play('thunder', { gain: 0.38, rate: 0.9 + Math.random() * 0.2, gap: 1 }),
    screech: () => play('hawk', { gain: 0.2, gap: 3 }),
    engine: (big, pan = 0) => play(big ? 'jet' : 'prop', { gain: big ? 0.26 : 0.24, pan, gap: 2.5 }),
    explosion: () => play('boom', { gain: 0.6 }),
    over: () => [1, 0.84, 0.75, 0.5].forEach((rate, i) => play('over', { gain: 0.26, rate, delay: 0.01 + i * 0.36 })),
    dispose() {
      if (ctx) ctx.close();
      ctx = null;
    },
  };
}
