import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { c as createTar } from 'tar';

import { inventory } from './artifact-utils.mjs';

const root = resolve(import.meta.dirname, '..');
const outputRoot = process.env.QUICK_CHAT_DIST_ROOT
  ? resolve(process.env.QUICK_CHAT_DIST_ROOT)
  : resolve(root, 'dist');
const artifact = resolve(outputRoot, 'quick-chat');
const release = process.env.QUICK_CHAT_RELEASE_ROOT
  ? resolve(process.env.QUICK_CHAT_RELEASE_ROOT)
  : resolve(root, 'release');
const archive = resolve(release, 'quick-chat-0.1.0.tgz');
const files = (await inventory(artifact)).map((entry) => entry.path);

await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });
await createTar(
  {
    cwd: artifact,
    file: archive,
    gzip: true,
    portable: true,
    noMtime: true,
    prefix: 'quick-chat/',
  },
  files
);

console.log(JSON.stringify({ archive, files }));
