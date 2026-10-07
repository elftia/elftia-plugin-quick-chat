import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { sha } from './artifact-utils.mjs';

const root = resolve(import.meta.dirname, '..');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'elftia-quick-chat-clean-checkout-'));
const temporaryIndex = resolve(temporaryRoot, 'index');
const checkout = resolve(temporaryRoot, 'checkout');
const gitEnvironment = { ...process.env, GIT_INDEX_FILE: temporaryIndex };

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `${options.label ?? command} failed (${String(result.status)}):\n${result.stdout}\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function git(arguments_, label) {
  return run('git', arguments_, { env: gitEnvironment, label });
}

function nodeScript(directory, script, label) {
  return run(process.execPath, [resolve(directory, 'scripts', script)], {
    cwd: directory,
    label,
  });
}

function parseJsonOutput(output, label) {
  const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const candidate = lines.at(-1);
  if (!candidate) throw new Error(`${label} returned no JSON output`);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${candidate}`);
  }
}

async function verifyLfCheckout(paths) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let textFiles = 0;
  for (const path of paths) {
    if (path.endsWith('.tgz')) continue;
    const bytes = await readFile(resolve(checkout, path));
    let text;
    try {
      text = decoder.decode(bytes);
    } catch {
      throw new Error(`clean checkout contains non-UTF-8 text: ${path}`);
    }
    textFiles += 1;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error(`clean checkout contains a UTF-8 BOM: ${path}`);
    }
    if (text.includes('\r')) throw new Error(`clean checkout contains CR bytes: ${path}`);
    if (!text.endsWith('\n')) throw new Error(`clean checkout lacks a final LF: ${path}`);
    if (text.endsWith('\n\n')) throw new Error(`clean checkout has a blank line at EOF: ${path}`);
  }
  return textFiles;
}

async function contentFingerprint(directory, paths) {
  const rows = [];
  for (const path of paths) {
    const bytes = await readFile(resolve(directory, path));
    rows.push(`${path}\t${String(bytes.byteLength)}\t${sha(bytes)}`);
  }
  return sha(Buffer.from(rows.join('\n'), 'utf8'));
}

try {
  git(['read-tree', 'HEAD'], 'temporary index initialization');
  git(['add', '--', '.gitattributes'], 'temporary attribute staging');
  git(['add', '--all'], 'temporary full staging');
  git(['diff', '--cached', '--check'], 'temporary staged whitespace check');

  await mkdir(checkout, { recursive: true });
  const prefix = `${checkout.replaceAll('\\', '/')}/`;
  git(['checkout-index', '--all', '--force', `--prefix=${prefix}`], 'temporary clean checkout');

  const stagedPaths = git(['ls-files'], 'temporary staged inventory')
    .split(/\r?\n/)
    .filter((path) => path.length > 0);
  const textFiles = await verifyLfCheckout(stagedPaths);
  const contentSha256 = await contentFingerprint(checkout, stagedPaths);
  const attributes = git(
    [
      'check-attr',
      '--cached',
      'text',
      'eol',
      '--',
      'LICENSE',
      'src/renderer/surface.ts',
      'dist/quick-chat/renderer/index.mjs',
      'vendor/elftia-plugin-types-1.46.0.tgz',
    ],
    'staged attribute verification'
  );
  for (const path of ['LICENSE', 'src/renderer/surface.ts', 'dist/quick-chat/renderer/index.mjs']) {
    if (!attributes.includes(`${path}: text: auto`) || !attributes.includes(`${path}: eol: lf`)) {
      throw new Error(`staged LF attribute missing for ${path}:\n${attributes}`);
    }
  }
  if (!attributes.includes('vendor/elftia-plugin-types-1.46.0.tgz: text: unset')) {
    throw new Error(`vendor contract archive is not marked binary:\n${attributes}`);
  }

  await symlink(
    resolve(root, 'node_modules'),
    resolve(checkout, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  const sourceSummary = parseJsonOutput(
    nodeScript(root, 'verify-artifact.mjs', 'source artifact verification'),
    'source artifact verification'
  );
  const sourceRuntime = parseJsonOutput(
    nodeScript(root, 'verify-window-runtime.mjs', 'source built-window verification'),
    'source built-window verification'
  );
  const checkedOutSummary = parseJsonOutput(
    nodeScript(checkout, 'verify-artifact.mjs', 'checked-out artifact verification'),
    'checked-out artifact verification'
  );
  if (JSON.stringify(checkedOutSummary) !== JSON.stringify(sourceSummary)) {
    throw new Error(
      `checked-out artifact summary differs from source:\n${JSON.stringify({ sourceSummary, checkedOutSummary }, null, 2)}`
    );
  }

  nodeScript(root, 'pack.mjs', 'source artifact pack');
  const sourceArchive = await readFile(resolve(root, 'release', 'quick-chat-0.1.2.tgz'));

  nodeScript(checkout, 'build.mjs', 'clean checkout build');
  const rebuiltRuntime = parseJsonOutput(
    nodeScript(checkout, 'verify-window-runtime.mjs', 'rebuilt window verification'),
    'rebuilt window verification'
  );
  if (JSON.stringify(rebuiltRuntime) !== JSON.stringify(sourceRuntime)) {
    throw new Error(
      `clean checkout window vertical differs from source:\n${JSON.stringify({ sourceRuntime, rebuiltRuntime }, null, 2)}`
    );
  }
  const rebuiltSummary = parseJsonOutput(
    nodeScript(checkout, 'verify-artifact.mjs', 'rebuilt checkout artifact verification'),
    'rebuilt checkout artifact verification'
  );
  if (JSON.stringify(rebuiltSummary) !== JSON.stringify(sourceSummary)) {
    throw new Error(
      `clean checkout rebuild differs from source:\n${JSON.stringify({ sourceSummary, rebuiltSummary }, null, 2)}`
    );
  }

  nodeScript(checkout, 'pack.mjs', 'clean checkout pack');
  const checkedOutArchive = await readFile(resolve(checkout, 'release', 'quick-chat-0.1.2.tgz'));
  if (!checkedOutArchive.equals(sourceArchive)) {
    throw new Error('clean checkout pack bytes differ from the source checkout');
  }

  console.log(
    JSON.stringify({
      cleanCheckout: 'temporary-index',
      stagedFiles: stagedPaths.length,
      textFiles,
      contentSha256,
      artifact: sourceSummary,
      windowRuntime: sourceRuntime,
      packBytes: sourceArchive.byteLength,
      packSha256: sha(sourceArchive),
      result: 'identical',
    })
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
