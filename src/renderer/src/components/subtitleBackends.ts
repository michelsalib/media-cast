import type { ReleaseInfo } from '../../../main/subtitles/releaseName';
import type {
  SubtitleCue,
  SubtitleQuery,
  SubtitleSearchResponse,
  SubtitleSearchResult,
  SubtitleTiming,
} from '../../../shared/subtitleSearch';

// What the subtitle search and timing dialogs act through, so the window (over IPC, for
// the video ready or playing) and the phone remote (over HTTP) draw the same dialogs.

export interface SubtitleSearchBackend {
  // The query guessed from the file name, and the languages set in the settings.
  guess(): Promise<{ guess: ReleaseInfo; languages: string[] }>;
  search(query: SubtitleQuery): Promise<SubtitleSearchResponse>;
  // Downloads a result and puts it to use (the caller decides how).
  download(
    result: SubtitleSearchResult,
    episode: Pick<SubtitleQuery, 'season' | 'episode'>
  ): Promise<void>;
  // Whether the languages, accounts and API keys can be set from here (the computer only).
  settings: boolean;
}

// The preview a timing fix plays: a URL Chromium plays as is, if it can, else one that
// restarts the stream at `?t=` seconds.
export interface PreviewUrls {
  directUrl?: string;
  transcodeUrl: string;
  duration: number;
}

export interface SubtitleSyncBackend {
  start(): Promise<{ preview: PreviewUrls; cues: SubtitleCue[] }>;
  stop(): void;
  // Uses the subtitles with `timing`; `changed` false: as they are.
  apply(timing: SubtitleTiming, changed: boolean): Promise<void>;
}
