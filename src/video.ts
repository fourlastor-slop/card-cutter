// The turn written to a video: the canvas recorded while it draws the turn once, in real time.

const TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function videoType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/**
 * Records `canvas` for `seconds`, calling `frame(t)` to draw each frame at t seconds from the
 * start. Resolves to the video.
 */
export function record(canvas: HTMLCanvasElement, seconds: number, frame: (t: number) => void, onProgress: (share: number) => void): Promise<Blob> {
  const type = videoType();
  if (!type) return Promise.reject(new Error('This browser cannot record video.'));
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  return new Promise((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Recording failed.'));
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: type.split(';')[0] }));
    };
    frame(0);
    recorder.start();
    const started = performance.now();
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      if (t >= seconds) {
        frame(seconds);
        recorder.stop();
        return;
      }
      frame(t);
      onProgress(t / seconds);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
