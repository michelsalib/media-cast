import type { FFProbeData } from '../main/ffmpeg';
import type { DeviceType } from './types';

// Codecs old DLNA TVs reliably play in an MP4 container without re-encoding.
// Conservative on purpose — H.264 + AAC/AC3/MP3 is universal; HEVC and other
// containers are intentionally excluded until we find TVs that need them.
export const DIRECT_PLAY_VIDEO_CODECS = new Set(['h264']);
export const DIRECT_PLAY_AUDIO_CODECS = new Set(['aac', 'ac3', 'eac3', 'mp3', 'mp2']);
export const DIRECT_PLAY_CONTAINERS = new Set(['.mp4']);

export type CompatIssueKind =
  | 'container'
  | 'videoCodec'
  | 'audioCodec'
  | 'subtitles'
  | 'audioTrack';

export interface CompatIssue {
  kind: CompatIssueKind;
  detail: string;
}

export interface CompatReport {
  needsTranscoding: boolean;
  container: string;
  videoCodec?: string;
  audioCodec?: string;
  issues: CompatIssue[];
}

export interface CompatInput {
  videoFileName: string;
  probeData: FFProbeData;
  deviceType: DeviceType;
  burnSubtitles: boolean;
  audioIndex: number | undefined;
}

export function checkCompat(input: CompatInput): CompatReport {
  const { videoFileName, probeData, deviceType, burnSubtitles, audioIndex } = input;
  const container = extractExt(videoFileName);
  const video = probeData.streams.find((s) => s.codec_type === 'video');
  const audio = probeData.streams.find((s) => s.codec_type === 'audio');
  const videoCodec = video?.codec_name;
  const audioCodec = audio?.codec_name;

  if (deviceType === 'chromecast') {
    return { needsTranscoding: false, container, videoCodec, audioCodec, issues: [] };
  }

  const issues: CompatIssue[] = [];

  if (burnSubtitles) {
    issues.push({
      kind: 'subtitles',
      detail: 'Burning subtitles into the video stream',
    });
  }

  if (audioIndex !== undefined && audioIndex !== 0) {
    issues.push({
      kind: 'audioTrack',
      detail: 'Non-default audio track requires re-encoding',
    });
  }

  if (!DIRECT_PLAY_CONTAINERS.has(container)) {
    issues.push({
      kind: 'container',
      detail: `Container ${container || 'unknown'} (only .mp4 plays directly)`,
    });
  }

  if (!videoCodec || !DIRECT_PLAY_VIDEO_CODECS.has(videoCodec)) {
    issues.push({
      kind: 'videoCodec',
      detail: `Video codec ${videoCodec ?? 'unknown'} (only h264 plays directly)`,
    });
  }

  if (!audioCodec || !DIRECT_PLAY_AUDIO_CODECS.has(audioCodec)) {
    issues.push({
      kind: 'audioCodec',
      detail: `Audio codec ${audioCodec ?? 'unknown'} (only AAC/AC3/EAC3/MP3/MP2 play directly)`,
    });
  }

  return { needsTranscoding: issues.length > 0, container, videoCodec, audioCodec, issues };
}

function extractExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}
