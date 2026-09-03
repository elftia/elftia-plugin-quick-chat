import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { inventory, inventoryDigest } from './artifact-utils.mjs';

const root = resolve(import.meta.dirname, '..');
const outputRoot = process.env.QUICK_CHAT_DIST_ROOT
  ? resolve(process.env.QUICK_CHAT_DIST_ROOT)
  : resolve(root, 'dist');
const pluginRoot = resolve(outputRoot, 'quick-chat');
const banner = '/* elftia-plugin-quick-chat@0.1.1 | Host API 1.58.0 */';
const bundledRuntimeSources = new Set([
  'node_modules/react/cjs/react.production.min.js',
  'node_modules/react/index.js',
  'node_modules/react-dom/cjs/react-dom.production.min.js',
  'node_modules/react-dom/client.js',
  'node_modules/react-dom/index.js',
  'node_modules/scheduler/cjs/scheduler.production.min.js',
  'node_modules/scheduler/index.js',
]);

async function normalizeSourceMap(path, allowBundledRuntime) {
  const sourceMap = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(sourceMap.sources))
    throw new Error(`build source map has no sources: ${path}`);
  sourceMap.sources = sourceMap.sources.map((source) => {
    if (typeof source !== 'string') throw new Error(`build source map has invalid source: ${path}`);
    const absolute = source.startsWith('file:')
      ? fileURLToPath(source)
      : resolve(dirname(path), source);
    const projectRelative = relative(root, absolute).split(sep).join('/');
    const producerSource = /^src\/(?:main|renderer|shared)\/[A-Za-z0-9._/-]+$/.test(
      projectRelative
    );
    const bundledSource = allowBundledRuntime && bundledRuntimeSources.has(projectRelative);
    if (!producerSource && !bundledSource) {
      throw new Error(`build source map escaped the exact source allowlist: ${source}`);
    }
    return `../../../${projectRelative}`;
  });
  delete sourceMap.sourcesContent;
  await writeFile(path, `${JSON.stringify(sourceMap)}\n`, 'utf8');
}

await rm(pluginRoot, { recursive: true, force: true });
await mkdir(resolve(pluginRoot, 'main'), { recursive: true });
await mkdir(resolve(pluginRoot, 'renderer'), { recursive: true });

const common = {
  absWorkingDir: root,
  bundle: true,
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
  minify: false,
  preserveSymlinks: true,
  sourcemap: 'external',
  sourcesContent: false,
  target: 'es2022',
  banner: { js: banner },
};

await build({
  ...common,
  entryPoints: ['src/main/index.ts'],
  outfile: resolve(pluginRoot, 'main', 'index.cjs'),
  format: 'cjs',
  platform: 'node',
  external: ['@elftia/plugin-types'],
});
await normalizeSourceMap(resolve(pluginRoot, 'main', 'index.cjs.map'), false);

await build({
  ...common,
  entryPoints: ['src/renderer/index.ts'],
  outfile: resolve(pluginRoot, 'renderer', 'index.mjs'),
  format: 'esm',
  platform: 'browser',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['@elftia/plugin-types'],
});
await normalizeSourceMap(resolve(pluginRoot, 'renderer', 'index.mjs.map'), true);

const sourceManifest = JSON.parse(
  await readFile(resolve(root, 'manifest', 'elftia-plugin.source.json'), 'utf8')
);
const checksumTargets = [
  {
    contribution: sourceManifest.contributes.main,
    root: resolve(pluginRoot, 'main'),
  },
  {
    contribution: sourceManifest.contributes.quickChat,
    root: resolve(pluginRoot, 'renderer'),
  },
];
for (const { contribution, root: contributionRoot } of checksumTargets) {
  const entry = resolve(contributionRoot, contribution.entry);
  const digest = createHash('sha512')
    .update(await readFile(entry))
    .digest('base64');
  contribution.checksum = `sha512-${digest}`;
}

await writeFile(
  resolve(pluginRoot, 'elftia-plugin.json'),
  `${JSON.stringify(sourceManifest, null, 2)}\n`,
  'utf8'
);
await cp(resolve(root, 'LICENSE'), resolve(pluginRoot, 'LICENSE'));
await cp(resolve(root, 'NOTICE'), resolve(pluginRoot, 'NOTICE'));
await cp(
  resolve(root, 'THIRD_PARTY_LICENSES.txt'),
  resolve(pluginRoot, 'THIRD_PARTY_LICENSES.txt')
);
await cp(
  resolve(root, 'contract', 'plugin-types.provenance.json'),
  resolve(pluginRoot, 'PROVENANCE.json')
);

const beforeIntegrity = await inventory(pluginRoot);
const integrity = {
  schemaVersion: 1,
  algorithm: 'sha256',
  selfExcluded: true,
  inventorySha256: inventoryDigest(beforeIntegrity),
  files: beforeIntegrity,
};
await writeFile(resolve(pluginRoot, 'integrity.json'), `${JSON.stringify(integrity, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      pluginRoot,
      files: (await inventory(pluginRoot)).length,
      integrity: integrity.inventorySha256,
    },
    null,
    2
  )
);
