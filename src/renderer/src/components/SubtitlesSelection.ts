export const NO_SUBTITLES: SubtitlesSelection = {
  type: 'no subtitles',
  name: 'No subtitles',
};

export type SubtitlesSelection =
  | { type: 'internal'; index: number; name: string }
  | { type: 'external'; name: string; file: File }
  | { type: 'no subtitles'; name: 'No subtitles' };
