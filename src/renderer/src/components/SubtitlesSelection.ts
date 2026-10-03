export const NO_SUBTITLES: SubtitlesSelection = {
  type: 'no subtitles',
  name: 'No subtitles',
};

export type SubtitlesSelection =
  // `bitmap`: image-based track (PGS, VobSub…) — can only be shown by burning in.
  | { type: 'internal'; index: number; name: string; bitmap: boolean }
  | { type: 'external'; name: string; file: File }
  | { type: 'no subtitles'; name: 'No subtitles' };
