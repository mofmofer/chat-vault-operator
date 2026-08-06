import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const distDir = path.join(root, 'dist');

async function build(name, { encode = true } = {}) {
  const sourcePath = path.join(root, 'src', `${name}.js`);
  const source = (await readFile(sourcePath, 'utf8')).trim();
  const flattened = source.replace(/\s+/g, ' ');
  const bookmarklet = `javascript:${encode ? encodeURIComponent(flattened) : flattened}`;

  await writeFile(path.join(distDir, `${name}.js`), `${source}\n`, 'utf8');
  await writeFile(path.join(distDir, `${name}-bookmarklet.txt`), `${bookmarklet}\n`, 'utf8');
  console.log(`Built ${name}: ${bookmarklet.length.toLocaleString()} characters`);
}

await mkdir(distDir, { recursive: true });
await build('chat-vault-operator');
await build('chat-vault-operator-mini', { encode: false });
await build('chat-vault-operator-chrome-self-contained', { encode: false });
