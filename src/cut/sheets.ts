// The card as layers of card, after paper tole: thin sheets, each a copy of the scan cut to a
// shape, held apart by small gaps. The back is the whole card; the frame is a stack of sheets
// with the art's window cut out; the art's subject is sheets cut smaller and smaller toward
// its nearest parts (Relief.layer), over the back's print of the art; the name box, the stars
// and the text box (and the other games' bars) are a sheet over the frame, the attribute (and
// Magic's P/T box, and what a full art has printed over it) one more.

import { type Layout, onCard, Part } from '../card';
import type { Relief } from './relief';
import { blur, boxBlur, islands } from './ops';

export const FRAME_SHEETS = 5;
export const SUBJECT_SHEETS = 6;
/** The highest level a sheet is at (the attribute's). */
export const TOP_LEVEL = FRAME_SHEETS + 2;
/** A piece of the subject's sheets smaller than this many pixels is not cut (nor a hole that small). */
const SMALLEST_PIECE = 150;
/** A sheet's edge: where its softened mask crosses this. */
const EDGE = 0.5;

/** The ambient occlusion maps' size: half the scan's. */
export const aoSize = (layout: Layout) => ({ w: Math.ceil(layout.w / 2), h: Math.ceil(layout.h / 2) });

const RAISED: Part[] = [Part.Name, Part.Attribute, Part.Star, Part.TextEdge, Part.Text, Part.Bar, Part.Stats, Part.Overlay];
const TOP: Part[] = [Part.Attribute, Part.Stats, Part.Overlay];

export interface Sheet {
  /** Its shape, 0-255 a pixel at the scan's size, softened so its edge runs between pixels. */
  mask: Uint8Array;
  /** The pixels around it (with a margin), as a box of pixel edges. */
  bounds: { x: number; y: number; w: number; h: number };
  /** The levels a copy of it is at: 0 the back's, then one sheet's pitch higher each. */
  levels: number[];
  /** Whether its underside is the card's back. */
  back: boolean;
  /** Its outline, six numbers a segment: two ends (scan pixels, middles at whole numbers) and the way out of the shape. */
  edges: Float32Array;
}

/**
 * How the subject's sheets stack: "single" puts each part of it on one sheet only (the
 * nearest parts float highest, nothing repeated under them); "nested" repeats every sheet's
 * print on all the sheets under it, like a stack of ever smaller cut-outs.
 */
export type Stack = 'single' | 'nested';

export function sheets(map: Relief, stack: Stack = 'single'): Sheet[] {
  const { layout, parts, layer } = map;
  const { w: W, h: H } = layout;
  const n = W * H;
  const list: Sheet[] = [];
  const add = (inside: (i: number) => boolean, levels: number[], back = false) => {
    const mask = new Float32Array(n);
    for (let i = 0; i < n; i++) mask[i] = inside(i) ? 1 : 0;
    blur(mask, W, H, 0.7);
    const bounds = boundsOf(mask, W, H);
    if (bounds.w <= 0) return;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, mask[i])) * 255);
    list.push({ mask: bytes, bounds, levels, back, edges: outline(mask, W, H) });
  };

  const card = new Uint8Array(n);
  for (let i = 0; i < n; i++) card[i] = onCard(layout, i % W, Math.floor(i / W)) ? 1 : 0;
  add((i) => card[i] === 1, [0], true);
  add(
    (i) => card[i] === 1 && parts[i] !== Part.Back && parts[i] !== Part.Subject,
    Array.from({ length: FRAME_SHEETS }, (_, k) => k + 1),
  );
  let under: Uint8Array | null = null;
  for (let k = 1; k <= SUBJECT_SHEETS; k++) {
    const least = (k - 1) / SUBJECT_SHEETS;
    const most = k === SUBJECT_SHEETS ? Infinity : k / SUBJECT_SHEETS;
    const cut = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (parts[i] !== Part.Subject) continue;
      const l = layer[i];
      // single: each part of the subject on its own sheet only, floating over the back's
      // print; nested: every sheet carries everything nearer too, each piece resting on the
      // sheet under it
      const fromHere = k === 1 || l >= least;
      cut[i] = fromHere && (stack === 'nested' || l < most) ? 1 : 0;
    }
    islands(cut, W, H, 1, SMALLEST_PIECE);
    islands(cut, W, H, 0, SMALLEST_PIECE);
    if (stack === 'nested') {
      if (under) for (let i = 0; i < n; i++) cut[i] &= under[i];
      under = cut;
    }
    add((i) => cut[i] === 1, [k]);
  }
  add((i) => RAISED.includes(parts[i] as Part), [FRAME_SHEETS + 1]);
  add((i) => TOP.includes(parts[i] as Part), [FRAME_SHEETS + 2]);
  return list;
}

function boundsOf(mask: Float32Array, W: number, H: number) {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] < 0.01) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0 };
  x0 = Math.max(x0 - 2, 0);
  y0 = Math.max(y0 - 2, 0);
  x1 = Math.min(x1 + 3, W);
  y1 = Math.min(y1 + 3, H);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A mask's value between pixels (a pixel's middle at whole numbers), nothing past the scan. */
function sample(mask: Float32Array, W: number, H: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px: number, py: number) => (px < 0 || py < 0 || px >= W || py >= H ? 0 : mask[py * W + px]);
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return top + (bottom - top) * fy;
}

