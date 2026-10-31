// DialKit controls for the rainy café window. Numeric controls are [default, min, max, step].
// Positions and sizes are in stage units: the stage is 1 tall and FROST_ASPECT wide.

// The stage is always 4:5 (width / height).
export const FROST_ASPECT = 4 / 5;

// Colour moods for the street behind the glass.
export const FROST_MOODS = {
  // Teal night with amber windows and a yellow glow down the street.
  night: {
    skyTop: '#04090e', skyHorizon: '#163a40', ground: '#05090b', building: '#0a1216', haze: '#2a4a50',
    window: '#ffb35a', lamp: '#ff9a3c', glow: '#8a7a3a',
  },
  // Violet and pink city lights.
  city: {
    skyTop: '#080a1c', skyHorizon: '#2c2f63', ground: '#07081a', building: '#121530', haze: '#40457a',
    window: '#ffd0c8', lamp: '#ffa86a', glow: '#8a4a7a',
  },
  // Warm dusk haze.
  dusk: {
    skyTop: '#2c3a54', skyHorizon: '#a38364', ground: '#14121a', building: '#2e2a38', haze: '#8a7a74',
    window: '#ffd28a', lamp: '#ffa04a', glow: '#c08050',
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
    people: [1, 0, 3, 0.05],
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
