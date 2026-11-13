// The cut, off the page's thread: the depth model, then the frame's parts and the art's
// subject, then the sheets and their ambient occlusion.

import { ART_BOX, H, W } from './card';
import { countStars, relief } from './cut/relief';
import { occlusion, sheets, type Sheet, type Stack } from './cut/sheets';
import { depthOf, type Precision } from './depth';

export interface CutRequest {
  /** The scan at 813x1185. */
  scan: ImageData;
  precision?: Precision;
  stack?: Stack;
}

export type CutMessage =
  | { type: 'progress'; stage: 'model'; loaded: number; total: number }
  | { type: 'progress'; stage: 'depth' | 'cut' }
  | { type: 'done'; result: CutResult }
  | { type: 'error'; message: string };

export interface CutResult {
  sheets: Sheet[];
  /** Ambient occlusion per level (sheets.ts AO_W x AO_H). */
  occlusion: Uint8Array[];
  stars: number;
  depthMs: number;
  cutMs: number;
  /** The art's depth (0-255, the art box's size), for looking at. */
  depth: Uint8Array;
}

const post = (message: CutMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<CutRequest>) => {
  try {
    const { scan, precision = 'q8', stack = 'single' } = event.data;
    if (scan.width !== W || scan.height !== H) throw new Error(`The scan must be ${W}x${H}.`);
    const art = new ImageData(ART_BOX.w, ART_BOX.h);
    for (let y = 0; y < ART_BOX.h; y++) {
      const from = ((ART_BOX.y + y) * W + ART_BOX.x) * 4;
      art.data.set(scan.data.subarray(from, from + ART_BOX.w * 4), y * ART_BOX.w * 4);
    }
    post({ type: 'progress', stage: 'depth' });
    const depth = await depthOf(art, precision, ({ loaded, total }) => post({ type: 'progress', stage: 'model', loaded, total }));
    post({ type: 'progress', stage: 'cut' });
    const started = performance.now();
    const stars = countStars(scan.data);
    const map = relief(scan.data, stars, depth.depth);
    const list = sheets(map, stack);
    const ao = occlusion(list);
    const cutMs = performance.now() - started;
    const depthBytes = Uint8Array.from(depth.depth, (v) => Math.round(v * 255));
    const result: CutResult = { sheets: list, occlusion: ao, stars, depthMs: depth.ms, cutMs, depth: depthBytes };
    post({ type: 'done', result }, [
      ...list.flatMap((s) => [s.mask.buffer, s.edges.buffer]),
      ...ao.map((a) => a.buffer),
      depthBytes.buffer,
    ]);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
