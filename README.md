# Card Cutter

Upload a card scan and see it cut into a shadow box: thin sheets of card, each a copy of the
scan cut to a shape, stacked with small gaps. It all runs in the browser.

Live at <https://card-cutter.fourlastor.org>.

## How the cut is made

- **Frame.** The parts of a modern TCG frame (name box, attribute, level stars, art window,
  text box) are at fixed places, measured on 813×1185 scans (`src/card.ts`). Any other size
  is stretched to that. Level stars are found by their colour in each slot.
- **Subject.** Two ways, chosen in the page's Cut menu (`src/cut/relief.ts`):
  - *Colour + depth* (the default): a minimum-barrier fill from the art window's edge, in
    L\*a\*b\*, with an Otsu threshold, finds what stands out from the background by colour;
    whatever is clearly nearer than the background (by the depth) joins it, and background
    walled in by the subject is taken back by colour and depth together.
  - *Depth steps*: no colour at all; the art in seven equal steps of depth, the farthest left
    on the back. It catches dark parts that blend into a dark background, but cuts smooth
    backgrounds into terraces too.
- **Depth.** [Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small)
  (int8, 27 MB, Apache-2.0) runs with onnxruntime-web on WebAssembly in a worker
  (`src/depth.ts`). It is downloaded from Hugging Face on first use and kept in the
  browser's cache. - **Sheets.** The back is the whole card; the frame is five sheets with the window cut out;
  the subject is six sheets by depth, each part on one sheet only; the name box, stars and
  text box sit one sheet above the frame, the attribute one more (`src/cut/sheets.ts`).
  Ambient occlusion is baked per level from the sheets above.
- **Rendering.** three.js: banded light, a shadow map of the cut shapes, gloss from a few
  analytic soft boxes, paper grain, matte cut edges, and an optional holo foil
  (`src/render/`).
- **Video.** The turn is drawn frame by frame and encoded to an H.264 MP4 with WebCodecs
  ([mediabunny](https://mediabunny.dev) packs it), in Chromium and Firefox alike
  (`src/video.ts`). Browsers without WebCodecs fall back to recording the canvas in real time.

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
