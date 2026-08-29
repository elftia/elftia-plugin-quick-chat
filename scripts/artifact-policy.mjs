import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { inventory, inventoryDigest, readJson, sha } from './artifact-utils.mjs';

export const EXPECTED_ARTIFACT_INVENTORY = Object.freeze([
  'LICENSE',
  'NOTICE',
  'PROVENANCE.json',
  'elftia-plugin.json',
  'integrity.json',
  'main/index.cjs',
  'main/index.cjs.map',
  'renderer/index.mjs',
  'renderer/index.mjs.map',
]);

const expectedManifest = (mainChecksum, rendererChecksum) => ({
  name: 'quick-chat',
  version: '0.1.0',
  kind: 'app-extension',
  permissions: ['host:local-channel'],
  displayName: 'Quick Chat',
  description: 'Compact owner-scoped Local Channel conversation surface',
  capabilities: {
    provides: [
      {
        id: 'elftia.quick-chat',
        version: '1.0.0',
        target: 'main',
        cardinality: 'single',
      },
    ],
  },
  contributes: {
    renderer: {
      entry: 'index.mjs',
      execution: 'opaque-frame-v1',
      requiredMajor: 1,
      requiredMinor: 57,
      builtAgainst: '1.57.0',
      checksum: rendererChecksum,
    },
    main: {
      entry: 'index.cjs',
      requiredMajor: 1,
      requiredMinor: 57,
      builtAgainst: '1.57.0',
      checksum: mainChecksum,
    },
    quickChat: {
      id: 'default',
      window: {
        defaultWidth: 380,
        defaultHeight: 520,
        minWidth: 320,
        minHeight: 360,
        maxWidth: 720,
        maxHeight: 900,
      },
    },
    localChannels: [
      {
        id: 'default',
        displayName: 'Quick Chat',
        targetAgentId: 'builtin-elftia-clawia',
        exposeToAgent: true,
      },
    ],
  },
});

const forbiddenArtifactPaths = [
  /[A-Za-z]:[\\/]/,
  /(?:^|[^\\])\\\\[^\\\s]+[\\/]/m,
  /file:\/\/(?:\/|[A-Za-z]:)/i,
  /(?:^|["'(\s])\/(?:Users|home|tmp|var\/tmp|private\/var\/folders)\//,
  /(?:^|["'(\s])\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/m,
  /node_modules[\\/]/,
  /VibeCodingProjects/i,
  /@main\//,
  /@elftia\/shared/,
  /(?:^|[\\/])elftia--[^\\/]+[\\/]/i,
];

function assertSourceMapPaths(path, text) {
  let sourceMap;
  try {
    sourceMap = JSON.parse(text);
  } catch {
    throw new Error(`artifact source map is invalid JSON: ${path}`);
  }
  if (!Array.isArray(sourceMap.sources)) {
    throw new Error(`artifact source map has no sources allowlist: ${path}`);
  }
  for (const source of sourceMap.sources) {
    if (typeof source !== 'string') {
      throw new Error(`artifact source map contains a non-string source: ${path}`);
    }
    const normalized = source.replaceAll('\\', '/');
    if (!/^(?:\.\.\/){3}src\/(?:main|renderer|shared)\/[A-Za-z0-9._/-]+$/.test(normalized)) {
      throw new Error(`artifact path purity violation in ${path}: source-map sibling path`);
    }
  }
}

async function readAndVerifyArtifactText(artifact, entries) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const textByPath = new Map();
  for (const entry of entries) {
    let text;
    try {
      text = decoder.decode(await readFile(resolve(artifact, entry.path)));
    } catch {
      throw new Error(`artifact text is not strict UTF-8: ${entry.path}`);
    }
    textByPath.set(entry.path, text);
    for (const pattern of forbiddenArtifactPaths) {
      if (pattern.test(text)) {
        throw new Error(`artifact path purity violation in ${entry.path}: ${pattern}`);
      }
    }
    if (entry.path.endsWith('.map')) assertSourceMapPaths(entry.path, text);
    else if (/(?:^|[^.])\.\.[\\/]/m.test(text)) {
      throw new Error(`artifact path purity violation in ${entry.path}: parent path`);
    }
  }
  return textByPath;
}

export async function verifyArtifact(artifact) {
  const entries = await inventory(artifact);
  const paths = entries.map((entry) => entry.path);
  if (!isDeepStrictEqual(paths, EXPECTED_ARTIFACT_INVENTORY)) {
    throw new Error(`artifact inventory drift: ${JSON.stringify(paths)}`);
  }

  const manifest = await readJson(resolve(artifact, 'elftia-plugin.json'));
  const expected = expectedManifest(
    manifest.contributes?.main?.checksum,
    manifest.contributes?.renderer?.checksum
  );
  if (!isDeepStrictEqual(manifest, expected)) {
    throw new Error('manifest exact allowlist or Host ABI drift');
  }

  for (const role of ['main', 'renderer']) {
    const entry = resolve(artifact, role, manifest.contributes[role].entry);
    const checksum = `sha512-${sha(await readFile(entry), 'sha512', 'base64')}`;
    if (manifest.contributes[role].checksum !== checksum) {
      throw new Error(`${role} entry checksum drift`);
    }
  }

  const textByPath = await readAndVerifyArtifactText(artifact, entries);
  const integrity = await readJson(resolve(artifact, 'integrity.json'));
  const withoutIntegrity = entries.filter((entry) => entry.path !== 'integrity.json');
  if (
    integrity.schemaVersion !== 1 ||
    integrity.algorithm !== 'sha256' ||
    integrity.selfExcluded !== true ||
    !isDeepStrictEqual(integrity.files, withoutIntegrity) ||
    integrity.inventorySha256 !== inventoryDigest(withoutIntegrity)
  ) {
    throw new Error('integrity metadata drift');
  }

  const main = textByPath.get('main/index.cjs');
  const renderer = textByPath.get('renderer/index.mjs');
  if (main === undefined || renderer === undefined) throw new Error('runtime entries are missing');
  const allRuntime = `${main}\n${renderer}`;
  for (const pattern of [
    /window\.native/,
    /quickChatNative/,
    /petNative/,
    /ipcRenderer/,
    /preload/i,
  ]) {
    if (pattern.test(allRuntime)) throw new Error(`runtime purity violation: ${pattern}`);
  }
  for (const pattern of [
    /\b(?:require|process|Buffer|__dirname|__filename)\b/,
    /(?:from|import\()\s*["'](?:electron|node:)/,
    /\bdocument\b/,
    /\bwindow\b/,
    /dangerouslySetInnerHTML/,
    /\bclassName\b/,
    /\bstyle\s*:/,
    /react\/jsx-runtime/,
  ]) {
    if (pattern.test(renderer)) throw new Error(`renderer purity violation: ${pattern}`);
  }
  if (/\belectron\b|BrowserWindow|webContents/.test(main)) {
    throw new Error('main artifact contains Electron or native window authority');
  }
  if (/\b(?:className|dangerouslySetInnerHTML)\b|\bstyle\s*:/.test(renderer)) {
    throw new Error('renderer emits a forbidden remote-DOM prop');
  }

  return {
    files: entries.length,
    inventorySha256: inventoryDigest(entries),
    mainSha256: entries.find((entry) => entry.path === 'main/index.cjs')?.sha256,
    rendererSha256: entries.find((entry) => entry.path === 'renderer/index.mjs')?.sha256,
  };
}
