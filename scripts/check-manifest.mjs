#!/usr/bin/env node
/**
 * Enforces the permission boundary declared in docs/privacy-model.md against
 * the actual `extension/manifest.json`. This is a guard against scope creep:
 * if a future change widens what the extension can touch, this script should
 * be the thing that fails CI, not a docs review.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST_PATH = join(ROOT, 'extension', 'manifest.json');

const ALLOWED_PERMISSIONS = ['storage', 'sidePanel', 'activeTab', 'scripting'];
const EXPECTED_HOST_PERMISSIONS = ['https://chatgpt.com/*'];
const ALLOWED_CONTENT_SCRIPT_MATCH = 'https://chatgpt.com/*';

const results = [];

function check(name, passed, detail) {
  results.push({ name, passed, detail });
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`[check-manifest] ERROR: manifest not found at extension/manifest.json`);
    process.exit(1);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(
      `[check-manifest] ERROR: manifest is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }
}

/** True when `pattern` grants access no broader than exactly chatgpt.com. */
function isChatgptOnlyMatch(pattern) {
  return pattern === ALLOWED_CONTENT_SCRIPT_MATCH;
}

function containsAllUrls(value, path, hits) {
  if (typeof value === 'string') {
    if (value === '<all_urls>') hits.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => containsAllUrls(item, `${path}[${i}]`, hits));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      containsAllUrls(item, `${path}.${key}`, hits);
    }
  }
}

function main() {
  const manifest = loadManifest();

  // manifest_version === 3
  check(
    'manifest_version === 3',
    manifest.manifest_version === 3,
    `got ${JSON.stringify(manifest.manifest_version)}`,
  );

  // permissions allowlist
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const badPermissions = permissions.filter((p) => !ALLOWED_PERMISSIONS.includes(p));
  check(
    `permissions ⊆ [${ALLOWED_PERMISSIONS.join(', ')}]`,
    Array.isArray(manifest.permissions) && badPermissions.length === 0,
    Array.isArray(manifest.permissions)
      ? badPermissions.length > 0
        ? `disallowed: ${badPermissions.join(', ')}`
        : `got [${permissions.join(', ')}]`
      : 'permissions field is missing or not an array',
  );

  // host_permissions exactly
  const hostPermissions = manifest.host_permissions;
  const hostPermissionsOk =
    Array.isArray(hostPermissions) &&
    hostPermissions.length === EXPECTED_HOST_PERMISSIONS.length &&
    hostPermissions.every((v, i) => v === EXPECTED_HOST_PERMISSIONS[i]);
  check(
    `host_permissions === ${JSON.stringify(EXPECTED_HOST_PERMISSIONS)}`,
    hostPermissionsOk,
    `got ${JSON.stringify(hostPermissions)}`,
  );

  // <all_urls> nowhere in the manifest
  const allUrlsHits = [];
  containsAllUrls(manifest, '$', allUrlsHits);
  check(
    'no <all_urls> anywhere in manifest',
    allUrlsHits.length === 0,
    allUrlsHits.length > 0 ? `found at: ${allUrlsHits.join(', ')}` : 'not present',
  );

  // content_scripts: none, or none broader than chatgpt.com
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const broadMatches = [];
  for (const entry of contentScripts) {
    const matches = Array.isArray(entry.matches) ? entry.matches : [];
    for (const m of matches) {
      if (!isChatgptOnlyMatch(m)) broadMatches.push(m);
    }
  }
  check(
    'content_scripts declares nothing broader than https://chatgpt.com/*',
    broadMatches.length === 0,
    contentScripts.length === 0
      ? 'no content_scripts declared (reader is injected on demand)'
      : broadMatches.length > 0
        ? `broader matches: ${broadMatches.join(', ')}`
        : 'all matches scoped to https://chatgpt.com/*',
  );

  // no externally_connectable
  check(
    'no externally_connectable',
    manifest.externally_connectable === undefined,
    manifest.externally_connectable === undefined ? 'not present' : 'present',
  );

  // no web_accessible_resources with <all_urls>
  const war = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources
    : [];
  const warAllUrlsHits = [];
  for (const [i, entry] of war.entries()) {
    const matches = Array.isArray(entry.matches) ? entry.matches : [];
    if (matches.includes('<all_urls>')) warAllUrlsHits.push(`web_accessible_resources[${i}]`);
  }
  check(
    'no web_accessible_resources with <all_urls>',
    warAllUrlsHits.length === 0,
    war.length === 0
      ? 'no web_accessible_resources declared'
      : warAllUrlsHits.length > 0
        ? `found at: ${warAllUrlsHits.join(', ')}`
        : 'no <all_urls> matches',
  );

  console.log('[check-manifest] results:');
  let failed = 0;
  for (const r of results) {
    const mark = r.passed ? 'PASS' : 'FAIL';
    if (!r.passed) failed += 1;
    console.log(`  [${mark}] ${r.name} — ${r.detail}`);
  }

  if (failed > 0) {
    console.error(`[check-manifest] FAILED: ${failed} check(s) failed.`);
    process.exit(1);
  }

  console.log(`[check-manifest] OK: all ${results.length} checks passed.`);
  process.exit(0);
}

main();
