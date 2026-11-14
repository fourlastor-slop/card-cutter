// A card in a photo: where its four sides are, against what it lies on, and the card cut out
// of the photo and straightened. Each side is a line fitted to where, walking in from the
// photo's edge, the colour first leaves the background's. A scan already cut to the card has
// a line of that kind too (the border's inner edge, which has square or barely rounded
// corners), so what is found only counts as a card if its corners are rounded like a card's:
// the background shows just inside each corner.

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A card's corners: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** How far a colour must be from the background's (RGB distance) to be the card's. */
const APART = 45;
/** Lines walked in from each side of the photo, over the middle of the side. */
const LINES = 48;
/** The share of lines that must fit a side's line. */
const FIT = 0.6;
/** Where a card's rounded corner shows the background (a share of its width in from both sides), and where its border is. */
const CORNER_PROBE = 0.008;
const OUTSIDE = 0.012;
const BORDER = { along: 0.08, in: 0.012 };

/** Finds a card in a photo, or null when there is none to find (or the image is the card already). */
export function findCard(image: Pixels): Quad | null {
  const { width: w, height: h } = image;
  const rgb = smooth(image);
  const at = (x: number, y: number): [number, number, number] => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(h - 1, Math.max(0, Math.round(y)));
    const i = (yi * w + xi) * 3;
    return [rgb[i], rgb[i + 1], rgb[i + 2]];
  };
  const apart = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // each side: (position along it, how far in) where the colour leaves the background's
  const side = (along: number, across: number, point: (t: number, d: number) => [number, number]) => {
    const found: [number, number][] = [];
    for (let k = 0; k < LINES; k++) {
      const t = along * (0.2 + (0.6 * k) / (LINES - 1));
      const back = [0, 1, 2].map((s) => at(...point(t, s)));
      const bg = [0, 1, 2].map((c) => (back[0][c] + back[1][c] + back[2][c]) / 3);
      for (let d = 3; d < across * 0.4; d++)
        if ([0, 1, 2].every((s) => apart(at(...point(t, d + s)), bg) > APART)) {
          // the edge where the colour is halfway from the background's to the card's
          const half = apart(at(...point(t, d + 3)), bg) / 2;
          let edge = d;
          while (edge > 3 && apart(at(...point(t, edge - 1)), bg) > half) edge--;
          found.push([t, edge - 0.5]);
          break;
        }
    }
    return fitLine(found);
  };
  const left = side(h, w, (t, d) => [d, t]);
  const right = side(h, w, (t, d) => [w - 1 - d, t]);
  const top = side(w, h, (t, d) => [t, d]);
  const bottom = side(w, h, (t, d) => [t, h - 1 - d]);
  if (!left || !right || !top || !bottom) return null;

  // the sides as lines in the photo: x = a y + b (left and right), y = a x + b (top and bottom)
  const vertical = (l: Line, flip: boolean) => ({ a: flip ? -l.a : l.a, b: flip ? w - 1 - l.b : l.b });
  const horizontal = (l: Line, flip: boolean) => ({ a: flip ? -l.a : l.a, b: flip ? h - 1 - l.b : l.b });
  const L = vertical(left, false);
  const R = vertical(right, true);
  const T = horizontal(top, false);
  const B = horizontal(bottom, true);
  const meet = (v: Line, u: Line): Point => {
    // x = v.a y + v.b, y = u.a x + u.b
    const y = (u.a * v.b + u.b) / (1 - u.a * v.a);
    return { x: v.a * y + v.b, y };
  };
  const quad: Quad = [meet(L, T), meet(R, T), meet(R, B), meet(L, B)];

  // a card's shape, most of the photo, and not the photo itself
  const width = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const height = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  const aspect = width / height;
  if (!(aspect > 0.6 && aspect < 0.8) || width * height < w * h * 0.15) return null;
  const inset = (l: Line, along: number) => l.a * (along / 2) + l.b;
  const margin = Math.max(inset(left, h), inset(right, h), inset(top, w), inset(bottom, w));
  if (margin < Math.min(w, h) * 0.01) return null;

  // the rounded corners: just inside each, the background, not the border
  let rounded = 0;
  for (let k = 0; k < 4; k++) {
    const c = quad[k];
    const u = unit(c, quad[k % 2 === 0 ? k + 1 : k - 1]);
    const v = unit(c, quad[3 - k]);
    const step = (su: number, sv: number): Point => ({ x: c.x + (u.x * su + v.x * sv) * width, y: c.y + (u.y * su + v.y * sv) * width });
    const out = step(-OUTSIDE, -OUTSIDE);
    if (out.x < 0 || out.y < 0 || out.x > w - 1 || out.y > h - 1) continue;
    const probe = at(step(CORNER_PROBE, CORNER_PROBE).x, step(CORNER_PROBE, CORNER_PROBE).y);
    const outside = at(out.x, out.y);
    const border = [step(BORDER.along, BORDER.in), step(BORDER.in, BORDER.along)].map((p) => at(p.x, p.y));
    const near = Math.min(...border.map((b) => apart(probe, b)));
    if (apart(probe, outside) < near && Math.min(...border.map((b) => apart(outside, b))) > APART / 2) rounded++;
  }
  return rounded >= 3 ? quad : null;
}

