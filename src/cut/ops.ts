// Image operations the cut is made of, on flat typed arrays (row by row, w x h).

const LINEAR = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    table[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return table;
})();

/** CIE L*a*b* (D65) of an sRGB colour, into out[0..2]. */
export function lab(r8: number, g8: number, b8: number, out: Float32Array | number[]): void {
  const r = LINEAR[r8];
  const g = LINEAR[g8];
  const b = LINEAR[b8];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
}

/**
 * The minimum barrier distance from the edge (within two pixels of it), added to `sum`: for
 * each pixel, over every path to it from the edge, the least range (highest less lowest) of
 * the channel along the path. Raster scans, forward and back, twice.
 */
export function barrier(channel: Float32Array, w: number, h: number, sum: Float32Array): void {
  const n = w * h;
  const distance = new Float32Array(n);
  const high = new Float32Array(channel);
  const low = new Float32Array(channel);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      distance[y * w + x] = edge ? 0 : Infinity;
    }
  const relax = (p: number, q: number) => {
    const dq = distance[q];
    if (dq === Infinity) return;
    const c = channel[p];
    const hi = high[q] > c ? high[q] : c;
    const lo = low[q] < c ? low[q] : c;
    if (hi - lo >= distance[p]) return;
    distance[p] = hi - lo;
    high[p] = hi;
    low[p] = lo;
  };
  for (let pass = 0; pass < 4; pass++) {
    const forward = pass % 2 === 0;
    for (let yy = 0; yy < h; yy++) {
      const y = forward ? yy : h - 1 - yy;
      for (let xx = 0; xx < w; xx++) {
        const x = forward ? xx : w - 1 - xx;
        const i = y * w + x;
        const qx = forward ? x - 1 : x + 1;
        const qy = forward ? y - 1 : y + 1;
        if (qx >= 0 && qx < w) relax(i, y * w + qx);
        if (qy >= 0 && qy < h) relax(i, qy * w + x);
      }
    }
  }
  for (let i = 0; i < n; i++) sum[i] += distance[i];
}

/** The value at a share (0-1) of the way up the sorted values that pass `take`; 0 if none. */
export function percentile(values: Float32Array, share: number, take?: (i: number) => boolean): number {
  let kept: Float32Array;
  if (take) {
    const list: number[] = [];
    for (let i = 0; i < values.length; i++) if (take(i)) list.push(values[i]);
    kept = Float32Array.from(list);
  } else kept = new Float32Array(values);
  if (kept.length === 0) return 0;
  kept.sort();
  return kept[Math.floor((kept.length - 1) * share)];
}

/** Otsu's threshold of values in 0-1: the one that best splits them in two. */
export function otsu(values: Float32Array): number {
  const bins = new Float64Array(256);
  for (const v of values) bins[Math.min(255, Math.max(0, Math.floor(v * 255)))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * bins[i];
  let below = 0;
  let sumBelow = 0;
  let best = -1;
  let split = 128;
  for (let i = 0; i < 256; i++) {
    below += bins[i];
    if (below === 0 || below === total) continue;
    sumBelow += i * bins[i];
    const above = total - below;
    const d = sumBelow / below - (sumAll - sumBelow) / above;
    const between = below * above * d * d;
    if (between > best) {
      best = between;
      split = i;
    }
  }
  // (in float32, as the values are: a value on the split's bin then stays below it)
  return Math.fround((split + 0.5) / 255);
}

/** A Gaussian blur, rows then columns (the edge repeated past the end), in place. */
export function blur(v: Float32Array, w: number, h: number, sigma: number): void {
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k++) total += kernel[k + radius] = Math.exp((-k * k) / (2 * sigma * sigma));
  for (let k = 0; k < kernel.length; k++) kernel[k] /= total;
  const line = new Float32Array(Math.max(w, h));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) line[x] = v[row + x];
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k < 0 ? 0 : x + k > w - 1 ? w - 1 : x + k;
        s += kernel[k + radius] * line[xx];
      }
      v[row + x] = s;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) line[y] = v[y * w + x];
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k < 0 ? 0 : y + k > h - 1 ? h - 1 : y + k;
        s += kernel[k + radius] * line[yy];
      }
      v[y * w + x] = s;
    }
  }
}

/**
 * A fast approximate Gaussian blur of a large sigma: three box blurs (sliding sums), rows
 * then columns, the edge repeated. In place.
 */
export function boxBlur(v: Float32Array, w: number, h: number, sigma: number): void {
  // box widths whose three passes match the Gaussian's variance
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  const tmp = new Float32Array(Math.max(w, h));
  for (let pass = 0; pass < 3; pass++) {
    const r = ((pass < m ? lower : upper) - 1) / 2;
    if (r < 1) continue;
    for (let y = 0; y < h; y++) slide(v, y * w, 1, w, r, tmp);
    for (let x = 0; x < w; x++) slide(v, x, w, h, r, tmp);
  }
}

