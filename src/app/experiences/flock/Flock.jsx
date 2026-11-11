'use client';
import { useEffect, useRef, useState } from 'react';
import { DialRoot, useDialKit } from 'dialkit';
import { AirplaneTilt, ArrowFatLinesDown, ArrowFatLinesUp, Balloon, Bird, Lightning, Plus, SpeakerHigh, SpeakerSlash, VideoCamera, Warning } from '@phosphor-icons/react';

// Flock in Flight: a flock of white birds over an endless painted landscape,
// rendered in 3D (see ./game). With `game` it is a playable flying game: the
// cursor steers, holding dives low and swings the camera in behind the flock.
// Without it (the gallery card) the flock just glides.
import { FLOCK_DIALS, applyTuning } from './game/tuning';

const stop = (e) => e.stopPropagation();

// The look-and-feel panel (see game/tuning.js). Hidden until
// Control + Alt/Option + Shift + F; Escape hides it again. The title card lists the shortcut.
function FlockDials() {
  const [open, setOpen] = useState(false);
  const values = useDialKit('Flock in Flight', FLOCK_DIALS);
  useEffect(() => applyTuning(values), [values]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // DialKit draws itself in a portal on the body, so the game underneath never sees its drags.
  return open ? <DialRoot productionEnabled position="top-right" /> : null;
}

const WARNINGS = 8;
const ALTITUDES = ['low', 'cruise', 'high'];
// The title card's list: what it does, then the keys or gestures that do it.
const CONTROLS = [
  ['Steer', ['Mouse', 'A', 'D']],
  ['Dive', ['Hold click', 'W']],
  ['Climb', ['Hold right-click', 'S']],
  ['Camera', ['C']],
  ['Tuning panel', ['Ctrl + Alt + Shift + F']],
  ['Hide panel', ['Esc']],
];
const TOUCH_CONTROLS = [
  ['Steer', ['Drag']],
  ['Dive', ['Two fingers up']],
  ['Climb', ['Two fingers down']],
  ['Camera', ['Camera button']],
];
const CAUSES = {
  plane: 'An aircraft cut through the flock.',
  balloon: 'A balloon was in the way.',
  crash: 'Two aircraft collided, and the blast took the flock.',
  hawk: 'A hawk took the last one.',
  lightning: 'Lightning found the flock.',
  hunter: 'The hunters were waiting below.',
  wires: 'The power lines were hard to see.',
  turbine: 'The turbine blades kept turning.',
  ground: 'The ground came up too fast.',
  cliff: 'The cliff was higher than it looked.',
  prop: 'Too low over the rooftops and trees.',
};

const pill = 'rounded-full bg-black/30 text-white backdrop-blur-sm';

export default function Flock({ game = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const warnRefs = useRef([]);
  const [status, setStatus] = useState('loading'); // loading | attract | play | over | error
  const [birds, setBirds] = useState(7);
  const [pulse, setPulse] = useState(0);
  const [hud, setHud] = useState({ distance: 0, low: 0, storm: 0 });
  const [result, setResult] = useState(null);
  const [muted, setMuted] = useState(false);
  const [touch, setTouch] = useState(false);
  const [learned, setLearned] = useState({ steer: false, dive: false });
  const [altitude, setAltitude] = useState(0); // touch: -1 low, 0 cruise, 1 high
  const resetRef = useRef(null);
  const startRef = useRef(null); // starts a run if a card with a start button is showing (Enter)
  const [watching, setWatching] = useState(false);
  const [view, setView] = useState(''); // name of the camera just switched to, shown briefly

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    let engine = null;
    let dead = false;
    let ro = null;
    const cleanups = [];

    (async () => {
      try {
        const { createGame } = await import('./game/engine');
        engine = await createGame(canvas, {
          preview: !game,
          onEvent(type, data) {
            if (type === 'birds') {
              setBirds(data.birds);
              if (data.change) setPulse(data.change);
            } else if (type === 'hud') {
              setHud(data);
            } else if (type === 'state') {
              setStatus(data.state);
              if (data.state === 'over') setResult(data);
            }
          },
          onWarnings: game
            ? (list) => {
                for (let i = 0; i < WARNINGS; i++) {
                  const el = warnRefs.current[i];
                  if (!el) continue;
                  const w = list[i];
                  if (!w) {
                    el.style.opacity = '0';
                    continue;
                  }
                  el.dataset.kind = w.kind;
                  el.style.opacity = String(w.alpha);
                  el.style.left = `${w.x * 100}%`;
                  el.style.top = `${w.y * 100}%`;
                }
              }
            : null,
        });
      } catch (error) {
        console.error(error);
        if (!dead) setStatus('error');
        return;
      }
      if (dead) {
        engine.dispose();
        return;
      }
      engineRef.current = engine;
      setTouch(engine.coarse);
      const resize = () => {
        const rect = root.getBoundingClientRect();
        engine.resize(Math.max(1, rect.width), Math.max(1, rect.height));
      };
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(root);
      setStatus('attract');
      if (!game) return;

      // Mouse: the flock follows the cursor; the left button dives, the right button climbs high.
      // Touch: one finger drags to steer (like a trackpad). Two fingers swiped up
      // take the flock down a level, swiped down take it up one: low, cruise, high.
      let nx = 0;
      let ny = 0;
      let level = 0; // touch only: -1 low, 0 cruise, 1 high
      const fingers = new Map(); // pointerId -> { x, y }
      let swipe = null; // { y, used } while two fingers are down
      const dive = (on) => {
        engine.setDive(on);
        if (on) setLearned((l) => (l.dive ? l : { ...l, dive: true }));
      };
      const setLevel = (v) => {
        level = Math.max(-1, Math.min(1, v));
        dive(level < 0);
        engine.setClimb(level > 0);
        setAltitude(level);
      };
      resetRef.current = () => setLevel(0);
      const middle = () => [...fingers.values()].reduce((sum, f) => sum + f.y, 0) / fingers.size;
      const move = (e) => {
        const rect = root.getBoundingClientRect();
        if (e.pointerType === 'mouse') {
          nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          ny = 1 - ((e.clientY - rect.top) / rect.height) * 2;
        } else {
          const f = fingers.get(e.pointerId);
          if (!f) return;
          const dx = e.clientX - f.x;
          const dy = e.clientY - f.y;
          f.x = e.clientX;
          f.y = e.clientY;
          if (fingers.size >= 2) {
            // One step per swipe: lift the fingers to swipe again.
            const travel = swipe ? middle() - swipe.y : 0;
            if (swipe && !swipe.used && Math.abs(travel) > 36) {
              swipe.used = true;
              setLevel(level + (travel > 0 ? 1 : -1));
            }
            return;
          }
          nx = Math.max(-1, Math.min(1, nx + (dx / rect.width) * 2.6));
          ny = Math.max(-1, Math.min(1, ny - (dy / rect.height) * 2.6));
        }
        engine.setPointer(nx * 1.15, ny * 1.15);
        setLearned((l) => (l.steer ? l : { ...l, steer: true }));
      };
      const down = (e) => {
        if (e.pointerType === 'mouse') {
          if (e.button === 0) dive(true);
          if (e.button === 2) engine.setClimb(true);
        } else {
          fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (fingers.size === 2) swipe = { y: middle(), used: false };
        }
      };
      const up = (e) => {
        if (!e || e.type === 'blur') {
          held.clear();
          if (!fingers.size) {
            dive(false);
            engine.setClimb(false);
          }
          fingers.clear();
          swipe = null;
        } else if (e.pointerType === 'mouse') {
          if (e.button === 0) dive(false);
          if (e.button === 2) engine.setClimb(false);
        } else {
          fingers.delete(e.pointerId);
          if (fingers.size < 2) swipe = null;
        }
      };
      // Keys: A and D (or Left and Right) push the point the cursor sets sideways,
      // and it stays where it is left. W (or Up, Space) dives while held, S (or
      // Down, Shift) climbs while held. C changes camera, Enter starts.
      const STEER = { KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
      const DIVE_KEYS = ['KeyW', 'ArrowUp', 'Space'];
      const CLIMB_KEYS = ['KeyS', 'ArrowDown', 'ShiftLeft', 'ShiftRight'];
      const held = new Set();
      let steering = 0;
      let then = 0;
      const steer = (now) => {
        const dt = Math.min(0.05, (now - then) / 1000);
        then = now;
        for (const code of held) {
          nx = Math.max(-1, Math.min(1, nx + STEER[code][0] * dt * 1.7));
          ny = Math.max(-1, Math.min(1, ny + STEER[code][1] * dt * 1.7));
        }
        engine.setPointer(nx * 1.15, ny * 1.15);
        steering = held.size ? requestAnimationFrame(steer) : 0;
      };
      cleanups.push(() => cancelAnimationFrame(steering));
      const key = (e) => {
        // Space and Enter also press a focused button or dial; leave those alone.
        if (e.target?.closest?.('button, input, select, textarea') || e.ctrlKey || e.altKey || e.metaKey) return;
        const press = e.type === 'keydown';
        if (DIVE_KEYS.includes(e.code)) {
          e.preventDefault();
          dive(press);
        } else if (CLIMB_KEYS.includes(e.code)) {
          if (e.code.startsWith('Arrow')) e.preventDefault();
          engine.setClimb(press);
        } else if (STEER[e.code]) {
          e.preventDefault();
          if (!press) held.delete(e.code);
          else if (!held.has(e.code)) {
            held.add(e.code);
            setLearned((l) => (l.steer ? l : { ...l, steer: true }));
            if (!steering) {
              then = performance.now();
              steering = requestAnimationFrame(steer);
            }
          }
        } else if (e.code === 'KeyC' && press && !e.repeat) showCamera(engine.nextCamera());
        else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && press && !e.repeat) startRef.current?.();
      };
      const noMenu = (e) => e.preventDefault();
      const on = (el, type, fn) => {
        el.addEventListener(type, fn);
        cleanups.push(() => el.removeEventListener(type, fn));
      };
      on(root, 'pointermove', move);
      on(root, 'pointerdown', down);
      on(root, 'contextmenu', noMenu);
      on(window, 'pointerup', up);
      on(window, 'pointercancel', up);
      on(window, 'blur', up);
      on(window, 'keydown', key);
      on(window, 'keyup', key);
    })();

    return () => {
      dead = true;
      if (ro) ro.disconnect();
      cleanups.forEach((fn) => fn());
      if (engine) engine.dispose();
      engineRef.current = null;
    };
  }, [game]);

  useEffect(() => {
    if (!view) return undefined;
    const id = setTimeout(() => setView(''), 1600);
    return () => clearTimeout(id);
  }, [view]);

  useEffect(() => {
    if (!pulse) return undefined;
    const id = setTimeout(() => setPulse(0), 700);
    return () => clearTimeout(id);
  }, [pulse]);

  const begin = () => {
    setResult(null);
    setLearned({ steer: false, dive: false });
    resetRef.current?.();
    setWatching(false);
    engineRef.current?.start();
  };
  startRef.current = status === 'attract' || status === 'over' ? begin : null;
  const showCamera = (name) => {
    setView(name);
    setWatching(name === 'Cine');
  };
  const nextCamera = () => {
    const name = engineRef.current?.nextCamera();
    if (name) showCamera(name);
  };
  const toggleMute = () => {
    setMuted((m) => {
      engineRef.current?.setMuted(!m);
      return !m;
    });
  };
  const playing = status === 'play';
  // The cine camera is for watching: the flock flies itself until the view is changed.
  let hint = view ? `Camera: ${view}` : watching ? 'Cine camera · the flock flies itself · C to take over' : '';
  if (playing && !hint) {
    if (hud.storm > 0.2 && hud.low < 0.5) hint = touch ? 'Storm: swipe up with two fingers to fly under it' : 'Storm: hold to fly under it';
    else if (!learned.steer) hint = touch ? 'Drag to steer the flock' : 'Move the cursor, or press A and D, to steer the flock';
    else if (!learned.dive && hud.distance > 120) hint = touch ? 'Two fingers: swipe up to dive, down to climb' : 'Hold click or W to dive · Hold right-click or S to climb';
  }

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full select-none overflow-hidden font-sans"
      style={{ background: '#e8cfa6', touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', cursor: playing ? 'crosshair' : 'default' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" role="img" aria-label="A flock of white birds flying over a painted landscape" />

      {game && (
        <>
          {/* Edge markers for what is coming. */}
          <div className="pointer-events-none absolute inset-0 z-30">
            {Array.from({ length: WARNINGS }, (_, i) => (
              <div
                key={i}
                ref={(el) => (warnRefs.current[i] = el)}
                data-kind="plane"
                className="group absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#b3261e]/85 text-white opacity-0 shadow-lg ring-2 ring-white/60 transition-opacity duration-200 data-[kind=stray]:bg-[#e2a82b]/90 data-[kind=storm]:bg-slate-800/85 data-[kind=crash]:h-12 data-[kind=crash]:w-12 data-[kind=crash]:animate-pulse data-[kind=crash]:bg-[#e8590c]"
              >
                <AirplaneTilt weight="bold" className="hidden h-5 w-5 group-data-[kind=plane]:block" />
                <Balloon weight="bold" className="hidden h-5 w-5 group-data-[kind=balloon]:block" />
                <Bird weight="bold" className="hidden h-5 w-5 group-data-[kind=hawk]:block" />
                <Lightning weight="bold" className="hidden h-5 w-5 group-data-[kind=storm]:block" />
                <Plus weight="bold" className="hidden h-5 w-5 group-data-[kind=stray]:block" />
                <Warning weight="bold" className="hidden h-6 w-6 group-data-[kind=crash]:block" />
              </div>
            ))}
          </div>

          {/* Score. */}
          <div className="absolute right-4 top-14 z-40 flex items-center gap-2 text-[13px] font-semibold tabular-nums sm:right-6 sm:top-4">
            {status !== 'loading' && status !== 'error' && status !== 'attract' && (
              <>
                <span className={`${pill} px-3 py-1.5`}>{(hud.distance / 1000).toFixed(2)} km</span>
                <span
                  className={`${pill} flex items-center gap-1.5 px-3 py-1.5 transition-colors duration-300 ${pulse < 0 ? 'bg-[#b3261e]/80' : pulse > 0 ? 'bg-[#c98a12]/80' : ''}`}
                  aria-label={`${birds} birds in the flock`}
                >
                  <Bird weight="bold" className="h-4 w-4" />
                  {birds}
                </span>
              </>
            )}
            {status !== 'loading' && status !== 'error' && (
              <button type="button" onClick={nextCamera} onPointerDown={stop} aria-label="Change camera" title="Change camera (C)" className={`${pill} flex h-8 w-8 items-center justify-center transition-colors hover:bg-black/45`}>
                <VideoCamera weight="bold" className="h-4 w-4" />
              </button>
            )}
            {status !== 'loading' && status !== 'error' && (
              <button
                type="button"
                onClick={toggleMute}
                onPointerDown={stop}
                aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
                className={`${pill} flex h-8 w-8 items-center justify-center transition-colors hover:bg-black/45`}
              >
                {muted ? <SpeakerSlash weight="bold" className="h-4 w-4" /> : <SpeakerHigh weight="bold" className="h-4 w-4" />}
              </button>
            )}
          </div>

          {hint && (
            <p className={`${pill} pointer-events-none absolute left-1/2 top-28 z-40 -translate-x-1/2 whitespace-nowrap px-4 py-2 text-[12px] font-medium tracking-wide sm:top-24`}>
              {hint}
            </p>
          )}

          {touch && playing && (
            <div className={`${pill} pointer-events-none absolute bottom-28 right-4 z-40 flex flex-col items-center gap-1.5 px-2.5 py-3`} role="status" aria-label={`Altitude: ${ALTITUDES[altitude + 1]}`}>
              <ArrowFatLinesUp weight="bold" className={`h-4 w-4 ${altitude > 0 ? 'opacity-100' : 'opacity-35'}`} />
              <span className={`h-1.5 w-1.5 rounded-full bg-white ${altitude === 0 ? 'opacity-100' : 'opacity-35'}`} />
              <ArrowFatLinesDown weight="bold" className={`h-4 w-4 ${altitude < 0 ? 'opacity-100' : 'opacity-35'}`} />
            </div>
          )}

          {(status === 'attract' || status === 'over') && (
            <div className="absolute inset-0 z-40 flex items-end justify-center bg-gradient-to-t from-black/45 via-black/5 to-transparent p-6 pb-28 sm:items-center sm:justify-end sm:bg-none sm:pb-6 sm:pr-[7vw]">
              <div className="w-full max-w-sm rounded-3xl bg-black/35 p-7 text-center text-white shadow-2xl backdrop-blur-md" onPointerDown={stop}>
                {status === 'attract' ? (
                  <>
                    <h1 className="font-heading text-3xl font-bold">Flock in Flight</h1>
                    <dl className="mt-5 space-y-2 text-left text-sm">
                      {(touch ? TOUCH_CONTROLS : CONTROLS).map(([does, how]) => (
                        <div key={does} className="flex items-baseline justify-between gap-4">
                          <dt className="text-white/70">{does}</dt>
                          <dd className="flex flex-wrap justify-end gap-1">
                            {how.map((k) => (
                              <kbd key={k} className="rounded-md bg-white/15 px-1.5 py-0.5 font-sans text-[11px] font-semibold">
                                {k}
                              </kbd>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <>
                    <h1 className="font-heading text-3xl font-bold">The sky is empty</h1>
                    <p className="mt-3 text-sm text-white/85">{CAUSES[result?.cause] || 'The flock is gone.'}</p>
                    <dl className="mt-5 grid grid-cols-2 gap-3 text-left">
                      <div className="rounded-2xl bg-white/10 px-4 py-3">
                        <dt className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Flown</dt>
                        <dd className="mt-0.5 text-xl font-semibold tabular-nums">{((result?.distance || 0) / 1000).toFixed(2)} km</dd>
                      </div>
                      <div className="rounded-2xl bg-white/10 px-4 py-3">
                        <dt className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Strays gathered</dt>
                        <dd className="mt-0.5 text-xl font-semibold tabular-nums">{result?.recruited || 0}</dd>
                      </div>
                    </dl>
                  </>
                )}
                <button
                  type="button"
                  onClick={begin}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {status === 'attract' ? 'Take flight' : 'Fly again'}
                  {/* The key that presses this button. */}
                  {!touch && <kbd className="rounded-md bg-slate-900/10 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-slate-600">Enter</kbd>}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {game && <FlockDials />}

      {status === 'loading' && game && (
        <p className="absolute inset-0 z-40 flex items-center justify-center text-sm font-medium tracking-widest text-slate-700/70">LOADING</p>
      )}
      {status === 'error' && (
        <p className="absolute inset-0 z-40 flex items-center justify-center p-6 text-center text-sm font-medium text-slate-700">
          This scene needs WebGL, which is not available in this browser.
        </p>
      )}
    </div>
  );
}