interface Line {
  a: number;
  b: number;
}

/** A line d = a t + b through most of the points (least squares, dropping those far off it), or null. */
function fitLine(points: [number, number][]): Line | null {
  if (points.length < LINES * FIT) return null;
  let kept = points;
  let line: Line = { a: 0, b: 0 };
  for (let round = 0; round < 4; round++) {
    const n = kept.length;
    if (n < 2) return null;
    const mt = kept.reduce((s, p) => s + p[0], 0) / n;
    const md = kept.reduce((s, p) => s + p[1], 0) / n;
    let num = 0;
    let den = 0;
    for (const [t, d] of kept) {
      num += (t - mt) * (d - md);
      den += (t - mt) ** 2;
    }
    const a = den > 0 ? num / den : 0;
    line = { a, b: md - a * mt };
    const off = points.map(([t, d]) => Math.abs(d - (line.a * t + line.b)));
    const typical = [...off].sort((x, y) => x - y)[Math.floor(off.length / 2)];
    const limit = Math.max(1.5, 3 * typical);
    kept = points.filter((_, i) => off[i] <= limit);
  }
  return kept.length >= LINES * FIT ? line : null;
}

/** The image's colours, a little blurred (3x3), as RGB floats. */
function smooth({ data, width: w, height: h }: Pixels): Float32Array {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const s = (py * w + px) * 4;
          r += data[s];
          g += data[s + 1];
          b += data[s + 2];
          n++;
        }
      const i = (y * w + x) * 3;
      out[i] = r / n;
      out[i + 1] = g / n;
      out[i + 2] = b / n;
    }
  return out;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (from: Point, to: Point): Point => {
  const l = dist(from, to) || 1;
  return { x: (to.x - from.x) / l, y: (to.y - from.y) / l };
};

/** The card's size in the photo, in its pixels (the mean of its opposite sides). */
export function quadSize(quad: Quad): { width: number; height: number } {
  return {
    width: (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2,
    height: (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2,
  };
}

/** The card cut out of the photo and straightened (bilinear, through the perspective). */
export function straighten(image: Pixels, quad: Quad, width: number, height: number): Pixels {
  const [p0, p1, p2, p3] = quad;
  // the unit square to the quad (Heckbert's projective mapping)
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, k: number;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    [a, b, c, d, e, f, g, k] = [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0];
  } else {
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    k = (dx1 * sy - sx * dy1) / den;
    a = p1.x - p0.x + g * p1.x;
    b = p3.x - p0.x + k * p3.x;
    c = p0.x;
    d = p1.y - p0.y + g * p1.y;
    e = p3.y - p0.y + k * p3.y;
    f = p0.y;
  }
  const { data, width: w, height: h } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const u = (i + 0.5) / width;
      const v = (j + 0.5) / height;
      const z = g * u + k * v + 1;
      const x = Math.min(w - 1, Math.max(0, (a * u + b * v + c) / z - 0.5));
      const y = Math.min(h - 1, Math.max(0, (d * u + e * v + f) / z - 0.5));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;
      const o = (j * width + i) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const top = data[(y0 * w + x0) * 4 + ch] * (1 - fx) + data[(y0 * w + x1) * 4 + ch] * fx;
        const low = data[(y1 * w + x0) * 4 + ch] * (1 - fx) + data[(y1 * w + x1) * 4 + ch] * fx;
        out[o + ch] = top * (1 - fy) + low * fy;
      }
    }
  return { data: out, width, height };
}
