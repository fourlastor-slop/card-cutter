// The turn written to a video. Where the browser can encode H.264 (WebCodecs), every frame is
// drawn and encoded in turn into an MP4 (mediabunny packs it): the same file in every browser,
// and no frame dropped however slow the drawing. Otherwise the canvas is recorded in real time
// with MediaRecorder, in whatever format the browser has (MP4 or WebM).

import { BufferTarget, CanvasSource, canEncodeVideo, Mp4OutputFormat, Output, QUALITY_VERY_HIGH } from 'mediabunny';

export interface VideoOptions {
  width: number;
  height: number;
  seconds: number;
  fps: number;
}

const RECORDER_TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

const recorderType = () =>
  typeof MediaRecorder === 'undefined' ? null : (RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null);

/** Whether this browser can make a video of the turn at all. */
export function canMakeVideo(): boolean {
  return typeof VideoEncoder !== 'undefined' || recorderType() !== null;
}

/**
 * The turn as a video: `draw(t)` draws the frame at t seconds onto `canvas` (sized to the
 * options' width and height). Resolves to the video (its type tells MP4 from WebM).
 */
export async function makeVideo(
  canvas: HTMLCanvasElement,
  options: VideoOptions,
  draw: (t: number) => void,
  onProgress: (share: number) => void,
): Promise<Blob> {
  const { width, height } = options;
  const encodable = typeof VideoEncoder !== 'undefined' && (await canEncodeVideo('avc', { width, height, quality: QUALITY_VERY_HIGH }).catch(() => false));
  return encodable ? encodeMp4(canvas, options, draw, onProgress) : recordRealTime(canvas, options, draw, onProgress);
}

async function encodeMp4(canvas: HTMLCanvasElement, options: VideoOptions, draw: (t: number) => void, onProgress: (share: number) => void): Promise<Blob> {
  const { width, height, seconds, fps } = options;
  // each frame copied out of the WebGL canvas right after it is drawn (its drawing buffer is
  // not kept past that)
  const frame = new OffscreenCanvas(width, height);
  const context = frame.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new CanvasSource(frame, { codec: 'avc', quality: QUALITY_VERY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    draw(t);
    context.drawImage(canvas, 0, 0, width, height);
    await source.add(t, 1 / fps);
    onProgress((i + 1) / frames);
    // (let the page show the progress)
    if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
  }
  await output.finalize();
  return new Blob([output.target.buffer!], { type: 'video/mp4' });
}

function recordRealTime(canvas: HTMLCanvasElement, options: VideoOptions, draw: (t: number) => void, onProgress: (share: number) => void): Promise<Blob> {
  const type = recorderType();
  if (!type) return Promise.reject(new Error('This browser cannot make videos.'));
  const { seconds, fps } = options;
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  return new Promise((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Recording failed.'));
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: type.split(';')[0] }));
    };
    draw(0);
    recorder.start();
    const started = performance.now();
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      if (t >= seconds) {
        draw(seconds);
        recorder.stop();
        return;
      }
      draw(t);
      onProgress(t / seconds);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
