import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { verifyArtifact } from './artifact-policy.mjs';

const root = resolve(import.meta.dirname, '..');
const sourceArtifact = resolve(root, 'dist', 'quick-chat');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'elftia-quick-chat-artifact-negative-'));
const results = [];

async function mutateJson(path, mutate) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  mutate(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function rejects(label, mutate, expected) {
  const artifact = resolve(temporaryRoot, label);
  await cp(sourceArtifact, artifact, { recursive: true });
  await mutate(artifact);
  try {
    await verifyArtifact(artifact);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!expected.test(message)) {
      throw new Error(`${label} failed through the wrong gate: ${message}`);
    }
    results.push(label);
    return;
  }
  throw new Error(`${label} unexpectedly passed artifact verification`);
}

try {
  await rejects(
    'abi-drift',
    (artifact) =>
      mutateJson(resolve(artifact, 'elftia-plugin.json'), (manifest) => {
        manifest.contributes.renderer.requiredMinor = 58;
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'extra-contribution',
    (artifact) =>
      mutateJson(resolve(artifact, 'elftia-plugin.json'), (manifest) => {
        manifest.contributes.nativeWindow = { entry: 'native.cjs' };
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'extra-provider',
    (artifact) =>
      mutateJson(resolve(artifact, 'elftia-plugin.json'), (manifest) => {
        manifest.capabilities.provides.push({
          id: 'elftia.unexpected',
          version: '1.0.0',
          target: 'main',
          cardinality: 'single',
        });
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'source-map-machine-path',
    (artifact) =>
      mutateJson(resolve(artifact, 'renderer', 'index.mjs.map'), (sourceMap) => {
        sourceMap.sources[0] = 'E:\\private-machine\\elftia\\src\\renderer\\index.ts';
      }),
    /artifact path purity violation/
  );
  await rejects(
    'source-map-sibling-path',
    (artifact) =>
      mutateJson(resolve(artifact, 'main', 'index.cjs.map'), (sourceMap) => {
        sourceMap.sources[0] = '../../../elftia--quick-chat-surface-host/src/main/index.ts';
      }),
    /artifact path purity violation/
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ negativeArtifactCases: results }));
