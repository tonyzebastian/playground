// DialKit controls for the handwriting tool. Numeric controls are
// [default, min, max, step].
import { FONT_LABELS } from "./engine/fonts";

export const UPLOADED_FONT = "upload";

export const HANDWRITING_CONFIG = {
  type: {
    _collapsed: false,
    look: {
      type: "select",
      options: [
        { value: "write", label: "Write · pen draws each letter" },
        { value: "blob", label: "Blob · each word morphs out of ink" },
      ],
      default: "write",
    },
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
    // Blob look: frames for a word to form.
    morphFrames: [16, 4, 60, 1],
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
    _collapsed: true,
    // Ink on the joins between letters / words. 0 = each letter on its own.
    connect: [0, 0, 1, 0.05],
    wordConnect: [0, 0, 1, 0.05],
    // Swoop into the first letter and out of the last, in em.
    lead: [0, 0, 3, 0.05],
    tail: [0, 0, 4, 0.05],
    tailDrop: [0, -1, 1, 0.05],
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
};

export const DEFAULT_TEXT = "For a while now,\nI’ve been getting\nmore curious about stories.";
