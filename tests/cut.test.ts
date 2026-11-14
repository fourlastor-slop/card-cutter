import { describe, expect, it } from 'vitest';
import { guessGame, hasArtWindow, type Layout, LAYOUTS, onCard, Part } from '../src/card';
import { distance, islands, otsu } from '../src/cut/ops';
import { countStars, relief } from '../src/cut/relief';
import { aoSize, FRAME_SHEETS, occlusion, sheets, SUBJECT_SHEETS, TOP_LEVEL } from '../src/cut/sheets';
import { findCard, type Quad, quadSize, straighten } from '../src/find';

const YUGIOH = LAYOUTS.yugioh;
const STARS = YUGIOH.stars!;

/**
 * A synthetic scan: a border and a flat frame colour, a dark art background with a light disc
 * in it, and (on Yu-Gi-Oh's frame) `stars` level stars; `light` paints these patches light.
 */
function scan(layout: Layout, stars = 0, light: { x: number; y: number; w: number; h: number }[] = [], border = [200, 160, 90]): Uint8ClampedArray {
  const { w: W, h: H, art, frame } = layout;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const cx = art.x + art.w / 2;
  const cy = art.y + art.h / 2;
  const r = Math.min(art.w, art.h) * 0.29;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inFrame = x >= frame.x && x < frame.x + frame.w && y >= frame.y && y < frame.y + frame.h;
      let c = inFrame ? [200, 160, 90] : border;
      const inArt = x >= art.x && x < art.x + art.w && y >= art.y && y < art.y + art.h;
      if (inArt) c = Math.hypot(x - cx, y - cy) < r ? [235, 235, 240] : [20, 30, 70];
      for (let k = 0; k < stars; k++) if (Math.hypot(x - (STARS.rightX - k * STARS.step), y - STARS.y) < STARS.r) c = [234, 150, 10];
      for (const b of light) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) c = [220, 220, 220];
      rgba.set([...c, 255], i);
    }
  return rgba;
}

/** A depth for the synthetic scan: the disc near, highest in its middle. */
function depth(layout: Layout): Float32Array {
  const { art } = layout;
  const r0 = Math.min(art.w, art.h) * 0.29;
  const d = new Float32Array(art.w * art.h);
  for (let y = 0; y < art.h; y++)
    for (let x = 0; x < art.w; x++) {
      const r = Math.hypot(x - art.w / 2, y - art.h / 2);
      d[y * art.w + x] = r < r0 ? 0.4 + 0.6 * (1 - r / r0) : 0.1;
    }
  return d;
}

/** The scan pixel in the middle of the art, and one near its top-left corner. */
const middleOf = ({ w, art }: Layout) => Math.round(art.y + art.h / 2) * w + Math.round(art.x + art.w / 2);
const cornerOf = ({ w, art }: Layout) => (art.y + 10) * w + art.x + 10;

describe('ops', () => {
  it('splits two groups with Otsu', () => {
    const v = Float32Array.from([...Array(100).fill(0.1), ...Array(100).fill(0.9)]);
    const t = otsu(v);
    // (what is above the threshold is one group)
    expect(v.filter((x) => x > t)).toHaveLength(100);
  });

  it('drops small islands and fills small holes', () => {
    const w = 20;
    const h = 20;
    const m = new Uint8Array(w * h);
    m[5 * w + 5] = 1; // a lone pixel
    for (let y = 10; y < 18; y++) for (let x = 10; x < 18; x++) m[y * w + x] = 1;
    m[13 * w + 13] = 0; // a hole
    islands(m, w, h, 1, 4);
    islands(m, w, h, 0, 4);
    expect(m[5 * w + 5]).toBe(0);
    expect(m[13 * w + 13]).toBe(1);
  });

  it('measures the distance to the outside', () => {
    const w = 9;
    const m = new Uint8Array(w * w).fill(1);
    m[0] = 0;
    const d = distance(m, w, w);
    expect(d[0]).toBe(0);
    expect(d[w * w - 1]).toBeCloseTo(Math.hypot(8, 8));
  });
});

