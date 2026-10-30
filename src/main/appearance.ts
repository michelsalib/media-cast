import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow, nativeTheme, systemPreferences } from 'electron';
import type { Appearance, ThemeSource } from '../shared/types';

// Light/dark/system choice, applied through nativeTheme so the renderer's
// `prefers-color-scheme` follows it. The renderer derives every colour itself.

const THEME_SOURCES: readonly ThemeSource[] = ['system', 'light', 'dark'];

function settingsPath(): string {
  return join(app.getPath('userData'), 'appearance.json');
}

export function loadThemeSource(): void {
  try {
    const { themeSource } = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    if (THEME_SOURCES.includes(themeSource)) nativeTheme.themeSource = themeSource;
  } catch {
    // No file yet: follow the system.
  }
}

export function setThemeSource(themeSource: ThemeSource): void {
  if (!THEME_SOURCES.includes(themeSource)) return;
  nativeTheme.themeSource = themeSource;
  writeFileSync(settingsPath(), JSON.stringify({ themeSource }));
}

// getAccentColor returns `RRGGBBAA`; Windows and macOS only.
function accentColor(): string | undefined {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return undefined;
  try {
    const color = systemPreferences.getAccentColor();
    return /^[0-9a-f]{6}/i.test(color) ? `#${color.slice(0, 6).toLowerCase()}` : undefined;
  } catch {
    return undefined;
  }
}

export function appearance(): Appearance {
  return { themeSource: nativeTheme.themeSource, accentColor: accentColor() };
}

// Until the renderer sends its own surface colour.
export function initialWindowColors(): { color: string; symbolColor: string } {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#121416', symbolColor: '#e2e2e5' }
    : { color: '#f8f9fb', symbolColor: '#1a1c1e' };
}

// The caption buttons (min/max/close) are drawn by Windows; match them to the app.
export function setTitleBarColors(window: BrowserWindow, color: string, symbolColor: string): void {
  if (process.platform === 'darwin' || window.isDestroyed()) return;
  window.setTitleBarOverlay({ color, symbolColor, height: 32 });
  window.setBackgroundColor(color);
}

// Windows only: macOS has no change event for the accent colour.
export function onAccentColorChanged(callback: (color: string) => void): void {
  systemPreferences.on('accent-color-changed', () => {
    const color = accentColor();
    if (color) callback(color);
  });
}
