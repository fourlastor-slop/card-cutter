// The cut, off the page's thread: the depth model, then the frame's parts and the art's
// subject, then the sheets and their ambient occlusion.

import { type Game, LAYOUTS } from './card';
import { countStars, relief, type SubjectBy } from './cut/relief';
import { occlusion, sheets, type Sheet, type Stack } from './cut/sheets';
import { depthOf, type Precision } from './depth';

export interface CutRequest {
  /** The game whose frame the scan has, and the scan at that layout's size. */
  game: Game;
  scan: ImageData;
  precision?: Precision;
  stack?: Stack;
  subject?: SubjectBy;
}

export type CutMessage =
  | { type: 'progress'; stage: 'model'; loaded: number; total: number }
  | { type: 'progress'; stage: 'depth' | 'cut' }
  | { type: 'done'; result: CutResult }
  | { type: 'error'; message: string };

export interface CutResult {
  sheets: Sheet[];
  /** Ambient occlusion per level (sheets.ts aoSize). */
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
    const { game, scan, precision = 'q8', stack = 'single', subject = 'depth' } = event.data;
    const layout = LAYOUTS[game];
    const { w: W, h: H, art: box } = layout;
    if (scan.width !== W || scan.height !== H) throw new Error(`The scan must be ${W}x${H}.`);
    const art = new ImageData(box.w, box.h);
    for (let y = 0; y < box.h; y++) {
      const from = ((box.y + y) * W + box.x) * 4;
      art.data.set(scan.data.subarray(from, from + box.w * 4), y * box.w * 4);
    }
    post({ type: 'progress', stage: 'depth' });
    const depth = await depthOf(art, precision, ({ loaded, total }) => post({ type: 'progress', stage: 'model', loaded, total }));
    post({ type: 'progress', stage: 'cut' });
    const started = performance.now();
    const stars = countStars(scan.data, layout);
    const map = relief(scan.data, layout, stars, depth.depth, subject);
    const list = sheets(map, stack);
    const ao = occlusion(list, layout);
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
