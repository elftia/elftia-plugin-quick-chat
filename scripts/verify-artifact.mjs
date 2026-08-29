import { resolve } from 'node:path';

import { verifyArtifact } from './artifact-policy.mjs';

const root = resolve(import.meta.dirname, '..');
console.log(JSON.stringify(await verifyArtifact(resolve(root, 'dist', 'quick-chat'))));
