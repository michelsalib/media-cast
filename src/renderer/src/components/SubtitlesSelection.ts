import type { FFProbeData } from '../../../main/ffmpeg';
import { isBitmapSubtitleCodec } from '../../../shared/subtitles';
import type { DeviceType } from '../../../shared/types';
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

export function externalSelection(f: SubtitlesFile): SubtitlesSelection {
  return { type: 'external', name: f.name, path: f.path };
}

// Chromecast always direct-plays with sidecar WebVTT, so image-based tracks have no
// path to the screen there.
export function isSupported(c: SubtitlesSelection, deviceType: DeviceType | undefined): boolean {
  return !(c.type === 'internal' && c.bitmap && deviceType === 'chromecast');
}

// What a new video starts with: the added file, else the first track the screen can show.
export function defaultSubtitles(
  internal: SubtitlesSelection[],
  added: SubtitlesFile | undefined,
  deviceType: DeviceType | undefined
): SubtitlesSelection {
  return (
    (added && externalSelection(added)) ??
    internal.find((c) => isSupported(c, deviceType)) ??
    NO_SUBTITLES
  );
}

// What main's `load` takes: a file path, a track index, or none.
export function subtitlesArg(selection: SubtitlesSelection): string | number | undefined {
  return selection.type === 'external'
    ? selection.path
    : selection.type === 'internal'
      ? selection.index
      : undefined;
}
