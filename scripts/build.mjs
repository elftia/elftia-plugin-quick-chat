import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'esbuild';

import { inventory, inventoryDigest } from './artifact-utils.mjs';

const root = resolve(import.meta.dirname, '..');
const outputRoot = process.env.QUICK_CHAT_DIST_ROOT
  ? resolve(process.env.QUICK_CHAT_DIST_ROOT)
  : resolve(root, 'dist');
const pluginRoot = resolve(outputRoot, 'quick-chat');
const banner = '/* elftia-plugin-quick-chat@0.1.0 | Host API 1.57.0 */';

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

await build({
  ...common,
  entryPoints: ['src/renderer/index.ts'],
  outfile: resolve(pluginRoot, 'renderer', 'index.mjs'),
  format: 'esm',
  platform: 'browser',
  external: ['@elftia/plugin-types', 'react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
});

const sourceManifest = JSON.parse(
  await readFile(resolve(root, 'manifest', 'elftia-plugin.source.json'), 'utf8')
);
for (const role of ['main', 'renderer']) {
  const contribution = sourceManifest.contributes[role];
  const entry = resolve(pluginRoot, role, contribution.entry);
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
