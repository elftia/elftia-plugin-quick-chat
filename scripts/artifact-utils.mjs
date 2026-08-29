import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

export async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await filesUnder(absolute)));
    else if (entry.isFile()) output.push(absolute);
    else throw new Error(`artifact contains a non-regular entry: ${absolute}`);
  }
  return output.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function sha(buffer, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(buffer).digest(encoding);
}

export async function inventory(directory) {
  const files = await filesUnder(directory);
  return Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(file);
      return {
        path: relative(directory, file).split(sep).join('/'),
        size: (await stat(file)).size,
        sha256: sha(bytes),
      };
    })
  );
}

export function inventoryDigest(entries) {
  const normalized = entries
    .map((entry) => `${entry.path}\t${entry.size}\t${entry.sha256}`)
    .join('\n');
  return sha(Buffer.from(normalized, 'utf8'));
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
