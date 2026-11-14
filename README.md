# Card Cutter

Upload a card scan and see it cut into a shadow box: thin sheets of card, each a copy of the
scan cut to a shape, stacked with small gaps. It all runs in the browser.

Live at <https://card-cutter.fourlastor.org>.

## How the cut is made

- **Frame.** Three games' modern frames, each with its parts at fixed places (`src/card.ts`),
  measured on a common scan size for it; any other size is stretched to that:
  - *Yu-Gi-Oh!* (YGOPRODeck's 813×1185): name box, attribute, level stars (found by their
    colour in each slot), art window, text box.
  - *Magic* (Scryfall's 744×1040, the frame since 2015): name bar, art window, type line,
    text box, and the P/T box where there is one (found by its colour over the black border).
  - *Pokémon* (pokemontcg.io's 734×1024, the Scarlet & Violet frame): name and HP, type
    symbol, art window, species strip, weakness strip.
  - *Pokémon, full art* (ex, V, illustration rares): the art fills the border; the name and
    HP above it and the weakness and rules below it stand solid from the frame's sheets to
    the top, like a frame round the recessed art.

  The game is guessed by where the card's art window is: each layout scores how sharp its
  window's four sides are, the weakest counting, and a clear winner is taken. Without a
  window (a full art, a custom frame) it goes by the card's border (Magic's black, Pokémon's
  silver or yellow) and, in scans only, its shape (Yu-Gi-Oh's cards are 59×86 mm, the
  others 63×88: a photo straightened at a slight angle can be off by as much). The Frame
  menu chooses it by hand.
- **Photos.** A card photographed on a table is found and straightened first
  (`src/find.ts`): each side is a line fitted to where the colour leaves the background's,
  walking in from the photo's edge, and the four lines' corners are mapped onto a flat card
  through the perspective. A scan already cut to the card is left alone: what that finds is
  the border's inner edge, whose corners are not rounded like a card's.
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
  text box (and the other games' bars) sit one sheet above the frame, the attribute (and
  Magic's P/T box) one more (`src/cut/sheets.ts`).
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
