import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourcePath = path.join(root, 'src', 'chat-vault-operator.js');
const distDir = path.join(root, 'dist');
const source = (await readFile(sourcePath, 'utf8')).trim();
const flattened = source.replace(/\s+/g, ' ');
const bookmarklet = `javascript:${encodeURIComponent(flattened)}`;

await mkdir(distDir, { recursive: true });
await writeFile(path.join(distDir, 'chat-vault-operator.js'), `${source}\n`, 'utf8');
await writeFile(path.join(distDir, 'bookmarklet.txt'), `${bookmarklet}\n`, 'utf8');
console.log(`Built bookmarklet: ${bookmarklet.length.toLocaleString()} characters`);
