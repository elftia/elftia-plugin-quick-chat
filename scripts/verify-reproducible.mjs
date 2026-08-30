import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { inventory, sha } from './artifact-utils.mjs';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(resolve(tmpdir(), 'elftia-quick-chat-repro-'));
const outputA = resolve(temp, 'a');
const outputB = resolve(temp, 'b');
const releaseA = resolve(temp, 'release-a');
const releaseB = resolve(temp, 'release-b');
const releaseSource = resolve(temp, 'release-source');

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

function packFrom(output, release) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', 'pack.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      QUICK_CHAT_DIST_ROOT: output,
      QUICK_CHAT_RELEASE_ROOT: release,
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`isolated pack failed:\n${result.stdout}\n${result.stderr}`);
  }
}

try {
  buildInto(outputA);
  buildInto(outputB);
  const first = await inventory(resolve(outputA, 'quick-chat'));
  const second = await inventory(resolve(outputB, 'quick-chat'));
  const source = await inventory(resolve(root, 'dist', 'quick-chat'));
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(
      `normalized inventories differ:\n${JSON.stringify({ first, second }, null, 2)}`
    );
  }
  if (JSON.stringify(first) !== JSON.stringify(source)) {
    throw new Error(
      `isolated build differs from committed distribution:\n${JSON.stringify({ source, isolated: first }, null, 2)}`
    );
  }
  for (const entry of first) {
    const left = await readFile(resolve(outputA, 'quick-chat', entry.path));
    const right = await readFile(resolve(outputB, 'quick-chat', entry.path));
    if (!left.equals(right)) throw new Error(`isolated build bytes differ: ${entry.path}`);
  }
  packFrom(outputA, releaseA);
  packFrom(outputB, releaseB);
  packFrom(resolve(root, 'dist'), releaseSource);
  const archiveA = await readFile(resolve(releaseA, 'quick-chat-0.1.0.tgz'));
  const archiveB = await readFile(resolve(releaseB, 'quick-chat-0.1.0.tgz'));
  const archiveSource = await readFile(resolve(releaseSource, 'quick-chat-0.1.0.tgz'));
  if (!archiveA.equals(archiveB) || !archiveA.equals(archiveSource)) {
    throw new Error('source and isolated packed archives differ');
  }
  console.log(
    JSON.stringify({
      isolatedBuilds: 2,
      comparedDistribution: 'dist/quick-chat',
      isolatedPacks: 2,
      comparedPacks: 3,
      files: first.length,
      archiveBytes: archiveA.byteLength,
      archiveSha256: sha(archiveA),
      result: 'identical',
    })
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
