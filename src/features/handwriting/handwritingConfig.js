// DialKit controls for the handwriting tool. Numeric controls are
// [default, min, max, step].
import { FONT_LABELS } from "./engine/fonts";

export const UPLOADED_FONT = "upload";

export const HANDWRITING_CONFIG = {
  type: {
    _collapsed: false,
    font: {
      type: "select",
      options: [
        ...Object.entries(FONT_LABELS).map(([value, label]) => ({ value, label })),
        { value: UPLOADED_FONT, label: "Uploaded font" },
      ],
      default: "reenieBeanie",
    },
    uploadFont: { type: "action", label: "Upload a font (.ttf / .otf)…" },
    size: [150, 40, 400, 1],
    // 0 uses the font's own pen width.
    weight: [0, 0, 0.2, 0.005],
    lineHeight: [0.9, 0.5, 2, 0.05],
    align: {
      type: "select",
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Centre" },
        { value: "right", label: "Right" },
      ],
      default: "center",
    },
  },
  timing: {
    _collapsed: false,
    // Frames between one word starting and the next (30 fps).
    wordGap: [6, 1, 30, 1],
    // Pen speed, px per frame.
    speed: [190, 20, 600, 5],
    // Frames the text stays after the last word, before it leaves.
    hold: [40, 0, 200, 1],
    exit: {
      type: "select",
      options: [
        { value: "unwrite", label: "Unwrite" },
        { value: "dissolve", label: "Dissolve" },
        { value: "none", label: "Stay" },
      ],
      default: "unwrite",
    },
    loop: true,
  },
  pen: {
    _collapsed: false,
    // Ink on the joins between letters / words. 0 = each letter on its own.
    connect: [0, 0, 1, 0.05],
    wordConnect: [0, 0, 1, 0.05],
    // Swoop into the first letter (first line only), about this long in em.
    lead: [0.6, 0, 3, 0.05],
    leadStyle: {
      type: "select",
      options: [
        { value: "auto", label: "Auto" },
        { value: "swoop", label: "Swoop · up from the lower left" },
        { value: "line", label: "Line · straight run-in" },
        { value: "hook", label: "Hook · rises from below" },
        { value: "wave", label: "Wave" },
      ],
      default: "auto",
    },
    // Flourish after the last word (last line only), about this long in em.
    tail: [1, 0, 4, 0.05],
    tailStyle: {
      type: "select",
      options: [
        { value: "auto", label: "Auto" },
        { value: "flick", label: "Flick" },
        { value: "lift", label: "Lift · up and away" },
        { value: "drop", label: "Drop · down and away" },
        { value: "wave", label: "Wave" },
        { value: "swash", label: "Swash · back under the word" },
      ],
      default: "auto",
    },
    // Re-rolls the lead and tail shapes and lengths.
    variation: [1, 1, 100, 1],
  },
  wobble: {
    _collapsed: true,
    wiggle: [1, 0, 4, 0.1],
    // How often the wobble re-rolls, in frames.
    boil: [3, 1, 12, 1],
    // Rough, dry-brush edges.
    texture: [1, 0, 3, 0.1],
  },
  colors: {
    _collapsed: true,
    ink: "#ffffff",
    background: "#5e554d",
    shadow: true,
  },
  // Saves the text and settings as JSON for the Motion repo, which renders
  // a transparent ProRes 4444 .mov (npm run handwriting -- file.json).
  export: {
    _collapsed: false,
    resolution: {
      type: "select",
      options: [
        { value: "1920x1080", label: "1080p · 1920×1080" },
        { value: "3840x2160", label: "4K · 3840×2160" },
        { value: "2560x1440", label: "1440p · 2560×1440" },
      ],
      default: "1920x1080",
    },
    fps: {
      type: "select",
      options: [
        { value: "24", label: "24 fps" },
        { value: "25", label: "25 fps" },
        { value: "30", label: "30 fps" },
        { value: "60", label: "60 fps" },
      ],
      default: "30",
    },
    download: { type: "action", label: "Export for video (.json)…" },
  },
};

// Sits at the top of every export, so the file can simply be handed over
// (to Claude, say) and rendered without any other explanation.
const EXPORT_INSTRUCTIONS = [
  "Handwriting clip settings exported from the playground Handwriting tool (play.tonyzeb.com/tools/handwriting).",
  "To make the video, render this file right away, no questions needed: in the Motion repo (~/Desktop/Personal/Code/Motion) run",
  "  npm run handwriting -- <path to this file>",
  "That writes a transparent ProRes 4444 .mov to out/handwriting/<this file's name>.mov, ready to drop above footage in DaVinci Resolve.",
  "Add --png for a transparent PNG sequence instead. Details: tools/handwriting/README.md in the Motion repo.",
].join("\n");

// The settings file the Motion repo's HandwritingClip composition reads.
// Keep the keys in step with its schema (handwriting/HandwritingClip.tsx).
export function exportSettings(values, text, customFont) {
  const [width, height] = values.export.resolution.split("x").map(Number);
  const uploaded = values.type.font === UPLOADED_FONT && customFont;
  return {
    // Read by whoever (or whatever agent) is handed this file.
    instructions: EXPORT_INSTRUCTIONS,
    text,
    font: uploaded ? "upload" : values.type.font === UPLOADED_FONT ? "reenieBeanie" : values.type.font,
    fontData: uploaded ? customFont : null,
    size: values.type.size,
    weight: values.type.weight,
    lineHeight: values.type.lineHeight,
    align: values.type.align,
    wordGap: values.timing.wordGap,
    speed: values.timing.speed,
    hold: values.timing.hold,
    exit: values.timing.exit,
    connect: values.pen.connect,
    wordConnect: values.pen.wordConnect,
    lead: values.pen.lead,
    leadStyle: values.pen.leadStyle,
    tail: values.pen.tail,
    tailStyle: values.pen.tailStyle,
    variation: values.pen.variation,
    wiggle: values.wobble.wiggle,
    boil: values.wobble.boil,
    texture: values.wobble.texture,
    ink: values.colors.ink,
    shadow: values.colors.shadow,
    width,
    height,
    fps: Number(values.export.fps),
  };
}

export const DEFAULT_TEXT = "For a while now,\nI’ve been getting\nmore curious about stories.";
