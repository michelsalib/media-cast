import type { FFProbeData } from '../../../main/ffmpeg';
import { isBitmapSubtitleCodec } from '../../../shared/subtitles';
import { subtitleTrackName } from '../labels';

export const NO_SUBTITLES: SubtitlesSelection = {
  type: 'no subtitles',
  name: 'No subtitles',
};

export type SubtitlesSelection =
  // `bitmap`: image-based track (PGS, VobSub…) — can only be shown by burning in.
  | { type: 'internal'; index: number; name: string; bitmap: boolean }
  // `path`: a dropped sidecar, or a file main downloaded/resynced into its cache.
  // `label`: set for the files that came with a torrent.
  | { type: 'external'; name: string; path: string; label?: string }
  | { type: 'no subtitles'; name: 'No subtitles' };

// An external subtitle file known by path (File objects can't name main's cache files).
export interface SubtitlesFile {
  name: string;
  path: string;
  // For the files of a torrent: what sets it apart, and where it is in the torrent.
  label?: string;
  folder?: string;
}

export function internalSubtitles(probeData: FFProbeData): SubtitlesSelection[] {
  return probeData.streams
    .filter((s) => s.codec_type === 'subtitle')
    .map((s, i) => ({
      type: 'internal',
      index: i,
      name: subtitleTrackName({ ...s.tags }, i),
      bitmap: isBitmapSubtitleCodec(s.codec_name),
    }));
}

export function bundledSelection(f: SubtitlesFile): SubtitlesSelection {
  return { type: 'external', name: f.name, path: f.path, label: f.label };
}
