import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/chat-vault-operator.js', import.meta.url), 'utf8');
const bookmarklet = (await readFile(new URL('../dist/bookmarklet.txt', import.meta.url), 'utf8')).trim();

test('source is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(source));
});

test('bookmarklet decodes to syntactically valid JavaScript', () => {
  assert.ok(bookmarklet.startsWith('javascript:'));
  const decoded = decodeURIComponent(bookmarklet.slice('javascript:'.length));
  assert.doesNotThrow(() => new vm.Script(decoded));
});

test('archive-only safety guard is present', () => {
  assert.match(source, /is_archived:\s*true/);
  assert.doesNotMatch(source, /is_visible:\s*false/);
  assert.doesNotMatch(source, /method:\s*['"]DELETE['"]/);
});

test('no external network destination is embedded', () => {
  const externalUrls = source.match(/https?:\/\/[^'"`\s)]+/g) || [];
  assert.deepEqual(externalUrls, []);
});

test('bookmarklet remains within a practical mobile bookmark size', () => {
  assert.ok(bookmarklet.length < 100000, `bookmarklet too large: ${bookmarklet.length}`);
});
