// Online subtitle search: types shared by main (providers) and the renderer (dialogs).

export type SubtitleProviderId = 'opensubtitles' | 'subdl' | 'gestdown';

export const SUBTITLE_PROVIDER_NAMES: Record<SubtitleProviderId, string> = {
  opensubtitles: 'OpenSubtitles',
  subdl: 'Subdl',
  gestdown: 'Addic7ed (Gestdown)',
};

export interface SubtitleQuery {
  title: string;
  year?: number;
  // Both set for an episode; both unset for a movie.
  season?: number;
  episode?: number;
  // ISO 639-1 codes from SUBTITLE_LANGUAGES.
  languages: string[];
}

export interface SubtitleSearchResult {
  provider: SubtitleProviderId;
  // Opaque to the renderer: what the provider needs to download this entry.
  ref: string;
  language: string;
  release: string;
  hearingImpaired: boolean;
  // OpenSubtitles only: matched by file hash, i.e. timed for this exact release.
  hashMatch: boolean;
  downloads?: number;
}

export interface SubtitleSearchResponse {
  results: SubtitleSearchResult[];
  // One entry per provider that failed or was skipped, shown next to the results.
  notices: { provider: SubtitleProviderId; message: string }[];
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

// Linear retiming: t' = t * ratio + offset. `ratio` fixes frame-rate mismatches
// (PAL speed-up), `offset` fixes a constant delay.
export interface SubtitleTiming {
  offset: number;
  ratio: number;
}

// What the settings dialog sees. Secrets go one way: the renderer can set them but only
// learns whether one is stored.
export interface SubtitleSettingsView {
  languages: string[];
  opensubtitles: {
    username: string;
    hasPassword: boolean;
    // A key typed in settings, overriding the one built into the app.
    apiKey: string;
    hasBuiltInApiKey: boolean;
  };
  subdl: { apiKey: string; hasBuiltInApiKey: boolean };
}

export interface SubtitleSettingsPatch {
  languages?: string[];
  opensubtitles?: { username?: string; password?: string; apiKey?: string };
  subdl?: { apiKey?: string };
}

export interface SubtitleLanguage {
  code: string;
  name: string;
}

// ISO 639-1, plus pt-br. Names double as Addic7ed's language names.
export const SUBTITLE_LANGUAGES: readonly SubtitleLanguage[] = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pt-br', name: 'Portuguese (Brazilian)' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'pl', name: 'Polish' },
  { code: 'cs', name: 'Czech' },
  { code: 'sk', name: 'Slovak' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'el', name: 'Greek' },
  { code: 'hr', name: 'Croatian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ru', name: 'Russian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'he', name: 'Hebrew' },
  { code: 'fa', name: 'Persian' },
  { code: 'hi', name: 'Hindi' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
];

export const DEFAULT_SUBTITLE_LANGUAGES = ['en'];

export function subtitleLanguageName(code: string): string {
  return SUBTITLE_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
