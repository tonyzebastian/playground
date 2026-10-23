// DialKit controls for the frosted glass. Numeric controls are [default, min, max, step].
// Blur radii are fractions of the stage height. `plants` controls (except size, width and the
// colours) change where leaves are planted, so the foliage is regrown when they move.

export const FROST_ASPECTS = {
  portrait: 2 / 3,
  landscape: 3 / 2,
  square: 1,
};

export const FROST_CONFIG = {
  canvas: {
    _collapsed: true,
    format: {
      type: 'select',
      options: [
        { value: 'portrait', label: 'Portrait · 2:3' },
        { value: 'landscape', label: 'Landscape · 3:2' },
        { value: 'square', label: 'Square · 1:1' },
      ],
      default: 'portrait',
    },
  },
  glass: {
    _collapsed: false,
    blurFar: [0.045, 0, 0.12, 0.001],
    blurMid: [0.022, 0, 0.12, 0.001],
    blurNear: [0.009, 0, 0.12, 0.0005],
    frostWarp: [1, 0, 4, 0.01],
    warpScale: [2.6, 0.5, 12, 0.1],
    microFrost: [0.5, 0, 2, 0.01],
  },
  haze: {
    _collapsed: true,
    milk: [0.3, 0, 0.8, 0.01],
    layerFog: [0.26, 0, 0.7, 0.01],
    color: { type: 'color', default: '#f1f7ef' },
    contrast: [1, 0.6, 1.5, 0.01],
    saturation: [1, 0, 1.6, 0.01],
  },
  grain: {
    _collapsed: true,
    amount: [0.4, 0, 2, 0.01],
    size: [1.2, 0.5, 4, 0.1],
    chroma: [0.3, 0, 1, 0.01],
  },
  backdrop: {
    _collapsed: true,
    top: { type: 'color', default: '#f7faf5' },
    bottom: { type: 'color', default: '#e8f0e5' },
    glowColor: { type: 'color', default: '#a8cbb0' },
    glowStrength: [0.85, 0, 1.5, 0.01],
    glowX: [0, -0.5, 1.5, 0.01],
    glowY: [0, -0.5, 1.5, 0.01],
  },
  plants: {
    _collapsed: true,
    colorFar: { type: 'color', default: '#a4cdac' },
    colorMid: { type: 'color', default: '#86b996' },
    colorNear: { type: 'color', default: '#62a07a' },
    opacityFar: [0.62, 0, 1, 0.01],
    opacityMid: [0.8, 0, 1, 0.01],
    opacityNear: [0.85, 0, 1, 0.01],
    leafSize: [1, 0.5, 1.6, 0.01],
    leafWidth: [1, 0.5, 2, 0.01],
    stemWidth: [1, 0, 3, 0.01],
    stemsFar: [4, 0, 12, 1],
    stemsMid: [3, 0, 12, 1],
    stemsNear: [2, 0, 10, 1],
    leavesPerStem: [10, 4, 20, 1],
    seed: [7, 1, 99, 1],
  },
  motion: {
    _collapsed: true,
    playing: true,
    windSpeed: [1, 0, 3, 0.01],
    sway: [1, 0, 3, 0.01],
    flutter: [1, 0, 3, 0.01],
  },
  quality: {
    _collapsed: true,
    pixelRatio: [1, 0.75, 2, 0.25],
    renderScale: [0.6, 0.25, 1, 0.05],
    blurTaps: [24, 8, 48, 1],
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
