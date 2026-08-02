#!/usr/bin/env node
/**
 * Build script for chat-vault-operator.
 *
 * Produces an unpacked, loadable extension in `dist/`. Deliberately unminified
 * and without source maps: the shipped code must stay byte-for-byte readable so
 * anyone can audit exactly what runs against chatgpt.com without a decode step.
 *
 * Steps:
 *   1. Clean and recreate dist/.
 *   2. Bundle the three entrypoints with esbuild (ESM, chrome116 target).
 *   3. Copy static assets (manifest, side panel HTML/CSS).
 *   4. Print the resulting file list with sizes.
 *
 * Exits non-zero on any failure, including a missing input file, and names the
 * missing file explicitly so it's obvious what the concurrent work still owes.
 */

import { build } from 'esbuild';
import { existsSync, mkdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');

/** [entry point, output file relative to dist/] */
const ENTRYPOINTS = [
  ['extension/src/background/service-worker.ts', 'background/service-worker.js'],
  ['extension/src/sidepanel/main.ts', 'sidepanel/main.js'],
  ['extension/src/content/sidebar-reader.ts', 'content/sidebar-reader.js'],
];

/** [source relative to repo root, destination relative to dist/] */
const STATIC_COPIES = [
  ['extension/manifest.json', 'manifest.json'],
  ['extension/src/sidepanel/index.html', 'sidepanel/index.html'],
  ['extension/src/sidepanel/styles.css', 'sidepanel/styles.css'],
];

function fail(message) {
  console.error(`[build] ERROR: ${message}`);
  process.exit(1);
}

function requireFile(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    fail(`expected input file is missing: ${relPath}`);
  }
  return abs;
}

function cleanDist() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
}

function copyStatic(srcRel, destRel) {
  const src = requireFile(srcRel);
  const dest = join(DIST, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return dest;
}

async function bundleEntrypoint(entryRel, outRel) {
  const entry = requireFile(entryRel);
  const outfile = join(DIST, outRel);
  mkdirSync(dirname(outfile), { recursive: true });

  try {
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: 'esm',
      target: 'chrome116',
      sourcemap: false,
      // Intentionally not minified: this extension only talks to
      // chrome.storage.local and the user's own chatgpt.com tab, and keeping
      // the bundle readable is part of how that claim stays verifiable.
      minify: false,
      platform: 'browser',
      logLevel: 'silent',
    });
  } catch (e) {
    fail(`esbuild failed for ${entryRel}: ${e instanceof Error ? e.message : String(e)}`);
  }

  return outfile;
}

async function main() {
  console.log('[build] cleaning dist/');
  cleanDist();

  const outputs = [];

  console.log('[build] bundling entrypoints');
  for (const [entryRel, outRel] of ENTRYPOINTS) {
    const outfile = await bundleEntrypoint(entryRel, outRel);
    outputs.push(outfile);
  }

  console.log('[build] copying static assets');
  for (const [srcRel, destRel] of STATIC_COPIES) {
    outputs.push(copyStatic(srcRel, destRel));
  }

  console.log('[build] done. Output files:');
  const rows = outputs
    .map((abs) => {
      const size = statSync(abs).size;
      return { path: relative(DIST, abs).split('\\').join('/'), size };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const widest = Math.max(...rows.map((r) => r.path.length));
  for (const row of rows) {
    console.log(`  ${row.path.padEnd(widest + 2)} ${row.size.toLocaleString()} bytes`);
  }
}

main().catch((e) => {
  fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
});
