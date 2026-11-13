import './style.css';
import { CARD_MM, H, W } from './card';
import type { Stack } from './cut/sheets';
import type { Precision } from './depth';
import { CardView, FINISHES, TURN, type Finish } from './render/view';
import { canMakeVideo, makeVideo } from './video';
import type { CutMessage, CutRequest, CutResult } from './worker';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const stage = $('stage');
const drop = $('drop');
const file = $<HTMLInputElement>('file');
const busy = $('busy');
const busyText = $('busy-text');
const bar = $('bar');
const status = $('status');
const facts = $('facts');
const playButton = $<HTMLButtonElement>('play');
const videoButton = $<HTMLButtonElement>('video');

// ?precision=q8|fp32, ?stack=single|nested: for trying things out
const params = new URLSearchParams(location.search);
const option = <T extends string>(name: string, allowed: readonly T[]) => {
  const v = params.get(name) as T | null;
  return v && allowed.includes(v) ? v : undefined;
};
const precision = option<Precision>('precision', ['q8', 'fp32']);
const stack = option<Stack>('stack', ['single', 'nested']);

let view: CardView;
try {
  view = new CardView(canvas);
} catch {
  status.textContent = 'This browser cannot show 3D (WebGL 2 is needed).';
  status.classList.add('error');
  throw new Error('no WebGL');
}

// the drawing buffer follows the canvas's size on the page
let recording = false;
const resize = () => {
  if (recording) return;
  const { width, height } = canvas.getBoundingClientRect();
  if (width > 0 && height > 0) view.setSize(width, height, Math.min(devicePixelRatio, 2));
};
new ResizeObserver(resize).observe(canvas);
resize();

// the turn: a figure of eight, or where the card was dragged to
let playing = true;
let clock = 0;
let last = performance.now();
let dragged: { yaw: number; pitch: number } | null = null;
const turn = (t: number) => ({
  yaw: TURN.yaw * Math.sin((2 * Math.PI * t) / TURN.seconds),
  pitch: TURN.pitch * Math.sin((4 * Math.PI * t) / TURN.seconds),
});

const loop = (now: number) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!recording) {
    if (playing && !dragged) clock += dt;
    const pose = dragged ?? turn(clock);
    view.pose(pose.yaw, pose.pitch);
    if (view.hasCard) view.render();
  }
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

let pointer: { id: number; x: number; y: number; yaw: number; pitch: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!view.hasCard || recording) return;
  const from = dragged ?? turn(clock);
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, ...from };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointer || e.pointerId !== pointer.id) return;
  const scale = 120 / canvas.clientWidth;
  dragged = {
    yaw: Math.max(-70, Math.min(70, pointer.yaw + (e.clientX - pointer.x) * scale)),
    pitch: Math.max(-45, Math.min(45, pointer.pitch + (e.clientY - pointer.y) * scale)),
  };
});
const release = (e: PointerEvent) => {
  if (!pointer || e.pointerId !== pointer.id) return;
  pointer = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('dblclick', () => {
  dragged = null;
  setPlaying(true);
});

if (import.meta.env.DEV)
  Object.assign(window, {
    debugPose: (yaw: number, pitch: number) => {
      dragged = { yaw, pitch };
      setPlaying(false);
    },
  });

const finish = $<HTMLSelectElement>('finish');
const applyFinish = () => {
  if ((FINISHES as readonly string[]).includes(finish.value)) view.setFinish(finish.value as Finish);
};
finish.addEventListener('change', applyFinish);
applyFinish();

const setPlaying = (on: boolean) => {
  playing = on;
  if (on) dragged = null;
  playButton.textContent = on ? 'Pause' : 'Play';
};
playButton.addEventListener('click', () => setPlaying(!playing || dragged !== null));

// choosing a card: the button, the drop area, or dropping anywhere on the page
$('choose').addEventListener('click', () => file.click());
file.addEventListener('change', () => {
  if (file.files?.[0]) void cut(file.files[0]);
  file.value = '';
});
let depthOver = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  depthOver++;
  stage.classList.add('over');
});
window.addEventListener('dragleave', () => {
  depthOver = Math.max(0, depthOver - 1);
  if (depthOver === 0) stage.classList.remove('over');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  depthOver = 0;
  stage.classList.remove('over');
  const dropped = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (dropped) void cut(dropped);
});
window.addEventListener('paste', (e) => {
  const pasted = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (pasted) void cut(pasted);
});

let worker: Worker | null = null;
let working = false;

