import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

// Binaries live under resources/bin/<platform>-<arch>/. In dev that's <projectRoot>/resources/bin/,
// in packaged builds it's <process.resourcesPath>/bin/ (via electron-builder extraResources).
// Returns undefined when no bundled binary is found — caller falls back to PATH.
export function resolveBundledBinary(name: 'ffmpeg' | 'ffprobe'): string | undefined {
  const binDir = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
  const ext = process.platform === 'win32' ? '.exe' : '';
  const fullPath = path.join(binDir, `${process.platform}-${process.arch}`, `${name}${ext}`);
  return existsSync(fullPath) ? fullPath : undefined;
}
