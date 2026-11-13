import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Cross-origin isolation lets onnxruntime run on several threads (SharedArrayBuffer).
// "credentialless" keeps the model's download from Hugging Face working without that host
// sending a Cross-Origin-Resource-Policy header. public/_headers sets the same in production.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

/// onnxruntime's WebAssembly runtime, served as its own files at /ort/ (src/depth.ts points
/// it there). Bundled into our worker instead, its threads would start our worker script
/// rather than its own, and hang.
const ORT_FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
const ORT_DIR = resolve('node_modules/onnxruntime-web/dist');

/// In development the model comes from this machine (reference/models, git-ignored) instead
/// of Hugging Face, as the built site has it.
function localAssets(): Plugin {
  const roots: Record<string, string> = {
    '/models/': resolve('reference/models'),
    '/ort/': ORT_DIR,
  };
  const types: Record<string, string> = { mjs: 'text/javascript', wasm: 'application/wasm' };
  return {
    name: 'local-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const prefix = Object.keys(roots).find((p) => url.startsWith(p));
        if (!prefix) return next();
        const file = normalize(join(roots[prefix], url.slice(prefix.length)));
        if (!file.startsWith(roots[prefix])) return next();
        try {
          const size = statSync(file).size;
          const type = types[file.split('.').pop() ?? ''] ?? 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, ...isolation });
          createReadStream(file).pipe(res);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const name of ORT_FILES) this.emitFile({ type: 'asset', fileName: `ort/${name}`, source: readFileSync(join(ORT_DIR, name)) });
    },
  };
}

export default defineConfig({
  plugins: [localAssets()],
  resolve: {
    // onnxruntime-web's builds that load their runtime from env.wasm.wasmPaths
    conditions: ['onnxruntime-web-use-extern-wasm'],
  },
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
  test: { include: ['tests/**/*.test.ts'] },
});
