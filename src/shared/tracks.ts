import { isBitmapSubtitleCodec } from './subtitles';
import type { TorrentSubtitles, TrackList } from './types';

// The probe fields read here (FFProbeData's streams), so the window and main share this.
type Stream = {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  tags?: { language?: string; title?: string };
};

export interface TrackSource {
  streams: readonly Stream[];
  // The subtitle files of the video's torrent.
  files: readonly TorrentSubtitles[];
  // The subtitle file added to the video, if any.
  externalPath?: string;
  // What is picked: a subtitle track index or file path, and the audio track index.
  subtitles?: string | number;
  audioIndex?: number;
}

// The tracks of a video and the ones picked, as the window and the phone show them.
export function describeTracks({
  streams,
  files,
  externalPath,
  subtitles,
  audioIndex,
}: TrackSource): TrackList {
  const of = (type: string) => streams.filter((s) => s.codec_type === type);
  const file = files.findIndex((f) => f.path === subtitles);
  return {
    audio: of('audio').map((s) => ({
      language: s.tags?.language,
      title: s.tags?.title,
      channels: s.channels,
    })),
    subtitles: of('subtitle').map((s) => ({
      language: s.tags?.language,
      title: s.tags?.title,
      bitmap: isBitmapSubtitleCodec(s.codec_name),
    })),
    externalName: externalPath && fileName(externalPath),
    files: files.map(({ path: _, ...f }) => f),
    selected: {
      audioIndex: audioIndex ?? 0,
      subtitles:
        typeof subtitles === 'number'
          ? subtitles
          : file >= 0
            ? `file:${file}`
            : subtitles !== undefined
              ? 'external'
              : null,
    },
  };
}

// The last part of a local path, on any platform (node:path isn't there in the window).
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
