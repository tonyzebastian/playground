// DialKit controls for the meadow. Numeric controls are [default, min, max, step].
// Controls under `growth` and `camera` change where blades are planted, so the field
// is rebuilt (after a short pause) when they move; everything else is a live uniform.

export const DEFAULT_LOGO = '/models/logo/logo.png';

export const MEADOW_ASPECTS = {
  portrait: 5 / 7,
  landscape: 7 / 5,
};

// Moods: each one is a set of light, air and grade values written into the dials when it is picked.
// "golden" is also what the defaults below describe.
export const MEADOW_MOODS = {
  golden: {
    light: { sunAzimuth: -52, sunElevation: 15, sunColor: '#ffc88c', sunlight: 1.7, ambient: 1, skyColor: '#5b7399', backlight: 1.6, backlightColor: '#d6b23c', cloudShadow: 0.42 },
    atmosphere: { haze: 0.38, hazeColor: '#b79a86', mist: 0.3, mistColor: '#e8c9a4', motes: 0.35 },
    post: { exposure: 1.12, bloom: 0.5, saturation: 0.95, tone: 0.6, shadowTint: '#a9b9ff', highlightTint: '#ffdcae', vignette: 0.28 },
  },
  dusk: {
    light: { sunAzimuth: -64, sunElevation: 7, sunColor: '#ff8f66', sunlight: 1.05, ambient: 1.4, skyColor: '#4a5f9c', backlight: 1.2, backlightColor: '#c98a4a', cloudShadow: 0.3 },
    atmosphere: { haze: 0.5, hazeColor: '#6c7aa0', mist: 0.5, mistColor: '#aab4d6', motes: 0.25 },
    post: { exposure: 1.08, bloom: 0.6, saturation: 0.85, tone: 0.85, shadowTint: '#8fa6ff', highlightTint: '#ffc9b0', vignette: 0.36 },
  },
  overcast: {
    light: { sunAzimuth: -30, sunElevation: 55, sunColor: '#e9eef2', sunlight: 0.5, ambient: 1.35, skyColor: '#8794a0', backlight: 0.5, backlightColor: '#a9b86a', cloudShadow: 0.8 },
    atmosphere: { haze: 0.55, hazeColor: '#aab4b8', mist: 0.6, mistColor: '#d5dbde', motes: 0.1 },
    post: { exposure: 0.95, bloom: 0.25, saturation: 0.8, tone: 0.5, shadowTint: '#b4c4d8', highlightTint: '#eef2f0', vignette: 0.3 },
  },
};

