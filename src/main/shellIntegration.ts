import { execFile } from 'node:child_process';
import { existsSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { app, shell } from 'electron';
import { SUBTITLE_EXTENSIONS, TORRENT_EXTENSIONS, VIDEO_EXTENSIONS } from '../shared/media';
import type { OpenedItem, ShellIntegration, ShellIntegrationKey } from '../shared/types';

// Windows Explorer entries for videos and torrents, each switched on or off from the
// settings menu: "Open with", a "Cast with Media Cast" verb, and "Send to". All per-user
// (HKCU, %APPDATA%), so no elevation; the registry is the source of truth, nothing is
// stored. The uninstaller removes them too (build/installer.nsh, keep both in sync).

const run = promisify(execFile);

const VIDEO_PROGID = 'MediaCast.Video';
const TORRENT_PROGID = 'MediaCast.Torrent';
const VERB = 'MediaCast';
const OPENABLE = [...VIDEO_EXTENSIONS, ...TORRENT_EXTENSIONS];
const CLASSES = 'HKEY_CURRENT_USER\\Software\\Classes';

// Dev runs electron.exe with the project as its first argument.
function command(): string {
  const exe = `"${process.execPath}"`;
  return process.defaultApp ? `${exe} "${app.getAppPath()}" "%1"` : `${exe} "%1"`;
}

function sendToPath(): string {
  return join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo', 'Media Cast.lnk');
}

// .reg string literal: backslashes and quotes escaped.
function regString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// One `reg import` per change: a .reg file both writes and deletes (`[-key]`, `"v"=-`).
async function importReg(lines: string[]): Promise<void> {
  const file = join(app.getPath('temp'), `media-cast-shell-${process.pid}.reg`);
  const text = ['Windows Registry Editor Version 5.00', '', ...lines, ''].join('\r\n');
  // regedit format 5 is UTF-16LE with a BOM.
  writeFileSync(file, `﻿${text}`, 'utf16le');
  try {
    await run('reg', ['import', file], { windowsHide: true });
  } finally {
    rmSync(file, { force: true });
  }
}

function openWithLines(on: boolean): string[] {
  const lines: string[] = [];
  const progIds: [string, string, string[]][] = [
    [VIDEO_PROGID, 'Video', VIDEO_EXTENSIONS],
    [TORRENT_PROGID, 'Torrent', TORRENT_EXTENSIONS],
  ];
  for (const [progId, label, extensions] of progIds) {
    const key = `${CLASSES}\\${progId}`;
    if (on) {
      lines.push(
        `[${key}]`,
        `@=${regString(label)}`,
        '',
        `[${key}\\DefaultIcon]`,
        `@=${regString(`"${process.execPath}",0`)}`,
        '',
        `[${key}\\shell\\open\\command]`,
        `@=${regString(command())}`,
        ''
      );
    } else {
      lines.push(`[-${key}]`, '');
    }
    for (const ext of extensions) {
      lines.push(
        `[${CLASSES}\\${ext}\\OpenWithProgids]`,
        on ? `${regString(progId)}=hex(0):` : `${regString(progId)}=-`,
        ''
      );
    }
  }
  // The name Explorer shows for the exe in "Open with"; otherwise its FileDescription.
  if (!process.defaultApp) {
    const key = `${CLASSES}\\Applications\\${basename(process.execPath)}`;
    lines.push(on ? `[${key}]` : `[-${key}]`);
    if (on) lines.push(`"FriendlyAppName"=${regString('Media Cast')}`);
    lines.push('');
  }
  return lines;
}

function contextMenuLines(on: boolean): string[] {
  const lines: string[] = [];
  for (const ext of OPENABLE) {
    const key = `${CLASSES}\\SystemFileAssociations\\${ext}\\shell\\${VERB}`;
    if (on) {
      lines.push(
        `[${key}]`,
        `"MUIVerb"=${regString('Cast with Media Cast')}`,
        `"Icon"=${regString(`"${process.execPath}",0`)}`,
        '',
        `[${key}\\command]`,
        `@=${regString(command())}`,
        ''
      );
    } else {
      lines.push(`[-${key}]`, '');
    }
  }
  return lines;
}

function writeSendTo(on: boolean): void {
  const link = sendToPath();
  if (!on) {
    if (existsSync(link)) unlinkSync(link);
    return;
  }
  const ok = shell.writeShortcutLink(link, {
    target: process.execPath,
    args: process.defaultApp ? `"${app.getAppPath()}"` : '',
    icon: process.execPath,
    iconIndex: 0,
    description: 'Cast with Media Cast',
  });
  if (!ok) throw new Error('Could not create the Send to shortcut');
}

async function keyExists(key: string): Promise<boolean> {
  try {
    await run('reg', ['query', key], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

// null off Windows: the settings menu then hides the section.
export async function shellIntegration(): Promise<ShellIntegration | null> {
  if (process.platform !== 'win32') return null;
  const [openWith, contextMenu] = await Promise.all([
    keyExists(`${CLASSES}\\${VIDEO_PROGID}\\shell\\open\\command`),
    keyExists(`${CLASSES}\\SystemFileAssociations\\${VIDEO_EXTENSIONS[0]}\\shell\\${VERB}`),
  ]);
  return { openWith, contextMenu, sendTo: existsSync(sendToPath()) };
}

export async function setShellIntegration(
  key: ShellIntegrationKey,
  on: boolean
): Promise<ShellIntegration | null> {
  if (process.platform !== 'win32') return null;
  if (key === 'openWith') await importReg(openWithLines(on));
  else if (key === 'contextMenu') await importReg(contextMenuLines(on));
  else writeSendTo(on);
  return shellIntegration();
}

// At startup: rewrite what is switched on, so the entries follow the exe if the app
// was reinstalled elsewhere (or switched between dev and installed).
export async function refreshShellIntegration(): Promise<void> {
  const current = await shellIntegration();
  if (!current) return;
  const lines = [
    ...(current.openWith ? openWithLines(true) : []),
    ...(current.contextMenu ? contextMenuLines(true) : []),
  ];
  if (lines.length > 0) await importReg(lines);
  if (current.sendTo) writeSendTo(true);
}

// The files and magnet links in a command line (this launch's, or a second instance's,
// as Explorer starts the exe once per file). Anything else (Chromium switches, the dev
// project path) is skipped; Send to passes any file, so subtitles are let through too
// and the window sorts them like a drop.
export function openedItems(argv: readonly string[]): OpenedItem[] {
  const items: OpenedItem[] = [];
  for (const arg of argv.slice(1)) {
    if (/^magnet:\?/i.test(arg)) {
      items.push({ name: arg, path: arg });
      continue;
    }
    const ext = extname(arg).toLowerCase();
    if (arg.startsWith('-') || ![...OPENABLE, ...SUBTITLE_EXTENSIONS].includes(ext)) continue;
    try {
      const stats = statSync(arg);
      if (stats.isFile()) items.push({ name: basename(arg), path: arg, size: stats.size });
    } catch {
      // Not a path.
    }
  }
  return items;
}
