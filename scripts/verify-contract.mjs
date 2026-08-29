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
  commit: '02068b25f44b8fabedc20b30d4863aa05a83d209',
  tree: '6edb8a63e30721c2c6400cd800e32577e27f62c7',
  localPatch: 'ff4bac7297220e02c9c3fcdb7dc6ed696f902f32',
  packageVersion: '1.46.0',
  hostApiVersion: '1.57.0',
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

const tarball = resolve(root, provenance.package.file);
const bytes = await readFile(tarball);
requireEqual(sha(bytes), provenance.package.sha256, 'archive SHA-256');
requireEqual(sha(bytes, 'sha1'), provenance.package.npmShasum, 'npm shasum');
const npmIntegrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
requireEqual(npmIntegrity, provenance.package.npmIntegrity, 'npm integrity');

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
  if (!declaration.includes('declare const HOST_API_VERSION: "1.57.0";')) {
    throw new Error('packed declaration does not export Host API 1.57.0');
  }
  for (const required of [
    'src/host-api/local-channels.ts',
    'src/host-api/quick-chat.ts',
    'src/host-api/capabilities.ts',
  ]) {
    await readFile(resolve(temp, 'package', required));
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

const productFiles = (await filesUnder(root)).filter((file) => {
  const normalized = file.split(sep).join('/');
  return (
    !normalized.includes('/node_modules/') &&
    !normalized.includes('/dist/') &&
    !normalized.includes('/.git/') &&
    !normalized.includes('/.contract-') &&
    !normalized.includes('/rasen/') &&
    !normalized.includes('/.rasen/')
  );
});
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
    hostApi: '1.57.0',
    sha256: provenance.package.sha256,
    integrity: provenance.package.npmIntegrity,
    sourceCommit: provenance.source.commit,
    sourceTree: provenance.source.tree,
    localPatchId: provenance.localChannelPrerequisite.stablePatchId,
  })
);
