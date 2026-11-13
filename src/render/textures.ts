import * as THREE from 'three';

/**
 * Paper's grain: a tiling noise (bumps about 0.3 mm across when it covers 12 mm), its slope as
 * a normal map (x right, y up, in rgb) and its height (in alpha).
 */
export function paperGrain(): THREE.DataTexture {
  const size = 512;
  const height = new Float32Array(size * size);
  const octaves = [
    { period: 40, amp: 1 },
    { period: 80, amp: 0.5 },
    { period: 160, amp: 0.25 },
  ];
  for (const { period, amp } of octaves) {
    const noise = periodicNoise(period, 11 + period);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) height[y * size + x] += amp * noise((x / size) * period, (y / size) * period);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of height) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let i = 0; i < height.length; i++) height[i] = (height[i] - lo) / (hi - lo);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  const steepness = 6;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // (the image's rows run down, the normal's y up)
      let nx = (at(x - 1, y) - at(x + 1, y)) * steepness;
      let ny = (at(x, y + 1) - at(x, y - 1)) * steepness;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      bytes[i] = Math.round((nx * 0.5 + 0.5) * 255);
      bytes[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      bytes[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      bytes[i + 3] = Math.round(height[y * size + x] * 255);
    }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** Gradient noise that repeats every `period` cells, about -1 to 1. */
function periodicNoise(period: number, seed: number) {
  const angles = new Float32Array(period * period);
  let s = seed;
  for (let i = 0; i < angles.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    angles[i] = (s / 4294967296) * Math.PI * 2;
  }
  const grad = (ix: number, iy: number, dx: number, dy: number) => {
    const a = angles[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)];
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fade(fx);
    const v = fade(fy);
    const a = grad(ix, iy, fx, fy) + (grad(ix + 1, iy, fx - 1, fy) - grad(ix, iy, fx, fy)) * u;
    const b = grad(ix, iy + 1, fx, fy - 1) + (grad(ix + 1, iy + 1, fx - 1, fy - 1) - grad(ix, iy + 1, fx, fy - 1)) * u;
    return (a + (b - a) * v) * 1.4;
  };
}

/** The card's back: an original pattern, drawn here (not any real card game's back). */
export function cardBack(): THREE.CanvasTexture {
  const w = 600;
  const h = Math.round((w * 86) / 59);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const bg = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, h * 0.7);
  bg.addColorStop(0, '#2a3550');
  bg.addColorStop(1, '#0b0f1a');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c9a75a';
  g.lineWidth = 6;
  g.strokeRect(24, 24, w - 48, h - 48);
  g.lineWidth = 2;
  g.strokeRect(38, 38, w - 76, h - 76);
  g.save();
  g.translate(w / 2, h / 2);
  for (let ring = 0; ring < 7; ring++) {
    const r = 40 + ring * 30;
    g.beginPath();
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * Math.PI * 2 + (ring % 2) * (Math.PI / 12);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 1.25;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = `rgba(201, 167, 90, ${0.85 - ring * 0.1})`;
    g.lineWidth = ring === 0 ? 4 : 2;
    g.stroke();
  }
  g.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.anisotropy = 8;
  return texture;
}
