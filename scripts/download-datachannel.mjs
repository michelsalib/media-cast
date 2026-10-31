#!/usr/bin/env node
// Puts node-datachannel's native binding (WebRTC, needed by webtorrent) where it loads it
// from: node_modules/node-datachannel/build/Release/node_datachannel.node.
//
// Its own install script (prebuild-install) is one of the postinstalls bun blocks, and
// trustedDependencies would replace bun's default list. So this does the same download
// from the package's GitHub release. The binding is N-API: Electron loads it unchanged,
// no rebuild. Runs as our postinstall, since every install of the package wipes it.
// Idempotent: skips if the binding is already there.
//
// On darwin the two arch prebuilds are joined with lipo: the universal app ships one
// node_modules for both slices, and the merger leaves an already-universal file alone.
import { spawnSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const platform = process.platform;
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(projectRoot, 'node_modules', 'node-datachannel');
const target = join(packageDir, 'build', 'Release', 'node_datachannel.node');

if (!existsSync(packageDir)) {
  console.log('node-datachannel is not installed; skipping.');
  process.exit(0);
}
if (existsSync(target)) {
  console.log(`✓ node-datachannel binding already present`);
  process.exit(0);
}

const { version, binary } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const napi = Math.max(...binary.napi_versions);
// prebuild-install names ia32 "x86".
const arches =
  platform === 'darwin' ? ['x64', 'arm64'] : [process.arch === 'ia32' ? 'x86' : process.arch];

const tmp = join(tmpdir(), `datachannel-download-${process.pid}`);
mkdirSync(tmp, { recursive: true });

async function download(url, dest) {
  console.log(`↓ ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  if (!res.body) throw new Error(`Empty body from ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function run(bin, args) {
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${bin} exited ${r.status}`);
}

// GNU tar (often first on PATH in Git Bash) reads "C:" as a remote host. The
// libarchive-based tar.exe shipped in Windows System32 doesn't, so address it explicitly.
const tarBin =
  platform === 'win32' && process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'tar.exe')
    : 'tar';

try {
  const bindings = [];
  for (const arch of arches) {
    const name = `node-datachannel-v${version}-napi-v${napi}-${platform}-${arch}.tar.gz`;
    const archive = join(tmp, name);
    const dir = join(tmp, arch);
    mkdirSync(dir);
    await download(
      `https://github.com/murat-dogan/node-datachannel/releases/download/v${version}/${name}`,
      archive
    );
    run(tarBin, ['-xzf', archive, '-C', dir]);
    bindings.push(join(dir, 'build', 'Release', 'node_datachannel.node'));
  }
  mkdirSync(dirname(target), { recursive: true });
  if (bindings.length > 1) {
    run('lipo', [...bindings, '-create', '-output', target]);
  } else {
    copyFileSync(bindings[0], target);
  }
  console.log(`✓ node-datachannel ${version} binding installed (${platform}-${arches.join('+')})`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
