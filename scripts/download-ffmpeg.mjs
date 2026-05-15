#!/usr/bin/env node
// Downloads static ffmpeg + ffprobe binaries for the current platform/arch into
// resources/bin/<platform>-<arch>/. Idempotent: skips if both binaries are already present.
//
// Used by CI (after npm install, before electron-builder) and locally as `npm run prepare:binaries`.
//
// Sources:
//   - win32-x64:   https://github.com/GyanD/codexffmpeg (release-essentials, static GPL)
//   - darwin-*:    https://evermeet.cx/ffmpeg/ (x86_64 only; runs under Rosetta on arm64)
//   - linux-x64:   https://johnvansickle.com/ffmpeg/ (release static)
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const platform = process.platform;
const arch = process.arch;
const ext = platform === 'win32' ? '.exe' : '';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = join(projectRoot, 'resources', 'bin', `${platform}-${arch}`);
const ffmpegPath = join(targetDir, `ffmpeg${ext}`);
const ffprobePath = join(targetDir, `ffprobe${ext}`);

if (existsSync(ffmpegPath) && existsSync(ffprobePath)) {
  console.log(`✓ Binaries already present: ${targetDir}`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });

const tmp = join(tmpdir(), `ffmpeg-download-${process.pid}`);
mkdirSync(tmp, { recursive: true });

async function download(url, dest) {
  console.log(`↓ ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  if (!res.body) throw new Error(`Empty body from ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function findGitHubAsset(repo, namePattern) {
  const headers = process.env.GITHUB_TOKEN
    ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {};
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo}`);
  const release = await res.json();
  const asset = release.assets.find((a) => namePattern.test(a.name));
  if (!asset) {
    throw new Error(`No asset matching ${namePattern} in ${repo} (release ${release.tag_name})`);
  }
  return asset.browser_download_url;
}

function extract(archive, dest) {
  // GNU tar (often first on PATH in Git Bash) cannot unzip. The libarchive-based
  // tar.exe shipped in Windows System32 does, so address it explicitly.
  const tarBin =
    platform === 'win32' && process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32', 'tar.exe')
      : 'tar';
  const r = spawnSync(tarBin, ['-xf', archive, '-C', dest], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`tar exited ${r.status} on ${archive}`);
}

function findFile(dir, name) {
  for (const item of readdirSync(dir)) {
    const p = join(dir, item);
    const s = statSync(p);
    if (s.isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    } else if (item === name) {
      return p;
    }
  }
  return null;
}

try {
  if (platform === 'win32' && arch === 'x64') {
    const zip = join(tmp, 'ffmpeg.zip');
    const url = await findGitHubAsset('GyanD/codexffmpeg', /-essentials_build\.zip$/);
    await download(url, zip);
    extract(zip, tmp);
    const ff = findFile(tmp, 'ffmpeg.exe');
    const fp = findFile(tmp, 'ffprobe.exe');
    if (!ff || !fp) throw new Error('Could not locate ffmpeg.exe / ffprobe.exe in archive');
    copyFileSync(ff, ffmpegPath);
    copyFileSync(fp, ffprobePath);
  } else if (platform === 'darwin') {
    const ffZip = join(tmp, 'ffmpeg.zip');
    const fpZip = join(tmp, 'ffprobe.zip');
    await download('https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip', ffZip);
    await download('https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip', fpZip);
    extract(ffZip, targetDir);
    extract(fpZip, targetDir);
    chmodSync(ffmpegPath, 0o755);
    chmodSync(ffprobePath, 0o755);
  } else if (platform === 'linux' && arch === 'x64') {
    const archive = join(tmp, 'ffmpeg.tar.xz');
    await download(
      'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
      archive
    );
    extract(archive, tmp);
    const ff = findFile(tmp, 'ffmpeg');
    const fp = findFile(tmp, 'ffprobe');
    if (!ff || !fp) throw new Error('Could not locate ffmpeg / ffprobe in archive');
    copyFileSync(ff, ffmpegPath);
    copyFileSync(fp, ffprobePath);
    chmodSync(ffmpegPath, 0o755);
    chmodSync(ffprobePath, 0o755);
  } else {
    console.warn(`No download source defined for ${platform}-${arch}; skipping.`);
    process.exit(0);
  }
  console.log(`✓ ffmpeg + ffprobe installed in ${targetDir}`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
