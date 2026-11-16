// DialKit controls for the evening sea. Numeric controls are [default, min, max, step].

// The stage is always 4:5 (width / height).
export const SEA_ASPECT = 4 / 5;

// The sky the water mirrors, from the horizon up, and the water itself. The sky is never
// in frame: these colours only ever show as reflections.
export const SEA_COLORS = {
  horizon: '#ff8a3a', low: '#5a4038', mid: '#465268', high: '#1b2534', zenith: '#0b1119',
  sun: '#ffb45e', sunHalo: '#ff7a2e',
  deep: '#05080d', scatter: '#3a4a52',
};

export const SEA_CONFIG = {
  waves: {
    _collapsed: false,
    swell: [1, 0, 2.5, 0.01],
    chop: [1, 0, 2.5, 0.01],
    ripples: [1, 0, 2.5, 0.01],
    // A second set of waves running across the first.
    crossing: [1, 0, 2.5, 0.01],
    // How far the crests are bent out of straight.
    bend: [1, 0, 2.5, 0.01],
    wind: [8, -60, 60, 1],
    spread: [1, 0.2, 2, 0.01],
    seed: [7, 1, 99, 1],
  },
  light: {
    _collapsed: false,
    sunHeight: [4, 1, 25, 0.1],
    sunSide: [1.5, -10, 10, 0.1],
    sunSize: [0.8, 0.3, 5, 0.01],
    sunStrength: [1, 0, 3, 0.01],
    // The band of light along the horizon: the source of the thin bright lines.
    band: [1, 0, 3, 0.01],
    exposure: [1, 0.3, 2.5, 0.01],
  },
  // An 85mm lens held low over the water.
  lens: {
    _collapsed: false,
    height: [0.75, 0.3, 10, 0.05],
    pitch: [15, 3, 40, 0.1],
    zoom: [23.5, 4, 50, 0.5],
    focus: [2.4, 0.5, 30, 0.1],
    blur: [0.4, 0, 3, 0.01],
    sway: [0.25, 0, 2, 0.01],
  },
  finish: {
    _collapsed: true,
    glow: [0.9, 0, 2.5, 0.01],
    contrast: [1.12, 0.5, 1.6, 0.01],
    vignette: [0.35, 0, 1, 0.01],
    grain: [0.7, 0, 2, 0.01],
    grainSize: [1.2, 0.5, 4, 0.1],
  },
  motion: {
    _collapsed: true,
    playing: true,
    // 0.5 is real time filmed at 60 frames a second and played at 30.
    speed: [0.5, 0, 3, 0.01],
  },
  quality: {
    _collapsed: true,
    pixelRatio: [1.5, 0.75, 2, 0.25],
  },
};

// Resolves the config's defaults into the same nested shape `useDialKit` returns,
// for callers (the gallery preview) that render without the panel.
const resolveDefaults = (config) => {
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('_')) continue;
    if (Array.isArray(value)) out[key] = value[0];
    else if (value && typeof value === 'object' && 'default' in value) out[key] = value.default;
    else if (value && typeof value === 'object') out[key] = resolveDefaults(value);
    else out[key] = value;
  }
  return out;
};

export const SEA_DEFAULTS = resolveDefaults(SEA_CONFIG);
