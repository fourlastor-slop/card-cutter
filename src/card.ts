// Where the parts of each game's modern frame are, measured on scans of a common size for it
// (a scan of another size is stretched to that first). Boxes are x, y, width, height in scan
// pixels.

export type Game = 'yugioh' | 'magic' | 'pokemon' | 'pokemon-full';
export const GAMES: readonly Game[] = ['yugioh', 'magic', 'pokemon', 'pokemon-full'];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

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
  /** A bar printed across the frame: Magic's type line, Pokémon's species and weakness strips. */
  Bar: 10,
  /** Magic's power/toughness box. */
  Stats: 11,
  /** Print over a full art (the name, the rules), kept above all of it. */
  Overlay: 12,
} as const;
export type Part = (typeof Part)[keyof typeof Part];

/** A part of the frame raised over it (sheets.ts): a box or a disc, the later over the earlier. */
export interface Piece {
  part: Part;
  shape: Box | Circle;
  /** Only on cards where this patch is light (Magic's P/T box: the black border otherwise). */
  onlyIf?: Box;
  /** Printed over the art rather than on the frame (full-art cards). */
  over?: boolean;
}

export interface Layout {
  game: Game;
  name: string;
  /** The size of scan the frame was measured on. */
  w: number;
  h: number;
  /** The card's size in millimetres, and its corners' radius. */
  mm: { x: number; y: number };
  cornerMm: number;
  /** Inside the border. */
  frame: Box;
  /** The art window's lip, and the art inside it. */
  lip: Box;
  art: Box;
  pieces: Piece[];
  /** Yu-Gi-Oh's level stars, counted from the right. */
  stars?: { y: number; rightX: number; step: number; r: number; max: number };
}

// YGOPRODeck's 813x1185 scans
const YUGIOH: Layout = {
  game: 'yugioh',
  name: 'Yu-Gi-Oh!',
  w: 813,
  h: 1185,
  mm: { x: 59, y: 86 },
  cornerMm: 2.6,
  frame: { x: 26, y: 26, w: 760, h: 1132 },
  lip: { x: 86, y: 205, w: 643, h: 641 },
  art: { x: 96, y: 216, w: 622, h: 620 },
  pieces: [
    { part: Part.Name, shape: { x: 42, y: 44, w: 728, h: 93 } },
    { part: Part.Attribute, shape: { x: 717, y: 91, r: 38 } },
    { part: Part.TextEdge, shape: { x: 44, y: 873, w: 721, h: 252 } },
    { part: Part.Text, shape: { x: 57, y: 890, w: 696, h: 214 } },
  ],
  stars: { y: 167, rightX: 702, step: 51.9, r: 24, max: 12 },
};

// Scryfall's 744x1040 PNGs, the frame since Magic 2015 (not planeswalkers, sagas and the like)
const MAGIC: Layout = {
  game: 'magic',
  name: 'Magic',
  w: 744,
  h: 1040,
  mm: { x: 63, y: 88 },
  cornerMm: 2.5,
  frame: { x: 30, y: 30, w: 684, h: 935 },
  lip: { x: 53, y: 113, w: 637, h: 469 },
  art: { x: 58, y: 118, w: 627, h: 459 },
  pieces: [
    { part: Part.Name, shape: { x: 44, y: 50, w: 656, h: 62 } },
    { part: Part.Bar, shape: { x: 44, y: 585, w: 656, h: 62 } },
    { part: Part.TextEdge, shape: { x: 50, y: 647, w: 641, h: 317 } },
    { part: Part.Text, shape: { x: 55, y: 651, w: 631, h: 307 } },
    { part: Part.Stats, shape: { x: 578, y: 922, w: 124, h: 62 }, onlyIf: { x: 600, y: 966, w: 80, h: 12 } },
  ],
};

// pokemontcg.io's 734x1024 scans, the Scarlet & Violet frame (Sword & Shield's is close; not
// full-art cards, whose art has no window)
const POKEMON: Layout = {
  game: 'pokemon',
  name: 'Pokémon',
  w: 734,
  h: 1024,
  mm: { x: 63, y: 88 },
  cornerMm: 2.8,
  frame: { x: 28, y: 28, w: 676, h: 969 },
  lip: { x: 52, y: 95, w: 632, h: 388 },
  art: { x: 58, y: 100, w: 619, h: 382 },
  pieces: [
    { part: Part.Name, shape: { x: 30, y: 30, w: 672, h: 62 } },
    { part: Part.Attribute, shape: { x: 662, y: 59, r: 26 } },
    { part: Part.Bar, shape: { x: 37, y: 484, w: 660, h: 32 } },
    { part: Part.Bar, shape: { x: 30, y: 875, w: 667, h: 42 } },
  ],
};

