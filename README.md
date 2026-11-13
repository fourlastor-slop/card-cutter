# Card Cutter

Upload a card scan and see it cut into a shadow box: thin sheets of card, each a copy of the
scan cut to a shape, stacked with small gaps. It all runs in the browser.

Live at <https://card-cutter.fourlastor.org>.

## How the cut is made

- **Frame.** The parts of a modern TCG frame (name box, attribute, level stars, art window,
  text box) are at fixed places, measured on 813×1185 scans (`src/card.ts`). Any other size
  is stretched to that. Level stars are found by their colour in each slot.
- **Subject.** A minimum-barrier fill from the art window's edge, in L\*a\*b\*, with an Otsu
  threshold, finds what stands out from the background (`src/cut/relief.ts`).
- **Depth.** [Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small)
  (int8, 27 MB, Apache-2.0) runs with onnxruntime-web on WebAssembly in a worker
  (`src/depth.ts`). It is downloaded from Hugging Face on first use and kept in the
  browser's cache. Background walled in by the subject is found by colour and depth together.
- **Sheets.** The back is the whole card; the frame is five sheets with the window cut out;
  the subject is six sheets by depth, each part on one sheet only; the name box, stars and
  text box sit one sheet above the frame, the attribute one more (`src/cut/sheets.ts`).
  Ambient occlusion is baked per level from the sheets above.
- **Rendering.** three.js: banded light, a shadow map of the cut shapes, gloss from a few
  analytic soft boxes, paper grain, matte cut edges, and an optional holo foil
  (`src/render/`). The turn can be saved as a video with MediaRecorder.

## Development

```bash
npm install
npm run dev
```

In development the depth model is read from `reference/models/model_quantized.onnx` (not
in the repository); download it from the Hugging Face link above.

`?stack=nested` repeats every sheet under the nearer ones, and `?precision=fp32` uses the
full-precision model.

`npm test` runs the cut on a synthetic card; pushes to `main` deploy to Cloudflare.

## License

Apache-2.0. A fan-made toy, not affiliated with or endorsed by Konami.
