// The art's depth from Depth Anything V2 Small (onnx-community, Apache-2.0), run with
// onnxruntime-web on WebAssembly. Preprocessing as the model's preprocessor_config.json:
// 518x518, ImageNet mean/std; the output min-max normalised (near = 1).
//
// Why WebAssembly and the int8 model: measured on a GTX 1060 (Chromium), int8 takes ~0.7 s on
// WebAssembly (4 threads) but ~1.7 s on WebGPU; only the fp32 model is fast on WebGPU (~0.2 s),
// and it is a 99 MB download instead of 27 MB. The int8 model cuts practically like fp32.

import * as ort from 'onnxruntime-web/wasm';

export type Precision = 'q8' | 'fp32';

const SIZE = 518;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const FILES: Record<Precision, string> = { q8: 'model_quantized.onnx', fp32: 'model.onnx' };
const REMOTE = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/';
const CACHE = 'card-cutter-models-v1';

// (served as files of their own: vite.config.ts)
ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

export interface Progress {
  loaded: number;
  total: number;
}

/** The model's bytes: from the browser's cache, else downloaded (with progress) and cached. */
async function modelBytes(precision: Precision, onProgress: (p: Progress) => void): Promise<Uint8Array> {
  const url = (import.meta.env.DEV ? '/models/' : REMOTE) + FILES[precision];
  const cache = 'caches' in self ? await caches.open(CACHE).catch(() => null) : null;
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`The depth model could not be downloaded (${response.status}).`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  await cache?.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => undefined);
  return bytes;
}

let session: { precision: Precision; session: ort.InferenceSession } | null = null;

async function open(precision: Precision, onProgress: (p: Progress) => void) {
  if (session?.precision === precision) return session.session;
  const bytes = await modelBytes(precision, onProgress);
  const created = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  session = { precision, session: created };
  return created;
}

export interface DepthResult {
  /** Nearness 0-1 at the art's size, row by row. */
  depth: Float32Array;
  /** How long the model took to run, in milliseconds. */
  ms: number;
}

/** The depth of `art` (the scan's art box, RGBA), at its own size. */
export async function depthOf(art: ImageData, precision: Precision, onProgress: (p: Progress) => void): Promise<DepthResult> {
  const opened = await open(precision, onProgress);
  const input = toTensor(art);
  const started = performance.now();
  const output = await opened.run({ [opened.inputNames[0]]: input });
  const ms = performance.now() - started;
  const raw = output[opened.outputNames[0]];
  const data = raw.data as Float32Array;
  return { depth: resize(normalise(data), SIZE, SIZE, art.width, art.height), ms };
}

function toTensor(art: ImageData): ort.Tensor {
  const source = new OffscreenCanvas(art.width, art.height);
  source.getContext('2d')!.putImageData(art, 0, 0);
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, SIZE, SIZE);
  const pixels = context.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE;
  const data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) data[c * n + i] = (pixels[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  return new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]);
}

function normalise(v: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of v) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  const span = Math.max(hi - lo, 1e-6);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] - lo) / span;
  return out;
}

/** Bilinear, pixel middles lined up. */
function resize(v: Float32Array, w: number, h: number, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / th - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / tw - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const a = v[y0 * w + x0] + (v[y0 * w + x1] - v[y0 * w + x0]) * fx;
      const b = v[y1 * w + x0] + (v[y1 * w + x1] - v[y1 * w + x0]) * fx;
      out[y * tw + x] = a + (b - a) * fy;
    }
  }
  return out;
}
