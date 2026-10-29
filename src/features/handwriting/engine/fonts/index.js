// Built-in handwriting fonts, each letter stored as pen strokes.
// felix / allure: single-line plotter fonts (EMS, SIL OFL).
// The rest are Google Fonts traced to their centre line.
import { allure } from "./allure";
import { felix } from "./felix";
import { homemadeApple } from "./homemadeApple";
import { mrsSaintDelafield } from "./mrsSaintDelafield";
import { reenieBeanie } from "./reenieBeanie";
import { sacramento } from "./sacramento";

export const HAND_FONTS = {
  reenieBeanie,
  sacramento,
  homemadeApple,
  mrsSaintDelafield,
  allure,
  felix,
};

export const FONT_LABELS = {
  reenieBeanie: "Reenie Beanie",
  sacramento: "Sacramento",
  homemadeApple: "Homemade Apple",
  mrsSaintDelafield: "Mrs Saint Delafield",
  allure: "EMS Allure (single line)",
  felix: "EMS Felix (single line)",
};
