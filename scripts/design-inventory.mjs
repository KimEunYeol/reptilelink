import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function inventory(root) {
  const paths = readdirSync(resolve(root, 'design'), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.png'))
    .map(entry => `${entry.parentPath}/${entry.name}`.slice(resolve(root).length + 1)).sort();
  return paths.map(path => {
    const bytes = readFileSync(resolve(root, path));
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error(`Invalid PNG: ${path}`);
    return { path, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  });
}

export function checkInventory(root) {
  const expected = JSON.parse(readFileSync(resolve(root, 'design/inventory.json'), 'utf8'));
  if (!expected.length || JSON.stringify(expected) !== JSON.stringify(inventory(root))) {
    throw new Error('Design inventory mismatch. Review source changes before running design:inventory.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (process.argv.includes('--write')) writeFileSync(resolve(root, 'design/inventory.json'), JSON.stringify(inventory(root), null, 2) + '\n');
  else checkInventory(root);
  console.log('Design inventory verified.');
}