describe('cut', () => {
  it('counts the level stars', () => {
    expect(countStars(scan(YUGIOH, 0), YUGIOH)).toBe(0);
    expect(countStars(scan(YUGIOH, 4), YUGIOH)).toBe(4);
    expect(countStars(scan(YUGIOH, 12), YUGIOH)).toBe(12);
    expect(countStars(scan(LAYOUTS.magic), LAYOUTS.magic)).toBe(0);
  });

  it('finds the subject and cuts it into sheets by depth', () => {
    const map = relief(scan(YUGIOH, 4), YUGIOH, 4, depth(YUGIOH));
    const middle = middleOf(YUGIOH);
    expect(map.parts[middle]).toBe(Part.Subject);
    expect(map.parts[cornerOf(YUGIOH)]).toBe(Part.Back);
    expect(map.parts[STARS.y * YUGIOH.w + STARS.rightX]).toBe(Part.Star);

    const list = sheets(map, 'single');
    expect(list[0].back).toBe(true);
    expect(list[1].levels).toHaveLength(FRAME_SHEETS);
    const levels = list.flatMap((s) => s.levels);
    expect(Math.max(...levels)).toBe(TOP_LEVEL);
    // single: each part of the subject is on one sheet only
    const subject = list.filter((s) => s.levels.length === 1 && s.levels[0] >= 1 && s.levels[0] <= SUBJECT_SHEETS && !s.back);
    const covering = subject.filter((s) => s.mask[middle] > 127);
    expect(covering).toHaveLength(1);
    // and the nearest part (the disc's middle) on a high sheet
    expect(covering[0].levels[0]).toBeGreaterThan(SUBJECT_SHEETS - 2);
    for (const s of list) expect(s.edges.length % 6).toBe(0);

    const nested = sheets(map, 'nested').filter((s) => s.mask[middle] > 127 && !s.back);
    expect(nested.length).toBeGreaterThan(covering.length);

    const ao = occlusion(list, YUGIOH);
    expect(ao).toHaveLength(TOP_LEVEL + 1);
    const size = aoSize(YUGIOH);
    expect(ao[0]).toHaveLength(size.w * size.h);
  });

  it('cuts by steps of depth alone', () => {
    const map = relief(scan(YUGIOH, 0), YUGIOH, 0, depth(YUGIOH), 'steps');
    const middle = middleOf(YUGIOH);
    expect(map.parts[middle]).toBe(Part.Subject);
    expect(map.layer[middle]).toBeGreaterThan(0.9);
    expect(map.parts[cornerOf(YUGIOH)]).toBe(Part.Back);
  });

  for (const layout of [LAYOUTS.magic, LAYOUTS.pokemon])
    it(`cuts ${layout.name}'s frame`, () => {
      const map = relief(scan(layout), layout, 0, depth(layout));
      expect(map.parts).toHaveLength(layout.w * layout.h);
      expect(map.parts[middleOf(layout)]).toBe(Part.Subject);
      expect(map.parts[cornerOf(layout)]).toBe(Part.Back);
      const name = layout.pieces.find((p) => p.part === Part.Name)!.shape;
      expect(map.parts[(name.y + 20) * layout.w + name.x + 200]).toBe(Part.Name);

      const list = sheets(map);
      const covering = list.filter((s) => !s.back && s.mask[middleOf(layout)] > 127);
      expect(covering).toHaveLength(1);
      expect(covering[0].levels[0]).toBeGreaterThan(SUBJECT_SHEETS - 2);
      // the name and the bars a sheet over the frame
      const raised = list.filter((s) => s.levels[0] === FRAME_SHEETS + 1).at(-1)!;
      expect(raised.mask[(name.y + 20) * layout.w + name.x + 200]).toBe(255);
      expect(occlusion(list, layout)[0]).toHaveLength(aoSize(layout).w * aoSize(layout).h);
    });

  it("raises Magic's P/T box only where there is one", () => {
    const magic = LAYOUTS.magic;
    const stats = magic.pieces.find((p) => p.part === Part.Stats)!;
    const box = stats.shape as { x: number; y: number; w: number; h: number };
    const at = (box.y + 30) * magic.w + box.x + 60;
    const black = [10, 10, 10];
    expect(relief(scan(magic, 0, [], black), magic, 0, null).parts[at]).not.toBe(Part.Stats);
    expect(relief(scan(magic, 0, [stats.onlyIf!], black), magic, 0, null).parts[at]).toBe(Part.Stats);
  });

  it('guesses the game', () => {
    const at = (layout: Layout, border: number[]) => guessGame(scan(layout, 0, [], border), layout.w, layout.h, layout.mm.x / layout.mm.y);
    expect(at(YUGIOH, [200, 160, 90])).toBe('yugioh');
    expect(at(LAYOUTS.magic, [12, 12, 12])).toBe('magic');
    expect(at(LAYOUTS.pokemon, [190, 190, 195])).toBe('pokemon');
    expect(at(LAYOUTS.pokemon, [240, 210, 60])).toBe('pokemon');
  });

  it("cuts a full art, keeping what is printed over it on top", () => {
    const full = LAYOUTS['pokemon-full'];
    const map = relief(scan(full), full, 0, depth(full));
    expect(map.parts[middleOf(full)]).toBe(Part.Subject);
    const [header] = full.pieces;
    const box = header.shape as { x: number; y: number; w: number; h: number };
    const at = (box.y + 10) * full.w + box.x + 100;
    expect(map.parts[at]).toBe(Part.Overlay);
    const top = sheets(map).filter((s) => s.levels[0] === TOP_LEVEL);
    expect(top).toHaveLength(1);
    expect(top[0].mask[at]).toBe(255);
  });

  it("tells a Pokémon card's art window from a full art", () => {
    const { w, h } = LAYOUTS.pokemon;
    expect(hasArtWindow(scan(LAYOUTS.pokemon))).toBe(true);
    // a smooth gradient all over
    const smooth = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) smooth.set([((i % w) / w) * 255, ((i / w / h) * 255) | 0, 120, 255], i * 4);
    expect(hasArtWindow(smooth)).toBe(false);
  });

  it('rounds the card corners', () => {
    for (const layout of Object.values(LAYOUTS)) {
      expect(onCard(layout, 0, 0)).toBe(false);
      expect(onCard(layout, layout.w / 2, layout.h / 2)).toBe(true);
    }
  });
});

