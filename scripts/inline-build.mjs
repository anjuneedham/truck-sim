// Post-build step: produce dist/truck-sim-standalone.html with all JS/CSS
// inlined. That single file can be opened directly, shared, or hosted anywhere
// (handy for quick phone testing without a dev server).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
let html = readFileSync(join(dist, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, file) => {
  const css = readFileSync(join(dist, file), 'utf8');
  return `<style>\n${css}\n</style>`;
});

html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, file) => {
  const js = readFileSync(join(dist, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});

// The manifest is optional for the standalone file.
html = html.replace(/<link rel="manifest"[^>]*>/, '');

writeFileSync(join(dist, 'truck-sim-standalone.html'), html);
console.log(`standalone build: dist/truck-sim-standalone.html (${(html.length / 1024).toFixed(0)} KB)`);
