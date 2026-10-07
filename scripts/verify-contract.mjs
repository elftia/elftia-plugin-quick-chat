import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

import { x as extractTar } from 'tar';

import { filesUnder, readJson, sha } from './artifact-utils.mjs';

const root = resolve(import.meta.dirname, '..');
const provenancePath = resolve(root, 'contract', 'plugin-types.provenance.json');
const provenance = await readJson(provenancePath);
const expected = {
  commit: '8d83a992e54124f7d38ed8ee5735a63bba6f6e74',
  tree: 'dce634dfaca9f1fab60719c96bb274c73f76d778',
  localPatch: 'ff4bac7297220e02c9c3fcdb7dc6ed696f902f32',
  packageVersion: '1.46.0',
  hostApiVersion: '1.58.0',
  sha256: '5a22f0fc8d28bb7f385ed81b6b04b6c01f57eb6a7ff5800507b9e01442c569c4',
  npmShasum: '845de7f1df5e37eee9e33794357b4f28fef75cdf',
  npmIntegrity:
    'sha512-vv5jcHhaMHWodaC34mxOyrVFOhxPEc7sWV/VWjA1KlX8xcA7kVEi7cMptKY0JX94SSbDmsLGidMzJP0i9BSxnA==',
};
const provisional = {
  packageVersion: '1.46.0',
  hostApiVersion: '1.57.0',
  sha256: '2e1afd9d79a7f1771aad8ae3512ccc8c884c5985f11721658ef938344ace9d02',
};

function requireEqual(actual, wanted, label) {
  if (actual !== wanted) throw new Error(`${label}: expected ${wanted}, got ${actual}`);
}

requireEqual(provenance.source.commit, expected.commit, 'reviewed source commit');
requireEqual(provenance.source.tree, expected.tree, 'reviewed source tree');
requireEqual(provenance.source.clean, true, 'reviewed source cleanliness');
requireEqual(provenance.source.hostApiVersion, expected.hostApiVersion, 'source Host API');
requireEqual(
  provenance.localChannelPrerequisite.stablePatchId,
  expected.localPatch,
  'Local prerequisite patch-id'
);
requireEqual(
  provenance.localChannelPrerequisite.patchEquivalent,
  true,
  'Local prerequisite equivalence'
);
requireEqual(provenance.package.version, expected.packageVersion, 'package provenance version');
requireEqual(provenance.package.hostApiVersion, expected.hostApiVersion, 'package Host API');
requireEqual(provenance.package.sha256, expected.sha256, 'recorded archive SHA-256');
requireEqual(provenance.package.npmShasum, expected.npmShasum, 'recorded npm shasum');
requireEqual(provenance.package.npmIntegrity, expected.npmIntegrity, 'recorded npm integrity');

const packageJson = await readJson(resolve(root, 'package.json'));
const dependency = packageJson.devDependencies?.['@elftia/plugin-types'];
requireEqual(
  dependency,
  'file:vendor/elftia-plugin-types-1.46.0.tgz',
  'portable plugin-types dependency'
);
const lock = await readJson(resolve(root, 'package-lock.json'));
requireEqual(
  lock.packages?.['']?.devDependencies?.['@elftia/plugin-types'],
  dependency,
  'lockfile root plugin-types dependency'
);
const lockEntry = lock.packages?.['node_modules/@elftia/plugin-types'];
requireEqual(lockEntry?.version, expected.packageVersion, 'locked plugin-types version');
requireEqual(lockEntry?.resolved, dependency, 'locked plugin-types resolution');
requireEqual(lockEntry?.integrity, expected.npmIntegrity, 'locked plugin-types integrity');

const tarball = resolve(root, provenance.package.file);
const bytes = await readFile(tarball);
requireEqual(sha(bytes), provenance.package.sha256, 'archive SHA-256');
requireEqual(sha(bytes, 'sha1'), provenance.package.npmShasum, 'npm shasum');
const npmIntegrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
requireEqual(npmIntegrity, provenance.package.npmIntegrity, 'npm integrity');

function assertCanonicalIdentity(candidate) {
  requireEqual(candidate.packageVersion, expected.packageVersion, 'candidate package version');
  requireEqual(candidate.hostApiVersion, expected.hostApiVersion, 'candidate Host API');
  requireEqual(candidate.sha256, expected.sha256, 'candidate archive SHA-256');
}

