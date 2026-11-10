// Every look-and-feel number of Flock in Flight that is worth turning by hand.
// FLOCK_DIALS is the DialKit panel (numbers are [default, min, max, step]);
// TUNE holds the live values, which the game reads every frame. The panel is
// opened from Flock.jsx with Control + Alt/Option + Shift + F.
export const FLOCK_DIALS = {
  light: {
    sun: [1, 0, 2, 0.01],
    ambient: [1, 0, 2, 0.01],
    sunShadows: [1, 0, 1, 0.01],
    rim: [0.12, 0, 0.6, 0.01],
    fog: [1, 0, 3, 0.01],
  },
  day: {
    _collapsed: true,
    time: {
      type: 'select',
      options: [
        { value: 'cycle', label: 'Cycle through the day' },
        { value: '0', label: 'Morning' },
        { value: '1', label: 'Noon' },
        { value: '2', label: 'Sunset' },
        { value: '3', label: 'Night' },
        { value: '4', label: 'Dawn' },
      ],
      default: 'cycle',
    },
    secondsPerPhase: [52, 5, 300, 1],
  },
  grade: {
    _collapsed: true,
    exposure: [1, 0.5, 1.6, 0.01],
    saturation: [1.1, 0, 2, 0.01],
    contrast: [0.3, 0, 1, 0.01],
    highlights: [1.25, 0.5, 2.5, 0.01],
    warmth: [0, -0.3, 0.3, 0.01],
    vignette: [0.35, 0, 1, 0.01],
    bloom: [0.22, 0, 2, 0.01],
    bloomThreshold: [1.05, 0.3, 2, 0.01],
    godRays: [0.35, 0, 2, 0.01],
    motionBlur: [0.5, 0, 2, 0.01],
  },
  camera: {
    _collapsed: true,
    height: [62, 25, 130, 1],
    back: [30, 0, 100, 1],
    lookAhead: [10, -30, 80, 1],
    fov: [45, 25, 80, 1],
    chaseHeight: [4.2, 0, 20, 0.1],
    chaseBack: [17, 6, 50, 0.5],
    chaseFov: [66, 40, 100, 1],
    swing: [3.4, 0.5, 10, 0.1],
    roll: [1, 0, 3, 0.05],
    speedFov: [8, 0, 25, 0.5],
  },
  flight: {
    _collapsed: true,
    speed: [38, 15, 80, 1],
    diveSpeed: [52, 20, 100, 1],
    highAltitude: [140, 80, 220, 1],
    climbRate: [44, 15, 90, 1],
    steer: [6.5, 1, 15, 0.1],
    spacing: [1, 0.5, 2, 0.01],
    birdSize: [1, 0.5, 2, 0.01],
    flapRate: [1, 0.3, 2.5, 0.01],
    wake: [1, 0, 3, 0.05],
  },
  shadows: {
    _collapsed: true,
    strength: [0.58, 0, 1, 0.01],
    softness: [1, 0, 4, 0.05],
    throwLeft: [0.13, -0.6, 0.6, 0.01],
    throwAhead: [0.38, 0, 1, 0.01],
  },
  threats: {
    _collapsed: true,
    gap: [1, 0.3, 3, 0.05],
    aircraftElsewhere: [0.3, 0, 1, 0.01],
    airportInterval: [6.5, 2, 20, 0.5],
    invincible: false,
  },
  sound: {
    _collapsed: true,
    master: [0.55, 0, 1, 0.01],
    music: [0.1, 0, 1, 0.01],
    birdCalls: [0.5, 0, 2, 0.01],
    callEvery: [20, 4, 90, 1],
    ambience: [1, 0, 2, 0.01],
    effects: [1, 0, 2, 0.01],
  },
};

const initial = (control) => (Array.isArray(control) ? control[0] : control && typeof control === 'object' ? control.default : control);

export const TUNE = Object.fromEntries(
  Object.entries(FLOCK_DIALS).map(([group, controls]) => [
    group,
    Object.fromEntries(Object.entries(controls).filter(([key]) => !key.startsWith('_')).map(([key, control]) => [key, initial(control)])),
  ]),
);

// Copy a set of DialKit values over the live ones.
export function applyTuning(values) {
  for (const group of Object.keys(TUNE)) Object.assign(TUNE[group], values?.[group]);
}