const setBusy = (text: string | null, share?: number) => {
  busy.hidden = text === null;
  if (text !== null) busyText.textContent = text;
  bar.style.width = share === undefined ? '100%' : `${Math.round(share * 100)}%`;
  bar.style.opacity = share === undefined ? '0.35' : '1';
};

const say = (text: string, error = false) => {
  status.textContent = text;
  status.classList.toggle('error', error);
};

async function cut(chosen: File): Promise<void> {
  if (working) return;
  working = true;
  playButton.disabled = videoButton.disabled = true;
  say('');
  try {
    const bitmap = await createImageBitmap(chosen).catch(() => {
      throw new Error('That file could not be read as an image.');
    });
    const aspect = bitmap.width / bitmap.height;
    const cardAspect = CARD_MM.x / CARD_MM.y;
    const skewed = Math.abs(aspect / cardAspect - 1) > 0.06;

    // the scan stretched to the size the frame was measured on, for the cut
    const small = document.createElement('canvas');
    small.width = W;
    small.height = H;
    const context = small.getContext('2d', { willReadFrequently: true })!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, W, H);
    const scan = context.getImageData(0, 0, W, H);
    // and as large as it came (within reason) for the print on the sheets
    const printHeight = Math.max(H, Math.min(bitmap.height, 2048));
    const print = document.createElement('canvas');
    print.height = printHeight;
    print.width = Math.round((printHeight * W) / H);
    const printContext = print.getContext('2d')!;
    printContext.imageSmoothingQuality = 'high';
    printContext.drawImage(bitmap, 0, 0, print.width, print.height);
    bitmap.close();

    setBusy('Finding the depth…');
    const result = await runCut({ scan, precision, stack });
    setBusy('Building the sheets…');
    await new Promise((r) => requestAnimationFrame(r));
    view.show({ sheets: result.sheets, occlusion: result.occlusion, scan: print });
    drop.hidden = true;
    clock = 0;
    setPlaying(true);
    playButton.disabled = false;
    videoButton.disabled = !canMakeVideo();
    if (!canMakeVideo()) videoButton.title = 'This browser cannot make videos.';
    showFacts(result);
    say(skewed ? "That image isn't card-shaped, so it was stretched to fit; the cut may be off." : 'Done. Drag to turn it, double-click to let it spin again.');
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  } finally {
    setBusy(null);
    working = false;
  }
}

function runCut(request: CutRequest): Promise<CutResult> {
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const active = worker;
  return new Promise((resolve, reject) => {
    active.onmessage = (event: MessageEvent<CutMessage>) => {
      const m = event.data;
      if (m.type === 'progress') {
        if (m.stage === 'model') {
          const mb = (n: number) => (n / 1e6).toFixed(1);
          setBusy(m.total ? `Downloading the depth model… ${mb(m.loaded)} / ${mb(m.total)} MB` : `Downloading the depth model… ${mb(m.loaded)} MB`, m.total ? m.loaded / m.total : undefined);
        } else setBusy(m.stage === 'depth' ? 'Finding the depth…' : 'Cutting the sheets…');
      } else if (m.type === 'done') resolve(m.result);
      else reject(new Error(m.message));
    };
    active.onerror = (e) => {
      worker = null;
      reject(new Error(e.message || 'The cutting worker failed.'));
    };
    active.postMessage(request, [request.scan.data.buffer]);
  });
}

function showFacts(result: CutResult) {
  const rows: [string, string][] = [
    ['Sheets', String(result.sheets.reduce((n, s) => n + s.levels.length, 0))],
    ['Level stars', result.stars ? String(result.stars) : 'none found'],
    ['Depth', `${Math.round(result.depthMs)} ms`],
    ['Cut', `${Math.round(result.cutMs)} ms`],
  ];
  facts.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  facts.hidden = false;
}

// the video: the turn once, at 1080x1350
videoButton.addEventListener('click', async () => {
  if (!view.hasCard || recording) return;
  recording = true;
  videoButton.disabled = playButton.disabled = true;
  view.setSize(1080, 1350, 1);
  setBusy('Making the video…', 0);
  try {
    const video = await makeVideo(
      canvas,
      { width: 1080, height: 1350, seconds: TURN.seconds, fps: 30 },
      (t) => {
        const pose = turn(t);
        view.pose(pose.yaw, pose.pitch);
        view.render();
      },
      (share) => setBusy('Making the video…', share),
    );
    const link = document.createElement('a');
    link.href = URL.createObjectURL(video);
    link.download = `card-cutter.${video.type.includes('mp4') ? 'mp4' : 'webm'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    say('Video saved.');
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  } finally {
    recording = false;
    setBusy(null);
    videoButton.disabled = playButton.disabled = false;
    resize();
  }
});
