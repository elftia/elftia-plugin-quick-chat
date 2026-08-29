import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { inventory } from './artifact-utils.mjs';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(resolve(tmpdir(), 'elftia-quick-chat-repro-'));
const outputA = resolve(temp, 'a');
const outputB = resolve(temp, 'b');

function buildInto(output) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', 'build.mjs')], {
    cwd: root,
    env: { ...process.env, QUICK_CHAT_DIST_ROOT: output },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`isolated build failed:\n${result.stdout}\n${result.stderr}`);
  }
}

try {
  buildInto(outputA);
  buildInto(outputB);
  const first = await inventory(resolve(outputA, 'quick-chat'));
  const second = await inventory(resolve(outputB, 'quick-chat'));
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(
      `normalized inventories differ:\n${JSON.stringify({ first, second }, null, 2)}`
    );
  }
  for (const entry of first) {
    const left = await readFile(resolve(outputA, 'quick-chat', entry.path));
    const right = await readFile(resolve(outputB, 'quick-chat', entry.path));
    if (!left.equals(right)) throw new Error(`isolated build bytes differ: ${entry.path}`);
  }
  console.log(JSON.stringify({ isolatedBuilds: 2, files: first.length, result: 'identical' }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
