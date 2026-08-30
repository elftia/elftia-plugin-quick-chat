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

async function mutateManifest(artifact, mutate) {
  await mutateJson(resolve(artifact, 'elftia-plugin.json'), mutate);
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
    results.push({ label, gate: message });
    return;
  }
  throw new Error(`${label} unexpectedly passed artifact verification`);
}

try {
  await rejects(
    'generic-renderer-contribution',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.renderer = {
          entry: 'index.mjs',
          execution: 'opaque-frame-v1',
        };
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'opaque-execution',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.quickChat.execution = 'opaque-frame-v1';
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'alternate-execution',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.quickChat.execution = 'dedicated-window-v2';
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'compatibility-drift',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.quickChat.requiredMinor = 57;
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'entry-drift',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.quickChat.entry = 'alternate.mjs';
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'checksum-drift',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.quickChat.checksum = 'sha512-invalid';
      }),
    /quickChat entry checksum drift/
  );
  await rejects(
    'native-preload-field',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.quickChat.preload = 'preload.cjs';
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'native-coordinate-field',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.quickChat.x = 10;
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'identity-bearing-field',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.quickChat.endpointId = 'other';
        manifest.contributes.quickChat.chatId = 'other';
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'extra-contribution',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
        manifest.contributes.nativeWindow = { entry: 'native.cjs' };
      }),
    /manifest exact allowlist or Host ABI drift/
  );
  await rejects(
    'extra-provider',
    (artifact) =>
      mutateManifest(artifact, (manifest) => {
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
    'extra-file',
    (artifact) => writeFile(resolve(artifact, 'unexpected.txt'), 'unexpected\n', 'utf8'),
    /artifact inventory drift/
  );
  await rejects(
    'stale-integrity',
    (artifact) =>
      mutateJson(resolve(artifact, 'integrity.json'), (integrity) => {
        integrity.inventorySha256 = '0'.repeat(64);
      }),
    /integrity metadata drift/
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
  await rejects(
    'source-map-arbitrary-dependency',
    (artifact) =>
      mutateJson(resolve(artifact, 'renderer', 'index.mjs.map'), (sourceMap) => {
        sourceMap.sources[0] = '../../../node_modules/unreviewed/index.js';
      }),
    /artifact path purity violation/
  );
  await rejects(
    'source-map-embedded-source',
    (artifact) =>
      mutateJson(resolve(artifact, 'renderer', 'index.mjs.map'), (sourceMap) => {
        sourceMap.sourcesContent = ['secret source'];
      }),
    /embeds source content/
  );
  await rejects(
    'provenance-drift',
    (artifact) =>
      mutateJson(resolve(artifact, 'PROVENANCE.json'), (provenance) => {
        provenance.source.commit = '0'.repeat(40);
      }),
    /integrity metadata drift/
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ negativeArtifactCases: results }));
