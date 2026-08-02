import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Static source-tree guard. Walks every file under `extension/` (never
 * `tests/`, to avoid self-matching on the string constants below) and asserts
 * the extension makes no network calls, requests no forbidden Chrome APIs,
 * and references no absolute URL outside chatgpt.com.
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const extensionDir = path.join(repoRoot, 'extension');

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (stat.isFile()) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(extensionDir);

const FORBIDDEN_SUBSTRINGS = [
  'backend-api',
  'Bearer ',
  'chrome.webRequest',
  'chrome.identity',
  'chrome.cookies',
  '<all_urls>',
  'XMLHttpRequest',
  'eval(',
  'new Function(',
];

const ALLOWED_URL_PREFIX = 'https://chatgpt.com';
/** Matches an absolute http(s) URL literal, stopping at quotes/whitespace/brackets. */
const URL_LITERAL_RE = /https?:\/\/[^\s"'`)<>]+/g;

describe('forbidden strings under extension/', () => {
  it('found source files to scan (sanity check on the walk itself)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains none of the forbidden capability / exfiltration strings', () => {
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        expect(content.includes(forbidden), `${file} contains forbidden string "${forbidden}"`).toBe(false);
      }
    }
  });

  it('makes no fetch / WebSocket / sendBeacon calls (no external communication)', () => {
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content.includes('fetch('), `${file} calls fetch(`).toBe(false);
      expect(content.includes('WebSocket'), `${file} references WebSocket`).toBe(false);
      expect(content.includes('navigator.sendBeacon'), `${file} calls navigator.sendBeacon`).toBe(false);
    }
  });

  it('references no absolute URL other than https://chatgpt.com', () => {
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const matches = content.match(URL_LITERAL_RE) ?? [];
      for (const match of matches) {
        expect(
          match.startsWith(ALLOWED_URL_PREFIX),
          `${file} references disallowed absolute URL "${match}"`,
        ).toBe(true);
      }
    }
  });

  it('has no Authorization header handling', () => {
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(
        content.toLowerCase().includes('authorization'),
        `${file} handles an Authorization header`,
      ).toBe(false);
    }
  });
});