let provisionalRejected = false;
try {
  assertCanonicalIdentity(provisional);
} catch {
  provisionalRejected = true;
}
if (!provisionalRejected) {
  throw new Error('provisional Host API 1.57.0 archive identity was not rejected');
}

const temp = await mkdtemp(resolve(tmpdir(), 'elftia-quick-chat-contract-'));
try {
  await extractTar({ file: tarball, cwd: temp, strict: true });
  const packed = await readJson(resolve(temp, 'package', 'package.json'));
  requireEqual(packed.name, '@elftia/plugin-types', 'packed package name');
  requireEqual(packed.version, expected.packageVersion, 'packed package version');
  const requireFromHere = createRequire(import.meta.url);
  const contract = requireFromHere(resolve(temp, 'package', 'dist', 'index.cjs'));
  requireEqual(contract.HOST_API_VERSION, expected.hostApiVersion, 'packed Host API version');
  const declaration = await readFile(resolve(temp, 'package', 'dist', 'index.d.ts'), 'utf8');
  if (!declaration.includes('declare const HOST_API_VERSION: "1.58.0";')) {
    throw new Error('packed declaration does not export Host API 1.58.0');
  }
  const rendererDeclaration = await readFile(
    resolve(temp, 'package', 'src', 'renderer.ts'),
    'utf8'
  );
  const localChannelDeclaration = await readFile(
    resolve(temp, 'package', 'src', 'host-api', 'local-channels.ts'),
    'utf8'
  );
  const quickChatDeclaration = await readFile(
    resolve(temp, 'package', 'src', 'host-api', 'quick-chat.ts'),
    'utf8'
  );
  for (const [label, text, required] of [
    ['Quick Chat module', rendererDeclaration, 'export interface QuickChatWindowModule'],
    ['Quick Chat Host', rendererDeclaration, 'export interface QuickChatWindowHost'],
    ['Quick Chat activation root', rendererDeclaration, 'readonly root: HTMLElement;'],
    [
      'fixed Local Channel',
      localChannelDeclaration,
      'export interface QuickChatWindowLocalChannel',
    ],
    [
      'zero-argument attach',
      localChannelDeclaration,
      'attach(): Promise<QuickChatWindowLocalChannelClient>;',
    ],
    ['close intent', quickChatDeclaration, 'export interface QuickChatWindowCloseIntent'],
    ['close request', quickChatDeclaration, 'request(): Promise<void>;'],
  ]) {
    if (!text.includes(required)) throw new Error(`packed contract is missing ${label}`);
  }
  for (const forbidden of ['AgentUiQuickChatHostApi', 'registerSurface']) {
    if (rendererDeclaration.includes(forbidden)) {
      throw new Error(`packed contract retains provisional Quick Chat registry: ${forbidden}`);
    }
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

const productFiles = await filesUnder(
  root,
  (name) =>
    ['node_modules', 'dist', '.git', 'rasen', '.rasen'].includes(name) ||
    name.startsWith('.contract-')
);
for (const file of productFiles) {
  if (!/\.(?:json|mjs|ts)$/.test(file)) continue;
  const text = await readFile(file, 'utf8');
  if (/file:(?:\.\.\/|\.\.\\)/.test(text)) {
    throw new Error(`sibling file dependency is forbidden: ${file}`);
  }
  if (/from\s+['"](?:@\/|@main\/|@elftia\/shared)/.test(text)) {
    throw new Error(`Host implementation import is forbidden: ${file}`);
  }
}

const installedContract = await realpath(resolve(root, 'node_modules', '@elftia', 'plugin-types'));
const normalizedRoot = `${(await realpath(root)).toLowerCase()}${sep}`;
if (!`${installedContract.toLowerCase()}${sep}`.startsWith(normalizedRoot)) {
  throw new Error('plugin-types resolved outside the standalone producer dependency tree');
}

console.log(
  JSON.stringify({
    contract: '@elftia/plugin-types@1.46.0',
    hostApi: '1.58.0',
    sha256: provenance.package.sha256,
    integrity: provenance.package.npmIntegrity,
    sourceCommit: provenance.source.commit,
    sourceTree: provenance.source.tree,
    localPatchId: provenance.localChannelPrerequisite.stablePatchId,
    provisional157Rejected: provisionalRejected,
  })
);
