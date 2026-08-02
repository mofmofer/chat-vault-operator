import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const manifestPath = path.join(repoRoot, 'extension', 'manifest.json');

interface Manifest {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
}

const ALLOWED_PERMISSIONS = ['storage', 'sidePanel', 'activeTab', 'scripting'];

/**
 * Capability strings this local-only extension must never request. Checked as
 * a raw case-insensitive substring scan of the manifest file text, on top of
 * the structured `permissions` check below.
 */
const FORBIDDEN_STRINGS = [
  '<all_urls>',
  'webRequest',
  'cookies',
  'identity',
  'declarativeNetRequest',
  'tabs',
  'history',
  'downloads',
];

describe('extension/manifest.json', () => {
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as Manifest;

  it('declares manifest_version 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('only requests permissions within the allowlist', () => {
    expect(manifest.permissions).toBeDefined();
    for (const permission of manifest.permissions ?? []) {
      expect(ALLOWED_PERMISSIONS).toContain(permission);
    }
  });

  it('host_permissions is exactly [https://chatgpt.com/*]', () => {
    expect(manifest.host_permissions).toEqual(['https://chatgpt.com/*']);
  });

  it('contains none of the forbidden capability strings', () => {
    const lower = raw.toLowerCase();
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(lower.includes(forbidden.toLowerCase()), `manifest.json contains "${forbidden}"`).toBe(false);
    }
  });
});
