// What each pixel of a card scan is part of, and how near the art's subject is, for cutting
// it into sheets (sheets.ts). The frame's parts are where every modern frame has them
// (card.ts). The art's subject is what a fill from the window's edge through like colours
// does not reach: the fill's barrier (the range of colour crossed on the way in) is low on
// the background and high past the subject's edge. Given a depth of the art (from a depth
// model), background walled in by the subject (which the fill cannot reach) is found too:
// what is in the colours of the background the fill did reach and as far back; and the
// subject's sheets follow the depth.

import { ART_BOX, ATTRIBUTE, FRAME_BOX, H, inset, LIP_BOX, NAME_BOX, Part, STARS, TEXT_INNER, TEXT_OUTER, W } from '../card';
import { barrier, blur, dilate, distance, erode, islands, lab, otsu, palette, percentile } from './ops';

/** Background walled in by the subject: a patch at most this far (ΔE, blurred) from the background's colours, and at least this share of the art. */
const POCKET_COLOUR = 12;
const POCKET_SHARE = 0.004;
/** Without a depth, the subject's sheets go by how far in from its edge it is (all of the way at this many pixels), raised a little where the art is lighter than around. */
const LAYER_SPAN = 64;
const LAYER_LIGHT = 0.2;
/** With a depth, what is nearer than this share of the way from the background's depth to the subject's joins the subject, whatever its colour. */
const NEAR_SHARE = 0.5;
/** The subject's sheets (sheets.ts SUBJECT_SHEETS), for cutting by steps of depth. */
const SUBJECT_STEPS = 6;

/** How the art's subject is found: by colour alone, by colour and depth together, or by depth alone in equal steps. */
export type SubjectBy = 'colour' | 'depth' | 'steps';

export interface Relief {
  parts: Uint8Array;
  /** How near each pixel of the art's subject is, 0-1, for cutting it into sheets; -1 off the subject. */
  layer: Float32Array;
  /** For looking at: the art box's subject (1), filled holes (2), background walled in (3). */
  subject: Uint8Array;
}

/**
 * `rgba`: the scan at 813x1185. `stars`: the level stars on the frame (0-12). `depth`: how
 * near each pixel of the art box is (0 farthest, 1 nearest, row by row), or null.
 */
export function relief(rgba: Uint8ClampedArray, stars: number, depth: Float32Array | null, by: SubjectBy = 'depth'): Relief {
  const parts = frame(Math.max(0, Math.min(STARS.max, stars)));
  const layer = new Float32Array(W * H).fill(-1);
  const subject = art(rgba, depth, parts, layer, by);
  return { parts, layer, subject };
}

function frame(stars: number): Uint8Array {
  const parts = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let part: Part = inset(FRAME_BOX, x, y) >= 0 ? Part.Frame : Part.Border;
      if (inset(NAME_BOX, x, y) >= 0) part = Part.Name;
      if (Math.hypot(x - ATTRIBUTE.x, y - ATTRIBUTE.y) < ATTRIBUTE.r) part = Part.Attribute;
      for (let k = 0; k < stars; k++)
        if (Math.hypot(x - (STARS.rightX - k * STARS.step), y - STARS.y) < STARS.r) part = Part.Star;
      const inText = inset(TEXT_OUTER, x, y);
      const inWords = inset(TEXT_INNER, x, y);
      if (inText >= 0 && inWords < 0) part = Part.TextEdge;
      else if (inWords >= 0) part = Part.Text;
      if (inset(LIP_BOX, x, y) >= 0) part = Part.Lip;
      parts[y * W + x] = part;
    }
  return parts;
}

