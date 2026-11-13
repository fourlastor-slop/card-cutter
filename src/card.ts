// Where the parts of a modern TCG frame are, measured on YGOPRODeck's 813x1185 scans (a scan
// of another size is stretched to that first). Boxes are x, y, width, height in scan pixels.

export const W = 813;
export const H = 1185;

/** A card's size in millimetres, and its corners' radius. */
export const CARD_MM = { x: 59, y: 86 } as const;
export const CORNER_MM = 2.6;
/** A scan pixel, in millimetres. */
export const MM_PER_PIXEL = CARD_MM.x / W;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FRAME_BOX: Box = { x: 26, y: 26, w: 760, h: 1132 };
export const NAME_BOX: Box = { x: 42, y: 44, w: 728, h: 93 };
export const ATTRIBUTE = { x: 717, y: 91, r: 38 } as const;
export const STARS = { y: 167, rightX: 702, step: 51.9, r: 24, max: 12 } as const;
/** The art window's lip. */
export const LIP_BOX: Box = { x: 86, y: 205, w: 643, h: 641 };
export const ART_BOX: Box = { x: 96, y: 216, w: 622, h: 620 };
export const TEXT_OUTER: Box = { x: 44, y: 873, w: 721, h: 252 };
export const TEXT_INNER: Box = { x: 57, y: 890, w: 696, h: 214 };

/** What each scan pixel is part of. */
export const Part = {
  Border: 0,
  Frame: 1,
  Name: 2,
  Attribute: 3,
  Star: 4,
  Lip: 5,
  Back: 6,
  Subject: 7,
  TextEdge: 8,
  Text: 9,
} as const;
export type Part = (typeof Part)[keyof typeof Part];

/** How far inside a box a pixel is (from its nearest edge; negative outside). */
export function inset(box: Box, x: number, y: number): number {
  return Math.min(Math.min(x - box.x, box.x + box.w - 1 - x), Math.min(y - box.y, box.y + box.h - 1 - y));
}

/** Whether a scan pixel is on the card, inside its rounded corners. */
export function onCard(x: number, y: number): boolean {
  const ax = Math.abs(((x + 0.5) / W - 0.5) * CARD_MM.x) - (CARD_MM.x / 2 - CORNER_MM);
  const ay = Math.abs(((y + 0.5) / H - 0.5) * CARD_MM.y) - (CARD_MM.y / 2 - CORNER_MM);
  const cx = Math.max(ax, 0);
  const cy = Math.max(ay, 0);
  return Math.hypot(cx, cy) <= CORNER_MM;
}
