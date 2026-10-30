// DialKit controls for the rainy café window. Numeric controls are [default, min, max, step].
// Positions and sizes are in stage units: the stage is 1 tall and FROST_ASPECT wide.

// The stage is always 4:5 (width / height).
export const FROST_ASPECT = 4 / 5;

// Colour moods for the street behind the glass.
export const FROST_MOODS = {
  night: {
    skyTop: '#04070c', skyHorizon: '#16212d', ground: '#06080b', building: '#0c1219', haze: '#2a3a4a',
    window: '#ffbf73', lamp: '#ff8a33', glow: '#3a3a44',
  },
  city: {
    skyTop: '#0a0f14', skyHorizon: '#24323a', ground: '#080b0d', building: '#121a1f', haze: '#3a4c55',
    window: '#ffd6a0', lamp: '#ffa457', glow: '#4a4038',
  },
  dusk: {
    skyTop: '#2a3340', skyHorizon: '#7d6646', ground: '#141012', building: '#2c261f', haze: '#7a7466',
    window: '#ffcc80', lamp: '#ff9c45', glow: '#8a6a40',
  },
};

export const FROST_CONFIG = {
  street: {
    _collapsed: false,
    mood: {
      type: 'select',
      options: [
        { value: 'night', label: 'Blue night' },
        { value: 'city', label: 'City lights' },
        { value: 'dusk', label: 'Dusk' },
      ],
      default: 'night',
    },
    traffic: [2.65, 0, 3, 0.05],
    brightness: [2.31, 0.3, 3, 0.01],
    exposure: [1.71, 0.4, 2.5, 0.01],
    lightSize: [0.93, 0.5, 2, 0.01],
    windows: [0.34, 0, 2, 0.01],
    seed: [7, 1, 99, 1],
  },
  glass: {
    _collapsed: false,
    blur: [0.8, 0.3, 2, 0.01],
    mist: [0.73, 0, 1, 0.01],
    condensation: [1.21, 0, 1.5, 0.01],
    mistReturn: [1, 0, 2, 0.01],
    frostWarp: [2, 0, 3, 0.01],
  },
  drops: {
    _collapsed: true,
    amount: [1.16, 0, 2, 0.01],
    dropSize: [0.5, 0.3, 2, 0.01],
    lens: [2, 0, 3, 0.01],
    slideRate: [1.98, 0, 4, 0.01],
    slideSpeed: [0.55, 0.2, 3, 0.01],
  },
  grain: {
    _collapsed: true,
    amount: [0.94, 0, 2, 0.01],
    size: [0.7, 0.5, 4, 0.1],
    chroma: [0.56, 0, 1, 0.01],
  },
  motion: {
    _collapsed: true,
    playing: true,
    speed: [0.47, 0, 3, 0.01],
  },
  quality: {
    _collapsed: true,
    pixelRatio: [1.5, 0.75, 2, 0.25],
    sceneScale: [1, 0.25, 1, 0.05],
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

export const FROST_DEFAULTS = resolveDefaults(FROST_CONFIG);
