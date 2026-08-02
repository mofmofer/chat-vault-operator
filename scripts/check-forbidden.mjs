#!/usr/bin/env node
/**
 * Guards the "local-only, chatgpt.com-only" promise made in docs/privacy-model.md.
 *
 * Recursively scans `extension/` and, when present, `dist/` for strings that
 * would indicate a network call, a credential/auth path, or an origin other
 * than chatgpt.com. This is a text scan, not a type-aware one, on purpose: it
 * should catch a forbidden API even if it is only ever referenced in a comment
 * or a string, because either one is a signal something does not belong here.
 *
 * IMPORTANT: this file's own source necessarily contains several of the
 * forbidden strings (as data, in FORBIDDEN_PATTERNS below). It must NEVER scan
 * `scripts/` — only `extension/` and `dist/` are walked. Do not widen the scan
 * roots without re-reading this comment.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Visible on purpose: a reviewer should be able to audit this whole list at a
// glance without reading the rest of the script.
const FORBIDDEN_PATTERNS = [
  'backend-api',
  'Bearer ',
  'Authorization',
  'chrome.webRequest',
  'chrome.identity',
  'chrome.cookies',
  'document.cookie',
  '<all_urls>',
  'XMLHttpRequest',
  'WebSocket',
  'sendBeacon',
  'eval(',
  'new Function(',
  'fetch(',
];

const SCAN_ROOTS = ['extension', 'dist'];

const ALLOWED_HOST = 'chatgpt.com';
/** Bare origin, exempted from the host check per spec (it's already allowed). */
const ALLOWED_ORIGIN_FRAGMENT = 'https://chatgpt.com';

const ABSOLUTE_URL_RE = /https?:\/\/[^\s"'`)<>]+/g;

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function collectFiles() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    if (!statSync(abs).isDirectory()) continue;
    walk(abs, files);
  }
  return files;
}

function checkLineForPatterns(line, violations, relPath, lineNo) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (line.includes(pattern)) {
      violations.push(`${relPath}:${lineNo}: ${pattern}`);
    }
  }
}

function checkLineForUrls(line, violations, relPath, lineNo) {
  const matches = line.match(ABSOLUTE_URL_RE);
  if (matches === null) return;

  for (const match of matches) {
    if (match === ALLOWED_ORIGIN_FRAGMENT || match.startsWith(`${ALLOWED_ORIGIN_FRAGMENT}/`)) {
      continue;
    }

    let host;
    try {
      host = new URL(match).hostname;
    } catch {
      // Not a parseable URL (e.g. trailing punctuation swept up by the regex);
      // still flag it, since it is unclear what it points at.
      violations.push(`${relPath}:${lineNo}: absolute-url:${match}`);
      continue;
    }

    if (host !== ALLOWED_HOST) {
      violations.push(`${relPath}:${lineNo}: absolute-url-non-chatgpt-host:${match}`);
    }
  }
}

function scanFile(abs, violations) {
  const relPath = relative(ROOT, abs).split('\\').join('/');
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    // Not a text file (e.g. binary asset) — nothing to scan.
    return;
  }
  if (text.includes('\u0000')) return; // binary heuristic

  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    checkLineForPatterns(line, violations, relPath, lineNo);
    checkLineForUrls(line, violations, relPath, lineNo);
  });
}

function main() {
  const files = collectFiles();
  const violations = [];

  for (const file of files) {
    scanFile(file, violations);
  }

  if (violations.length > 0) {
    console.error('[check-forbidden] violations found:');
    for (const v of violations) {
      console.error(`  ${v}`);
    }
    console.error(`[check-forbidden] FAILED: ${violations.length} violation(s).`);
    process.exit(1);
  }

  console.log(
    `[check-forbidden] OK: scanned ${files.length} file(s) under ${SCAN_ROOTS.join(', ')}; no forbidden patterns or non-chatgpt.com absolute URLs found.`,
  );
  process.exit(0);
}

main();
