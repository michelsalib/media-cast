export const NO_SUBTITLES: SubtitlesSelection = {
  type: 'no subtitles',
  name: 'No subtitles',
};

export type SubtitlesSelection =
  // `bitmap`: image-based track (PGS, VobSub…) — can only be shown by burning in.
  | { type: 'internal'; index: number; name: string; bitmap: boolean }
  // `path`: a dropped sidecar, or a file main downloaded/resynced into its cache.
  | { type: 'external'; name: string; path: string }
  | { type: 'no subtitles'; name: 'No subtitles' };

// An external subtitle file known by path (File objects can't name main's cache files).
export interface SubtitlesFile {
  name: string;
  path: string;
}