// The same scans, full-art cards (Scarlet & Violet's ex and illustration rares, Sword &
// Shield's V): the art fills the border, the name and HP above it and the weakness and rules
// below it printed over it
const POKEMON_FULL: Layout = {
  ...POKEMON,
  game: 'pokemon-full',
  name: 'Pokémon (full art)',
  lip: { x: 34, y: 40, w: 666, h: 940 },
  art: { x: 34, y: 40, w: 666, h: 940 },
  pieces: [
    { part: Part.Overlay, shape: { x: 34, y: 40, w: 666, h: 78 }, over: true },
    { part: Part.Overlay, shape: { x: 34, y: 880, w: 666, h: 100 }, over: true },
  ],
};

export const LAYOUTS: Record<Game, Layout> = { yugioh: YUGIOH, magic: MAGIC, pokemon: POKEMON, 'pokemon-full': POKEMON_FULL };

/** How far inside a box a pixel is (from its nearest edge; negative outside). */
export function inset(box: Box, x: number, y: number): number {
  return Math.min(Math.min(x - box.x, box.x + box.w - 1 - x), Math.min(y - box.y, box.y + box.h - 1 - y));
}

/** Whether a pixel is in a piece's box or disc. */
export function within(shape: Box | Circle, x: number, y: number): boolean {
  return 'r' in shape ? Math.hypot(x - shape.x, y - shape.y) < shape.r : inset(shape, x, y) >= 0;
}

/** Whether a scan pixel is on the card, inside its rounded corners. */
export function onCard(layout: Layout, x: number, y: number): boolean {
  const { w, h, mm, cornerMm } = layout;
  const ax = Math.abs(((x + 0.5) / w - 0.5) * mm.x) - (mm.x / 2 - cornerMm);
  const ay = Math.abs(((y + 0.5) / h - 0.5) * mm.y) - (mm.y / 2 - cornerMm);
  const cx = Math.max(ax, 0);
  const cy = Math.max(ay, 0);
  return Math.hypot(cx, cy) <= cornerMm;
}

/**
 * Which game a scan is from, by its shape and its border: Yu-Gi-Oh's cards are narrower
 * (59x86 mm, the others 63x88); Magic's border is black, Pokémon's silver or yellow.
 * `rgba`: the scan at any size `w` x `h`; `aspect`: the image's width over its height.
 */
export function guessGame(rgba: Uint8ClampedArray, w: number, h: number, aspect: number): Game {
  const narrow = YUGIOH.mm.x / YUGIOH.mm.y;
  const wide = MAGIC.mm.x / MAGIC.mm.y;
  if (Math.abs(aspect - narrow) < Math.abs(aspect - wide)) return 'yugioh';
  // the border down the sides, clear of the corners (transparent in some scans)
  let sum = 0;
  let count = 0;
  const edge = Math.max(1, Math.round(w * 0.02));
  for (let y = Math.round(h * 0.15); y < h * 0.85; y++)
    for (const x of [edge, w - 1 - edge]) {
      const s = (y * w + x) * 4;
      sum += 0.2126 * rgba[s] + 0.7152 * rgba[s + 1] + 0.0722 * rgba[s + 2];
      count++;
    }
  return sum / count < 70 ? 'magic' : 'pokemon';
}

/**
 * Whether a Pokémon card has an art window (else it is full art): the window's sides and the
 * bar under it are sharp straight edges where a full art has none. `rgba`: the scan at the
 * Pokémon layout's size.
 */
export function hasArtWindow(rgba: Uint8ClampedArray): boolean {
  const { w } = POKEMON;
  const grey = (x: number, y: number) => {
    const s = (y * w + x) * 4;
    return 0.2126 * rgba[s] + 0.7152 * rgba[s + 1] + 0.0722 * rgba[s + 2];
  };
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1];
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);
  // the strongest edge near each of the window's sides (the median along it, for its straightness)
  const column = (x: number) => median(range(140, 440).map((y) => Math.abs(grey(x + 1, y) - grey(x, y))));
  const row = (y: number) => median(range(100, 630).map((x) => Math.abs(grey(x, y + 1) - grey(x, y))));
  const left = Math.max(...range(46, 64).map(column));
  const right = Math.max(...range(670, 690).map(column));
  const bottom = Math.max(...range(474, 494).map(row));
  return (left + right + bottom) / 3 > 30;
}
