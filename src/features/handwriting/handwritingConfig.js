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
};

export const DEFAULT_TEXT = "For a while now,\nI’ve been getting\nmore curious about stories.";