function art(rgba: Uint8ClampedArray, depth: Float32Array | null, parts: Uint8Array, layerOut: Float32Array, by: SubjectBy): Uint8Array {
  const w = ART_BOX.w;
  const h = ART_BOX.h;
  const n = w * h;
  const labs = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const c = [0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((ART_BOX.y + y) * W + ART_BOX.x + x) * 4;
      lab(rgba[s], rgba[s + 1], rgba[s + 2], c);
      const i = y * w + x;
      labs[0][i] = c[0];
      labs[1][i] = c[1];
      labs[2][i] = c[2];
    }

  // the barrier from the window's edge, in each of L*, a* and b*, summed
  const bar = new Float32Array(n);
  for (const channel of labs) barrier(channel, w, h, bar);
  blur(bar, w, h, 1.5);
  const top = Math.max(percentile(bar, 0.98), 1e-3);
  for (let i = 0; i < n; i++) bar[i] = Math.min(bar[i] / top, 1);
  const threshold = otsu(bar);

  const subject = new Uint8Array(n);
  for (let i = 0; i < n; i++) subject[i] = bar[i] > threshold ? 1 : 0;
  dilate(subject, w, h, 2);
  erode(subject, w, h, 2);
  erode(subject, w, h, 2);
  dilate(subject, w, h, 2);
  islands(subject, w, h, 1, n * 0.004);
  const before = new Uint8Array(subject);
  islands(subject, w, h, 0, n * 0.03);
  const open = (i: number) => bar[i] < threshold * 0.6;

  // depth: what stands clearly nearer than the background joins the subject even in the
  // background's colours (Obelisk's dark armour against a dark sky). The background's depth
  // is taken low (a quarter of the way up the open background's): that area can hold dark
  // parts of the subject the colour fill reached too
  if (depth && by === 'depth') {
    const back = percentile(depth, 0.25, open);
    const held = percentile(depth, 0.5, (i) => subject[i] === 1);
    if (held > back) {
      const line = back + NEAR_SHARE * (held - back);
      const near = new Uint8Array(n);
      for (let i = 0; i < n; i++) near[i] = depth[i] > line ? 1 : 0;
      erode(near, w, h, 2);
      dilate(near, w, h, 2);
      islands(near, w, h, 1, n * 0.004);
      for (let i = 0; i < n; i++) if (near[i]) subject[i] = 1;
      islands(subject, w, h, 0, n * 0.03);
    }
  }

  // steps: no colour at all; the art in equal steps of depth, the farthest left on the back
  const lowest = depth ? percentile(depth, 0.02) : 0;
  const highest = depth ? percentile(depth, 0.98) : 1;
  const firstStep = lowest + (highest - lowest) / (SUBJECT_STEPS + 1);
  if (depth && by === 'steps') {
    for (let i = 0; i < n; i++) subject[i] = depth[i] >= firstStep ? 1 : 0;
    islands(subject, w, h, 1, n * 0.002);
    islands(subject, w, h, 0, n * 0.002);
  }

  // background walled in by the subject: patches of it in the colours of the background the
  // fill reached easily, and nearer the background's depth than the subject's. Only with a
  // depth: by colour alone a light subject on a background with light in it is taken away
  // (Blue-Eyes's head, against the swirl's highlights)
  const pocket = new Uint8Array(n);
  if (depth && (by === 'colour' || by === 'depth')) {
    const back = palette(labs, n, open, 6);
    const toBack = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const p of back) best = Math.min(best, Math.hypot(labs[0][i] - p[0], labs[1][i] - p[1], labs[2][i] - p[2]));
      toBack[i] = best;
    }
    blur(toBack, w, h, 2);
    const middle = (percentile(depth, 0.5, open) + percentile(depth, 0.5, (i) => subject[i] === 1)) / 2;
    for (let i = 0; i < n; i++) pocket[i] = subject[i] && toBack[i] < POCKET_COLOUR && depth[i] < middle ? 1 : 0;
    islands(pocket, w, h, 1, n * POCKET_SHARE);
    for (let i = 0; i < n; i++) if (pocket[i]) subject[i] = 0;
    islands(subject, w, h, 1, n * 0.004);
  }

  const layer = new Float32Array(n);
  if (depth && by === 'steps') {
    const span = Math.max(highest - firstStep, 1e-3);
    for (let i = 0; i < n; i++) if (subject[i]) layer[i] = Math.min(1, Math.max(0, (depth[i] - firstStep) / span));
  } else if (depth) {
    // the sheets follow the depth: from the subject's farthest (but a few) to its nearest
    const held = (i: number) => subject[i] === 1;
    const farthest = percentile(depth, 0.05, held);
    const nearest = percentile(depth, 0.98, held);
    const span = Math.max(nearest - farthest, 1e-3);
    for (let i = 0; i < n; i++) if (subject[i]) layer[i] = Math.min(1, Math.max(0, (depth[i] - farthest) / span));
  } else {
    const inside = distance(subject, w, h);
    const detail = new Float32Array(labs[0]);
    const around = new Float32Array(labs[0]);
    blur(detail, w, h, 1.2);
    blur(around, w, h, 8);
    for (let i = 0; i < n; i++)
      if (subject[i]) {
        const lighter = detail[i] - around[i];
        layer[i] = Math.min(inside[i] / LAYER_SPAN, 1) + LAYER_LIGHT * Math.min(1, Math.max(-1, lighter / 20));
      }
  }
  blur(layer, w, h, 1.5);

  const shown = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      const i = (ART_BOX.y + y) * W + ART_BOX.x + x;
      parts[i] = subject[j] ? Part.Subject : Part.Back;
      layerOut[i] = subject[j] ? layer[j] : -1;
      shown[j] = pocket[j] ? 3 : subject[j] && !before[j] ? 2 : subject[j];
    }
  return shown;
}

/**
 * The level stars on a monster's frame, counted from the right: a slot holds a star when its
 * middle is the stars' orange (Spells, Traps, Xyz and Link monsters have none there).
 */
export function countStars(rgba: Uint8ClampedArray): number {
  let count = 0;
  for (let k = 0; k < STARS.max; k++) {
    const cx = Math.round(STARS.rightX - k * STARS.step);
    let r = 0;
    let g = 0;
    let b = 0;
    let m = 0;
    for (let y = STARS.y - 15; y < STARS.y + 15; y++)
      for (let x = cx - 15; x < cx + 15; x++) {
        const s = (y * W + x) * 4;
        r += rgba[s];
        g += rgba[s + 1];
        b += rgba[s + 2];
        m++;
      }
    if (Math.hypot(r / m - 234, g / m - 150, b / m - 10) > 30) break;
    count++;
  }
  return count;
}