export const MEADOW_CONFIG = {
  mood: {
    _collapsed: false,
    preset: {
      type: 'select',
      options: [
        { value: 'golden', label: 'Golden hour' },
        { value: 'dusk', label: 'Blue dusk' },
        { value: 'overcast', label: 'Overcast highland' },
      ],
      default: 'golden',
    },
  },
  canvas: {
    _collapsed: true,
    orientation: {
      type: 'select',
      options: [
        { value: 'portrait', label: 'Portrait · 5:7' },
        { value: 'landscape', label: 'Landscape · 7:5' },
      ],
      default: 'landscape',
    },
    pixelRatio: [1.5, 1, 3, 0.25],
    antialiasing: {
      type: 'select',
      options: [
        { value: '0', label: 'Off' },
        { value: '2', label: '2x' },
        { value: '4', label: '4x' },
      ],
      default: '2',
    },
    adaptive: true,
    stats: false, // GPU timing overlay. Its timer queries can slow some GPUs a lot, so leave it off when judging frame rate.
  },
  rock: {
    _collapsed: false,
    show: true,
    uploadLogo: { type: 'action', label: 'Upload logo…' },
    resetLogo: { type: 'action', label: 'Use default logo' },
    invertLogo: false,
    scanAmount: [1, 0, 1, 0.01],        // the built-in scanned rock surface (Poly Haven "Mossy Rock", CC0)
    scanScale: [0.2, 0.05, 1, 0.01],
    uploadTexture: { type: 'action', label: 'Upload stone texture…' },
    removeTexture: { type: 'action', label: 'Remove texture' },
    textureAmount: [1, 0, 1, 0.01],
    textureScale: [6, 0.5, 30, 0.1],
    textureRelief: [0.6, 0, 2, 0.05],
    x: [0, -14, 14, 0.1],
    z: [-1, -16, 10, 0.1],
    rotation: [0, -180, 180, 1],
    scale: [15, 2, 24, 0.05],
    lift: [-0.3, -1.5, 1.5, 0.01],
    inflate: [0.03, -0.03, 0.08, 0.001],
    thickness: [0.24, 0.04, 0.7, 0.005],
    roundness: [0.06, 0.01, 0.14, 0.002],
    blocks: [0.4, 0, 1, 0.01],          // how strongly the strokes break into separate fitted boulders
    jaggedness: [0.5, 0, 2.5, 0.05],
    grain: [7, 3, 30, 0.5],
    roughness: [1.3, 0, 2.5, 0.05],
    seed: [3, 0, 100, 1],
    stone: '#c6beb0',
    detail: [1, 0, 2, 0.05],
    shadow: [0.65, 0, 1, 0.01],
    moss: [0.18, 0, 1, 0.01],
    mossColor: '#768a52',
    brightness: [1.12, 0.3, 3, 0.01],
    ambient: [1, 0, 3, 0.05],
    grassKeep: [0.3, 0, 1, 0.01],       // share of blades that grow out of the joints and cracks (none grow through solid stone)
    grassHeight: [0.4, 0.1, 1.5, 0.01],  // how tall those are, against the open meadow
    grassSkirt: [0.45, 0, 1.5, 0.01],   // extra height of the uncut grass pressed against the stone
  },
  flowers: {
    _collapsed: false,
    show: true,
    density: [0.6, 0, 3, 0.05],
    clusterSize: [14, 3, 40, 1],
    spread: [1, 0.4, 3, 0.05],
    size: [0.38, 0.15, 2.5, 0.01],
    height: [1, 0.5, 2, 0.05],
    sway: [0.8, 0, 2, 0.05],
    color: '#ffd84a',
    shades: [0.5, 0, 1, 0.01],
    center: '#f3c623',
  },
  debris: {
    _collapsed: false,
    amount: [0.03, 0, 1, 0.005],
    gustThreshold: [0.65, 0.2, 0.85, 0.01],
    lift: [1, 0, 3, 0.05],
    speed: [1, 0, 3, 0.05],
    lifetime: [5, 2, 12, 0.5],
    size: [0.85, 0.4, 3, 0.05],
  },
  camera: {
    height: [20, 3, 40, 0.5],
    distance: [5, 2, 40, 0.5],
    lookAhead: [-1, -30, 12, 0.5],
    fov: [56, 25, 95, 1],
    roll: [2, -25, 25, 0.5],
    drift: [1, 0, 3, 0.05],
    followPointer: false, // camera leans toward the pointer
    parallax: [1, 0, 3, 0.05],
  },
  wind: {
    strength: [1, 0.2, 2.5, 0.05],
    speed: [1, 0, 3, 0.05],
    direction: [6, -180, 180, 1],
    wander: [1, 0, 2.5, 0.05],
    flutter: [1, 0, 3, 0.05],
    gustBend: [1.5, 0, 3, 0.05],
    baseBend: [0.8, 0, 2, 0.05],
  },
  lanes: {
    _collapsed: false,
    width: [1, 0.4, 3, 0.05],
    swing: [1.7, 0, 2.8, 0.05],
    meander: [30, 0, 80, 1],
    brightness: [0.1, 0, 0.5, 0.01],
    speed: [0.75, 0, 2, 0.05],
    swirls: [1.5, 0, 5, 0.05],
    swirlSize: [1, 0.4, 3, 0.05],
  },
  grass: {
    _collapsed: false,
    height: [1, 0.3, 2.5, 0.01],
    heightContrast: [1, 0.3, 2.5, 0.01],
    width: [1, 0.4, 3, 0.01],
    tipSharpness: [0.85, 0.3, 1.5, 0.01],
    curl: [1, 0, 3, 0.05],
    stiffnessVariation: [1, 0, 2, 0.05],
  },
  growth: {
    _collapsed: true,
    density: [1, 0.2, 1.5, 0.05],
    tuftSize: [1, 0.4, 3, 0.05],
    bladesPerTuft: [70, 10, 200, 5],
    segments: [7, 4, 12, 1],
    undergrowth: [1, 0, 2, 0.05],
    undergrowthHeight: [0.5, 0.2, 1, 0.01],
    seedHeads: [1, 0, 3, 0.05],
    dryTufts: [0.06, 0, 0.6, 0.01],
    seed: [11, 1, 999, 1],
  },
  color: {
    _collapsed: true,
    meadow: '#4c6a26',
    fresh: '#7a8e34',
    cool: '#3a5c3a',
    straw: '#b39a55',
    tip: '#c9c06e',
    dryTip: '#8a7238',
    seedHead: '#d9b064',
    soil: '#0b160a',
    saturation: [0.8, 0, 1.6, 0.01],
    brightness: [1, 0.5, 1.6, 0.01],
    toneVariation: [1, 0, 2, 0.05],
    patchStrength: [1, 0, 2, 0.05],
    patchSize: [1, 0.3, 3, 0.05],
    dryStrength: [1, 0, 2, 0.05],
    dryTips: [1, 0, 3, 0.05],
  },
  light: {
    _collapsed: true,
    sunAzimuth: [-52, -180, 180, 1],
    sunElevation: [15, 5, 85, 1],
    sunColor: '#ffc88c',
    sunlight: [1.7, 0, 3, 0.01],
    ambient: [1, 0, 2, 0.01],
    skyColor: '#5b7399',
    backlight: [1.6, 0, 3, 0.05],
    backlightColor: '#d6b23c',
    shadows: true,
    cloudShadow: [0.42, 0, 1, 0.01],
    cloudSize: [1, 0.3, 3, 0.05],
    cloudSpeed: [1, 0, 3, 0.05],
    sheen: [0.05, 0, 0.5, 0.01],
    gustSheen: [0.45, 0, 2, 0.01],
    canopyShadow: [1, 0, 1.5, 0.01],
    rootShade: [1, 0, 1.5, 0.01],
    crease: [0.55, 0, 1, 0.01],
    underside: [1, 0, 2, 0.05],
  },
  atmosphere: {
    _collapsed: true,
    haze: [0.38, 0, 1, 0.01],
    hazeColor: '#b79a86',
    mist: [0.3, 0, 1, 0.01],
    mistColor: '#e8c9a4',
    mistHeight: [1.1, 0.3, 4, 0.05],
    motes: [0.35, 0, 1, 0.01],
    thinStart: [30, 5, 80, 1],
    thinEnd: [65, 15, 140, 1],
    thinKeep: [0.35, 0.05, 1, 0.01],
  },
  post: {
    _collapsed: true,
    exposure: [1.12, 0.5, 1.6, 0.01],
    contrast: [0.35, 0, 1, 0.01],
    bloom: [0.5, 0, 1.5, 0.01],
    bloomThreshold: [0.8, 0.3, 1.5, 0.01],
    saturation: [0.95, 0, 1.6, 0.01],
    tone: [0.6, 0, 1, 0.01],            // split-toning strength: shadows lean to one tint, highlights to the other
    shadowTint: '#a9b9ff',
    highlightTint: '#ffdcae',
    vignette: [0.28, 0, 0.6, 0.01],
    grain: [0.04, 0, 0.15, 0.005],
  },
  paint: {
    _collapsed: true,
    amount: [0, 0, 1, 0.01],   // off by default: it didn't add much and costs GPU time when on
    radius: [3, 1, 8, 0.25],
    sharpness: [8, 1, 16, 0.5],
    anisotropy: [1, 0.2, 3, 0.05],
    smoothing: [3, 0.5, 8, 0.25],
    saturation: [1.1, 0.4, 1.8, 0.01],
    quality: [0.5, 0.25, 1, 0.05],
  },
};

// Everything that changes where blades are planted. The key changes only when one of
// these moves, which is what triggers a (debounced) rebuild of the blade buffers.
export function bakedKey(values) {
  const { camera: c, growth: g, canvas, flowers: f } = values;
  return [
    c.height, c.distance, c.lookAhead, c.fov,
    g.density, g.tuftSize, g.bladesPerTuft, g.segments, g.undergrowth, g.undergrowthHeight, g.dryTufts, g.seed, g.seedHeads,
    canvas.orientation,
    f.density, f.clusterSize, f.spread,
  ].join('|');
}