function slide(v: Float32Array, start: number, stride: number, n: number, r: number, tmp: Float32Array): void {
  const at = (i: number) => v[start + (i < 0 ? 0 : i > n - 1 ? n - 1 : i) * stride];
  let s = 0;
  for (let k = -r; k <= r; k++) s += at(k);
  const scale = 1 / (2 * r + 1);
  for (let i = 0; i < n; i++) {
    tmp[i] = s * scale;
    s += at(i + r + 1) - at(i - r);
  }
  for (let i = 0; i < n; i++) v[start + i * stride] = tmp[i];
}

/** Grows the pixels that are `value` by a square of r pixels each way, in place. */
export function spread(mask: Uint8Array, w: number, h: number, r: number, value: 0 | 1): void {
  let copy = new Uint8Array(mask);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && copy[y * w + xx] === value) {
          mask[y * w + x] = value;
          break;
        }
      }
    }
  copy = new Uint8Array(mask);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h && copy[yy * w + x] === value) {
          mask[y * w + x] = value;
          break;
        }
      }
    }
}

export const dilate = (m: Uint8Array, w: number, h: number, r: number) => spread(m, w, h, r, 1);
export const erode = (m: Uint8Array, w: number, h: number, r: number) => spread(m, w, h, r, 0);

/**
 * Turns the patches of `value` smaller than `smallest` pixels to the other value; patches of
 * background (value 0) that touch the edge always stay.
 */
export function islands(mask: Uint8Array, w: number, h: number, value: 0 | 1, smallest: number): void {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const patch = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || mask[start] !== value) continue;
    let top = 0;
    let count = 0;
    let edge = false;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      patch[count++] = i;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0 && !seen[i - 1] && mask[i - 1] === value) (seen[i - 1] = 1), (stack[top++] = i - 1);
      if (x < w - 1 && !seen[i + 1] && mask[i + 1] === value) (seen[i + 1] = 1), (stack[top++] = i + 1);
      if (y > 0 && !seen[i - w] && mask[i - w] === value) (seen[i - w] = 1), (stack[top++] = i - w);
      if (y < h - 1 && !seen[i + w] && mask[i + w] === value) (seen[i + w] = 1), (stack[top++] = i + w);
    }
    if (count < smallest && (value === 1 || !edge)) {
      const other = value === 1 ? 0 : 1;
      for (let k = 0; k < count; k++) mask[patch[k]] = other;
    }
  }
}

/**
 * How far each pixel inside the mask is from the nearest pixel outside it (exact Euclidean,
 * Felzenszwalb and Huttenlocher's two passes); 0 outside.
 */
export function distance(inside: Uint8Array, w: number, h: number): Float32Array {
  const FAR = 1e20;
  const m = Math.max(w, h);
  const squared = new Float64Array(w * h);
  for (let i = 0; i < squared.length; i++) squared[i] = inside[i] ? FAR : 0;
  const f = new Float64Array(m);
  const d = new Float64Array(m);
  const v = new Int32Array(m);
  const z = new Float64Array(m + 1);
  const lower = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -FAR;
    z[1] = FAR;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = FAR;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = squared[y * w + x];
    lower(h);
    for (let y = 0; y < h; y++) squared[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = squared[y * w + x];
    lower(w);
    for (let x = 0; x < w; x++) squared[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(Math.min(squared[i], 1e12));
  return out;
}

/**
 * The main colours (L*a*b*) of the pixels that pass `take`: k-means from picks spread over
 * them, on at most about twenty thousand.
 */
export function palette(labs: Float32Array[], n: number, take: (i: number) => boolean, k: number): number[][] {
  const picked: number[][] = [];
  const step = Math.max(1, Math.floor(n / 20000));
  for (let i = 0; i < n; i += step) if (take(i)) picked.push([labs[0][i], labs[1][i], labs[2][i]]);
  if (picked.length === 0) return [];
  const centres = Array.from({ length: k }, (_, j) => [...picked[Math.floor((j * picked.length) / k)]]);
  const nearest = new Int32Array(picked.length);
  for (let round = 0; round < 12; round++) {
    for (let p = 0; p < picked.length; p++) {
      let best = Infinity;
      for (let j = 0; j < centres.length; j++) {
        const a = picked[p][0] - centres[j][0];
        const b = picked[p][1] - centres[j][1];
        const c = picked[p][2] - centres[j][2];
        const d = a * a + b * b + c * c;
        if (d < best) {
          best = d;
          nearest[p] = j;
        }
      }
    }
    for (let j = 0; j < centres.length; j++) {
      const sum = [0, 0, 0];
      let count = 0;
      for (let p = 0; p < picked.length; p++)
        if (nearest[p] === j) {
          sum[0] += picked[p][0];
          sum[1] += picked[p][1];
          sum[2] += picked[p][2];
          count++;
        }
      if (count > 0) centres[j] = [sum[0] / count, sum[1] / count, sum[2] / count];
    }
  }
  return centres;
}
