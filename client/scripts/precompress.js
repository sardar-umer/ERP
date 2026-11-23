#!/usr/bin/env node
/**
 * Runs after `npm run build` (postbuild): writes a .gz copy next to every JS / CSS / JSON / SVG / HTML file
 * in build/. nginx (`gzip_static on`) then sends the ready .gz file instead of compressing the 11 MB main
 * bundle again on every request — compressing on the fly was the bottleneck on the production server.
 * Uses Node's built-in zlib only (no extra packages). Files under 1 KB are skipped.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const EXTENSIONS = new Set(['.js', '.css', '.json', '.svg', '.html', '.txt', '.map']);
const MIN_BYTES = 1024;

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

if (!fs.existsSync(BUILD_DIR)) {
  console.error(`precompress: ${BUILD_DIR} not found — run the build first`);
  process.exit(1);
}

let files = 0;
let before = 0;
let after = 0;
for (const file of walk(BUILD_DIR)) {
  if (!EXTENSIONS.has(path.extname(file))) continue;
  const data = fs.readFileSync(file);
  if (data.length < MIN_BYTES) continue;
  const gz = zlib.gzipSync(data, { level: zlib.constants.Z_BEST_COMPRESSION });
  fs.writeFileSync(`${file}.gz`, gz);
  // keep the same modified time so nginx serves matching ETags / Last-Modified for both copies
  const { atime, mtime } = fs.statSync(file);
  fs.utimesSync(`${file}.gz`, atime, mtime);
  files += 1;
  before += data.length;
  after += gz.length;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`precompress: ${files} files gzipped, ${mb(before)} → ${mb(after)}`);
