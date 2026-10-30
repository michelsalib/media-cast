import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import {
  DEFAULT_SUBTITLE_LANGUAGES,
  type SubtitleSettingsPatch,
  type SubtitleSettingsView,
} from '../../shared/subtitleSearch';

// The app's own API keys, injected at build time (.env.local in dev, repo secrets in
// CI) so they never land in git. A key typed in settings overrides them.
const BUILT_IN_OPENSUBTITLES_API_KEY = import.meta.env.MAIN_VITE_OPENSUBTITLES_API_KEY ?? '';
const BUILT_IN_SUBDL_API_KEY = import.meta.env.MAIN_VITE_SUBDL_API_KEY ?? '';

interface StoredSettings {
  languages: string[];
  opensubtitles: { username: string; apiKey: string; password?: StoredSecret };
  subdl: { apiKey: string };
}

// safeStorage (DPAPI / Keychain / libsecret) when the OS offers it; plain text on a
// Linux box without a keyring rather than refusing to remember the password.
type StoredSecret = { encrypted: string } | { plain: string };

export interface SubtitleSettings {
  languages: string[];
  opensubtitles: { apiKey: string; username: string; password: string };
  subdl: { apiKey: string };
}

const DEFAULTS: StoredSettings = {
  languages: DEFAULT_SUBTITLE_LANGUAGES,
  opensubtitles: { username: '', apiKey: '' },
  subdl: { apiKey: '' },
};

function settingsPath(): string {
  return join(app.getPath('userData'), 'subtitle-settings.json');
}

async function readStored(): Promise<StoredSettings> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<StoredSettings>;
    return {
      languages: parsed.languages?.length ? parsed.languages : DEFAULTS.languages,
      opensubtitles: { ...DEFAULTS.opensubtitles, ...parsed.opensubtitles },
      subdl: { ...DEFAULTS.subdl, ...parsed.subdl },
    };
  } catch {
    return DEFAULTS;
  }
}

function encodeSecret(value: string): StoredSecret {
  return safeStorage.isEncryptionAvailable()
    ? { encrypted: safeStorage.encryptString(value).toString('base64') }
    : { plain: value };
}

function decodeSecret(secret: StoredSecret | undefined): string {
  if (!secret) return '';
  if ('plain' in secret) return secret.plain;
  try {
    return safeStorage.decryptString(Buffer.from(secret.encrypted, 'base64'));
  } catch {
    // Encrypted under another OS user or a reset keyring: ask for it again.
    return '';
  }
}

export async function loadSubtitleSettings(): Promise<SubtitleSettings> {
  const stored = await readStored();
  return {
    languages: stored.languages,
    opensubtitles: {
      apiKey: stored.opensubtitles.apiKey || BUILT_IN_OPENSUBTITLES_API_KEY,
      username: stored.opensubtitles.username,
      password: decodeSecret(stored.opensubtitles.password),
    },
    subdl: { apiKey: stored.subdl.apiKey || BUILT_IN_SUBDL_API_KEY },
  };
}

export async function subtitleSettingsView(): Promise<SubtitleSettingsView> {
  const stored = await readStored();
  return {
    languages: stored.languages,
    opensubtitles: {
      username: stored.opensubtitles.username,
      hasPassword: !!stored.opensubtitles.password,
      apiKey: stored.opensubtitles.apiKey,
      hasBuiltInApiKey: !!BUILT_IN_OPENSUBTITLES_API_KEY,
    },
    subdl: { apiKey: stored.subdl.apiKey, hasBuiltInApiKey: !!BUILT_IN_SUBDL_API_KEY },
  };
}

// `password: ''` clears the stored password; leaving it out keeps it.
export async function saveSubtitleSettings(
  patch: SubtitleSettingsPatch
): Promise<SubtitleSettingsView> {
  const stored = await readStored();
  const { password, ...opensubtitles } = patch.opensubtitles ?? {};
  const next: StoredSettings = {
    languages: patch.languages?.length ? patch.languages : stored.languages,
    opensubtitles: { ...stored.opensubtitles, ...opensubtitles },
    subdl: { ...stored.subdl, ...patch.subdl },
  };
  if (password !== undefined) {
    next.opensubtitles.password = password ? encodeSecret(password) : undefined;
  }
  await writeFile(settingsPath(), JSON.stringify(next, null, 2));
  return subtitleSettingsView();
}
