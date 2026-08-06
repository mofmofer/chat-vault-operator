import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/chat-vault-operator.js', import.meta.url), 'utf8');
const miniSource = await readFile(new URL('../src/chat-vault-operator-mini.js', import.meta.url), 'utf8');
const bookmarklet = (await readFile(new URL('../dist/chat-vault-operator-bookmarklet.txt', import.meta.url), 'utf8')).trim();
const miniBookmarklet = (await readFile(new URL('../dist/chat-vault-operator-mini-bookmarklet.txt', import.meta.url), 'utf8')).trim();

for (const [name, code] of [['source', source], ['mini source', miniSource]]) {
  test(`${name} is syntactically valid JavaScript`, () => {
    assert.doesNotThrow(() => new vm.Script(code));
  });
}

test('encoded bookmarklet decodes to syntactically valid JavaScript', () => {
  assert.ok(bookmarklet.startsWith('javascript:'));
  const decoded = decodeURIComponent(bookmarklet.slice('javascript:'.length));
  assert.doesNotThrow(() => new vm.Script(decoded));
});

test('mini bookmarklet is syntactically valid JavaScript', () => {
  assert.ok(miniBookmarklet.startsWith('javascript:'));
  assert.doesNotThrow(() => new vm.Script(miniBookmarklet.slice('javascript:'.length)));
});

for (const [name, code] of [['source', source], ['mini source', miniSource]]) {
  test(`${name} contains archive-only safety guards`, () => {
    assert.match(code, /["']?is_archived["']?\s*:\s*true/);
    assert.doesNotMatch(code, /is_visible\s*:\s*false/);
    assert.doesNotMatch(code, /method\s*:\s*['"]DELETE['"]/);
  });

  test(`${name} has no external network destination`, () => {
    const externalUrls = code.match(/https?:\/\/[^'"`\s)]+/g) || [];
    assert.deepEqual(externalUrls, []);
  });
}

test('mobile version has three-way concurrency and adaptive slowdown', () => {
  assert.match(miniSource, /c\s*=\s*3/);
  assert.match(miniSource, /c\s*=\s*1/);
  assert.match(miniSource, /Promise\.all/);
});

test('bookmarklets remain within practical mobile bookmark sizes', () => {
  assert.ok(bookmarklet.length < 100000, `bookmarklet too large: ${bookmarklet.length}`);
  assert.ok(miniBookmarklet.length < 10000, `mini bookmarklet too large: ${miniBookmarklet.length}`);
});
