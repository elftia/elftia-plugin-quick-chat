import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { inventory, inventoryDigest, readJson, sha } from './artifact-utils.mjs';

export const EXPECTED_ARTIFACT_INVENTORY = Object.freeze([
  'LICENSE',
  'NOTICE',
  'PROVENANCE.json',
  'THIRD_PARTY_LICENSES.txt',
  'elftia-plugin.json',
  'integrity.json',
  'main/index.cjs',
  'main/index.cjs.map',
  'renderer/index.mjs',
  'renderer/index.mjs.map',
]);

const REACT_SOURCE_MAP_ALLOWLIST = new Set([
  '../../../node_modules/react/cjs/react.production.min.js',
  '../../../node_modules/react/index.js',
  '../../../node_modules/react-dom/cjs/react-dom.production.min.js',
  '../../../node_modules/react-dom/client.js',
  '../../../node_modules/react-dom/index.js',
  '../../../node_modules/scheduler/cjs/scheduler.production.min.js',
  '../../../node_modules/scheduler/index.js',
]);

const expectedManifest = (mainChecksum, quickChatChecksum) => ({
  name: 'quick-chat',
  version: '0.1.1',
  minElftiaVersion: '0.2.8',
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
    main: {
      entry: 'index.cjs',
      requiredMajor: 1,
      requiredMinor: 58,
      builtAgainst: '1.58.0',
      checksum: mainChecksum,
    },
    quickChat: {
      id: 'default',
      entry: 'index.mjs',
      execution: 'dedicated-window-v1',
      requiredMajor: 1,
      requiredMinor: 58,
      builtAgainst: '1.58.0',
      window: {
        defaultWidth: 400,
        defaultHeight: 560,
        minWidth: 320,
        minHeight: 360,
        maxWidth: 720,
        maxHeight: 900,
      },
      checksum: quickChatChecksum,
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
  /(?:^|[^A-Za-z0-9+.-])[A-Za-z]:[\\/]/m,
  /(?:^|[^\\])\\\\[^\\\s]+[\\/]/m,
  /file:\/\/(?:\/|[A-Za-z]:)/i,
  /(?:^|["'(\s])\/(?:Users|home|tmp|var\/tmp|private\/var\/folders)\//,
  /(?:^|["'(\s])\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/m,
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
  if (!Array.isArray(sourceMap.sources) || sourceMap.sources.length === 0) {
    throw new Error(`artifact source map has no sources allowlist: ${path}`);
  }
  if ('sourcesContent' in sourceMap) {
    throw new Error(`artifact source map embeds source content: ${path}`);
  }
  const rendererMap = path === 'renderer/index.mjs.map';
  const reactSources = new Set();
  for (const source of sourceMap.sources) {
    if (typeof source !== 'string') {
      throw new Error(`artifact source map contains a non-string source: ${path}`);
    }
    const normalized = source.replaceAll('\\', '/');
    const producerSource = /^(?:\.\.\/){3}src\/(?:main|renderer|shared)\/[A-Za-z0-9._/-]+$/.test(
      normalized
    );
    const reactSource = rendererMap && REACT_SOURCE_MAP_ALLOWLIST.has(normalized);
    if (!producerSource && !reactSource) {
      throw new Error(`artifact path purity violation in ${path}: source-map dependency path`);
    }
    if (reactSource) reactSources.add(normalized);
  }
  if (rendererMap && !isDeepStrictEqual(reactSources, REACT_SOURCE_MAP_ALLOWLIST)) {
    throw new Error('renderer source map does not contain the exact bundled React-family runtime');
  }
  if (!rendererMap && reactSources.size > 0) {
    throw new Error('main source map unexpectedly contains a browser runtime dependency');
  }
}

async function readAndVerifyArtifactText(artifact, entries) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const textByPath = new Map();
  for (const entry of entries) {
    let text;
    try {
      const bytes = await readFile(resolve(artifact, entry.path));
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        throw new Error('BOM');
      }
      text = decoder.decode(bytes);
    } catch {
      throw new Error(`artifact text is not strict UTF-8 without BOM: ${entry.path}`);
    }
    if (!text.endsWith('\n')) throw new Error(`artifact text lacks final LF: ${entry.path}`);
    textByPath.set(entry.path, text);
    for (const pattern of forbiddenArtifactPaths) {
      if (pattern.test(text)) {
        throw new Error(`artifact path purity violation in ${entry.path}: ${pattern}`);
      }
    }
    if (entry.path.endsWith('.map')) {
      assertSourceMapPaths(entry.path, text);
    } else {
      if (/(?:^|[^.])\.\.[\\/]/m.test(text)) {
        throw new Error(`artifact path purity violation in ${entry.path}: parent path`);
      }
      if (/node_modules[\\/]/.test(text)) {
        throw new Error(`artifact path purity violation in ${entry.path}: node_modules path`);
      }
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
    manifest.contributes?.quickChat?.checksum
  );
  if (!isDeepStrictEqual(manifest, expected)) {
    throw new Error('manifest exact allowlist or Host ABI drift');
  }
  if ('renderer' in manifest.contributes) {
    throw new Error('generic renderer contribution is forbidden for Quick Chat');
  }

  for (const { label, root, contribution } of [
    { label: 'main', root: 'main', contribution: manifest.contributes.main },
    { label: 'quickChat', root: 'renderer', contribution: manifest.contributes.quickChat },
  ]) {
    const entry = resolve(artifact, root, contribution.entry);
    const checksum = `sha512-${sha(await readFile(entry), 'sha512', 'base64')}`;
    if (contribution.checksum !== checksum) throw new Error(`${label} entry checksum drift`);
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

  const provenance = await readJson(resolve(artifact, 'PROVENANCE.json'));
  if (
    provenance.source?.commit !== '8d83a992e54124f7d38ed8ee5735a63bba6f6e74' ||
    provenance.source?.tree !== 'dce634dfaca9f1fab60719c96bb274c73f76d778' ||
    provenance.source?.hostApiVersion !== '1.58.0' ||
    provenance.package?.sha256 !==
      '5a22f0fc8d28bb7f385ed81b6b04b6c01f57eb6a7ff5800507b9e01442c569c4' ||
    provenance.package?.npmIntegrity !==
      'sha512-vv5jcHhaMHWodaC34mxOyrVFOhxPEc7sWV/VWjA1KlX8xcA7kVEi7cMptKY0JX94SSbDmsLGidMzJP0i9BSxnA=='
  ) {
    throw new Error('contract provenance drift');
  }

  const notice = textByPath.get('NOTICE') ?? '';
  const thirdParty = textByPath.get('THIRD_PARTY_LICENSES.txt') ?? '';
  if (
    !notice.includes('React, ReactDOM, and Scheduler') ||
    !thirdParty.includes('Copyright (c) Meta Platforms, Inc. and affiliates.') ||
    !thirdParty.includes('MIT License')
  ) {
    throw new Error('bundled runtime license inventory drift');
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
    /AgentUiQuickChatHostApi/,
    /registerSurface/,
    /opaque-frame-v1/,
    /capabilityToken/,
    /@elftia\/plugin-types/,
  ]) {
    if (pattern.test(allRuntime)) throw new Error(`runtime purity violation: ${pattern}`);
  }
  for (const pattern of [
    /\b(?:require|process|Buffer|__dirname|__filename)\b/,
    /(?:from|import\()\s*["'](?:electron|node:)/,
    /\bipc\b/i,
    /\bpreload\b/i,
  ]) {
    if (pattern.test(renderer)) throw new Error(`renderer purity violation: ${pattern}`);
  }
  if (/\belectron\b|BrowserWindow|webContents/.test(main)) {
    throw new Error('main artifact contains Electron or native window authority');
  }

  return {
    files: entries.length,
    inventorySha256: inventoryDigest(entries),
    mainSha256: entries.find((entry) => entry.path === 'main/index.cjs')?.sha256,
    rendererSha256: entries.find((entry) => entry.path === 'renderer/index.mjs')?.sha256,
    rendererBytes: entries.find((entry) => entry.path === 'renderer/index.mjs')?.size,
    bundledRuntimeSources: REACT_SOURCE_MAP_ALLOWLIST.size,
  };
}