/**
 * A synthetic photo: a card (a yellow border with rounded corners round a square-cornered
 * blue art) turned `degrees`, on a dark, slightly noisy table.
 */
function photo(degrees: number) {
  const width = 600;
  const height = 800;
  const data = new Uint8ClampedArray(width * height * 4);
  const card = { x: 300, y: 410, w: 504, h: 704, r: 22 };
  const turn = (degrees * Math.PI) / 180;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) % 13) - 6;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // the pixel in the card's own frame, from its middle
      const u = (x - card.x) * Math.cos(turn) + (y - card.y) * Math.sin(turn);
      const v = -(x - card.x) * Math.sin(turn) + (y - card.y) * Math.cos(turn);
      const cx = Math.max(Math.abs(u) - (card.w / 2 - card.r), 0);
      const cy = Math.max(Math.abs(v) - (card.h / 2 - card.r), 0);
      const on = Math.hypot(cx, cy) <= card.r;
      const art = Math.abs(u) < card.w / 2 - 24 && Math.abs(v) < card.h / 2 - 24;
      const c = !on ? [40 + noise(), 30 + noise(), 25 + noise()] : art ? [90, 140, 200] : [230, 190, 60];
      data.set([...c, 255], (y * width + x) * 4);
    }
  return { image: { data, width, height }, card };
}

describe('find', () => {
  it('finds a card turned in a photo and straightens it', () => {
    const { image, card } = photo(3);
    const quad = findCard(image);
    expect(quad).not.toBeNull();
    const size = quadSize(quad!);
    expect(size.width).toBeGreaterThan(card.w - 6);
    expect(size.width).toBeLessThan(card.w + 6);
    expect(size.height).toBeGreaterThan(card.h - 6);
    expect(size.height).toBeLessThan(card.h + 6);
    const flat = straighten(image, quad!.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })) as Quad, 252, 352);
    const colour = (x: number, y: number) => Array.from(flat.data.subarray((y * 252 + x) * 4, (y * 252 + x) * 4 + 3));
    // the border along the sides, the art in the middle
    expect(colour(4, 176)).toEqual([230, 190, 60]);
    expect(colour(247, 176)).toEqual([230, 190, 60]);
    expect(colour(126, 4)).toEqual([230, 190, 60]);
    expect(colour(126, 176)).toEqual([90, 140, 200]);
  });

  it('leaves a scan already cut to the card alone', () => {
    // the synthetic scans: border, then a frame with square corners
    expect(findCard({ data: scan(LAYOUTS.magic, 0, [], [10, 10, 10]), width: LAYOUTS.magic.w, height: LAYOUTS.magic.h })).toBeNull();
    expect(findCard({ data: scan(YUGIOH), width: YUGIOH.w, height: YUGIOH.h })).toBeNull();
  });
});
