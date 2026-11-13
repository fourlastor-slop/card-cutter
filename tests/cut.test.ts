import { describe, expect, it } from 'vitest';
import { ART_BOX, H, onCard, Part, STARS, W } from '../src/card';
import { distance, islands, otsu } from '../src/cut/ops';
import { countStars, relief } from '../src/cut/relief';
import { AO_H, AO_W, FRAME_SHEETS, occlusion, sheets, SUBJECT_SHEETS, TOP_LEVEL } from '../src/cut/sheets';

/** A synthetic scan: a flat frame colour, a dark art background with a light disc in it, and `stars` level stars. */
function scan(stars: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const cx = ART_BOX.x + ART_BOX.w / 2;
  const cy = ART_BOX.y + ART_BOX.h / 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let c = [200, 160, 90];
      const inArt = x >= ART_BOX.x && x < ART_BOX.x + ART_BOX.w && y >= ART_BOX.y && y < ART_BOX.y + ART_BOX.h;
      if (inArt) c = Math.hypot(x - cx, y - cy) < 180 ? [235, 235, 240] : [20, 30, 70];
      for (let k = 0; k < stars; k++) if (Math.hypot(x - (STARS.rightX - k * STARS.step), y - STARS.y) < STARS.r) c = [234, 150, 10];
      rgba.set([...c, 255], i);
    }
  return rgba;
}

/** A depth for the synthetic scan: the disc near, highest in its middle. */
function depth(): Float32Array {
  const d = new Float32Array(ART_BOX.w * ART_BOX.h);
  for (let y = 0; y < ART_BOX.h; y++)
    for (let x = 0; x < ART_BOX.w; x++) {
      const r = Math.hypot(x - ART_BOX.w / 2, y - ART_BOX.h / 2);
      d[y * ART_BOX.w + x] = r < 180 ? 0.4 + 0.6 * (1 - r / 180) : 0.1;
    }
  return d;
}

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
    expect(countStars(scan(0))).toBe(0);
    expect(countStars(scan(4))).toBe(4);
    expect(countStars(scan(12))).toBe(12);
  });

  it('finds the subject and cuts it into sheets by depth', () => {
    const map = relief(scan(4), 4, depth());
    const middle = (ART_BOX.y + ART_BOX.h / 2) * W + ART_BOX.x + ART_BOX.w / 2;
    expect(map.parts[middle]).toBe(Part.Subject);
    expect(map.parts[(ART_BOX.y + 10) * W + ART_BOX.x + 10]).toBe(Part.Back);
    expect(map.parts[STARS.y * W + STARS.rightX]).toBe(Part.Star);

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

    const ao = occlusion(list);
    expect(ao).toHaveLength(TOP_LEVEL + 1);
    expect(ao[0]).toHaveLength(AO_W * AO_H);
  });

  it('cuts by steps of depth alone', () => {
    const map = relief(scan(0), 0, depth(), 'steps');
    const middle = (ART_BOX.y + ART_BOX.h / 2) * W + ART_BOX.x + ART_BOX.w / 2;
    expect(map.parts[middle]).toBe(Part.Subject);
    expect(map.layer[middle]).toBeGreaterThan(0.9);
    expect(map.parts[(ART_BOX.y + 10) * W + ART_BOX.x + 10]).toBe(Part.Back);
  });

  it('rounds the card corners', () => {
    expect(onCard(0, 0)).toBe(false);
    expect(onCard(W / 2, H / 2)).toBe(true);
  });
});