/**
 * The edge of a mask's shape, as short segments (marching squares between the middles of
 * pixels, nothing past the scan's edge), each with the way out of the shape.
 */
function outline(mask: Float32Array, W: number, H: number): Float32Array {
  const out: number[] = [];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
  const cross = (ax: number, ay: number, bx: number, by: number, va: number, vb: number): [number, number] => {
    const t = Math.abs(vb - va) < 1e-6 ? 0.5 : Math.min(1, Math.max(0, (EDGE - va) / (vb - va)));
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  };
  const add = (a: [number, number], b: [number, number]) => {
    if (Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5) return;
    let sx = b[1] - a[1];
    let sy = a[0] - b[0];
    const len = Math.hypot(sx, sy);
    sx /= len;
    sy /= len;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    if (sample(mask, W, H, mx + sx * 0.6, my + sy * 0.6) > sample(mask, W, H, mx - sx * 0.6, my - sy * 0.6)) {
      sx = -sx;
      sy = -sy;
    }
    out.push(a[0], a[1], b[0], b[1], sx, sy);
  };
  for (let y = -1; y < H; y++)
    for (let x = -1; x < W; x++) {
      const v0 = at(x, y);
      const v1 = at(x + 1, y);
      const v2 = at(x + 1, y + 1);
      const v3 = at(x, y + 1);
      const c = (v0 > EDGE ? 1 : 0) | (v1 > EDGE ? 2 : 0) | (v2 > EDGE ? 4 : 0) | (v3 > EDGE ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const top = () => cross(x, y, x + 1, y, v0, v1);
      const right = () => cross(x + 1, y, x + 1, y + 1, v1, v2);
      const bottom = () => cross(x + 1, y + 1, x, y + 1, v2, v3);
      const left = () => cross(x, y + 1, x, y, v3, v0);
      const middle = (v0 + v1 + v2 + v3) / 4 > EDGE;
      switch (c) {
        case 1:
        case 14:
          add(left(), top());
          break;
        case 2:
        case 13:
          add(top(), right());
          break;
        case 3:
        case 12:
          add(left(), right());
          break;
        case 4:
        case 11:
          add(right(), bottom());
          break;
        case 6:
        case 9:
          add(top(), bottom());
          break;
        case 7:
        case 8:
          add(bottom(), left());
          break;
        case 5:
          if (middle) add(top(), right()), add(bottom(), left());
          else add(left(), top()), add(right(), bottom());
          break;
        case 10:
          if (middle) add(left(), top()), add(right(), bottom());
          else add(top(), right()), add(bottom(), left());
          break;
      }
    }
  return Float32Array.from(out);
}

/**
 * Ambient occlusion baked for each level (0 to TOP_LEVEL), at half the scan's size: how much
 * the sheets above a point hide the room's light from it. What is close above counts most and
 * casts a tight shadow; what is higher up, a fainter and wider one.
 */
export function occlusion(list: Sheet[], layout: Layout): Uint8Array[] {
  const { w: W, h: H } = layout;
  const { w: AO_W, h: AO_H } = aoSize(layout);
  const n = AO_W * AO_H;
  // what covers each level: everything above it (the highest sheet's mask, at half size)
  const above: Float32Array[] = Array.from({ length: TOP_LEVEL + 1 }, () => new Float32Array(n));
  for (const sheet of list) {
    const half = new Float32Array(n);
    for (let y = 0; y < AO_H; y++)
      for (let x = 0; x < AO_W; x++) {
        let s = 0;
        let c = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const px = 2 * x + dx;
            const py = 2 * y + dy;
            if (px < W && py < H) {
              s += sheet.mask[py * W + px];
              c++;
            }
          }
        half[y * AO_W + x] = s / c / 255;
      }
    for (const level of sheet.levels)
      for (let below = 0; below < level; below++) {
        const cover = above[below];
        for (let i = 0; i < n; i++) if (half[i] > cover[i]) cover[i] = half[i];
      }
  }
  // (in millimetres: a sheet's pitch is 1.2)
  const rings = [
    { above: 1, weight: 0.5, sigmaMm: 1.0 },
    { above: 2, weight: 0.3, sigmaMm: 2.0 },
    { above: 3, weight: 0.2, sigmaMm: 3.2 },
  ];
  const pxPerMm = AO_W / layout.mm.x;
  const blurred = new Map<string, Float32Array>();
  const cover = (from: number, sigmaMm: number) => {
    const key = `${from}:${sigmaMm}`;
    let b = blurred.get(key);
    if (!b) {
      b = new Float32Array(above[from]);
      boxBlur(b, AO_W, AO_H, sigmaMm * pxPerMm);
      blurred.set(key, b);
    }
    return b;
  };
  const maps: Uint8Array[] = [];
  for (let level = 0; level <= TOP_LEVEL; level++) {
    const occ = new Float32Array(n);
    for (const ring of rings) {
      // what is at least `ring.above` levels higher
      const from = level + ring.above - 1;
      if (from > TOP_LEVEL - 1) continue;
      const b = cover(from, ring.sigmaMm);
      for (let i = 0; i < n; i++) occ[i] += ring.weight * b[i];
    }
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = Math.round(Math.min(1, occ[i]) * 255);
    maps.push(bytes);
  }
  return maps;
}
