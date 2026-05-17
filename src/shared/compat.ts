import type { FFProbeData } from '../main/ffmpeg';
import type { DeviceType } from './types';

// Codecs old DLNA TVs reliably play without re-encoding. Conservative on purpose —
// H.264 + AAC/AC3/MP3 is universal; HEVC is intentionally excluded until we find TVs
// that need it. Container compat is now negotiated per-device via the renderer's
// GetProtocolInfo Sink (see [[fetchProtocolInfo]]); these lists only gate codecs.
export const DIRECT_PLAY_VIDEO_CODECS = new Set(['h264']);
export const DIRECT_PLAY_AUDIO_CODECS = new Set(['aac', 'ac3', 'eac3', 'mp3', 'mp2']);

// For each source container we know about, the candidate MIME types we'd be willing
// to advertise in the DIDL res `protocolInfo`. The first one the renderer also
// advertises in its Sink wins — that's the one we send to the TV, so the
// protocolInfo we hand out matches an entry the TV claims to accept.
export const CONTAINER_MIMES: Record<string, readonly string[]> = {
  '.mp4': ['video/mp4'],
  '.mkv': ['video/x-matroska'],
};

// Last-resort fallback when the renderer didn't return a usable Sink. Direct play
// is allowed for these containers using the first MIME from CONTAINER_MIMES.
export const DIRECT_PLAY_CONTAINERS_FALLBACK = new Set(['.mp4']);

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
  // The MIME type to advertise in the DIDL res when direct-playing. Undefined when
  // transcoding (caller uses MPEG-TS) or when we can't pick one.
  videoMimeType?: string;
  issues: CompatIssue[];
}

export interface CompatInput {
  videoFileName: string;
  probeData: FFProbeData;
  deviceType: DeviceType;
  burnSubtitles: boolean;
  audioIndex: number | undefined;
  // MIMEs the renderer advertised in its ConnectionManager Sink. Empty/undefined
  // means we never got a usable answer — fall back to the static container list.
  acceptedVideoMimes?: ReadonlySet<string>;
}

export function checkCompat(input: CompatInput): CompatReport {
  const { videoFileName, probeData, deviceType, burnSubtitles, audioIndex, acceptedVideoMimes } =
    input;
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

  const candidates = CONTAINER_MIMES[container] ?? [];
  const videoMimeType = pickVideoMime(container, candidates, acceptedVideoMimes);
  if (!videoMimeType) {
    issues.push({
      kind: 'container',
      detail: acceptedVideoMimes?.size
        ? `Container ${container || 'unknown'} not advertised by renderer`
        : `Container ${container || 'unknown'} not supported for direct play`,
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

  return {
    needsTranscoding: issues.length > 0,
    container,
    videoCodec,
    audioCodec,
    videoMimeType: issues.length > 0 ? undefined : videoMimeType,
    issues,
  };
}

function pickVideoMime(
  container: string,
  candidates: readonly string[],
  acceptedVideoMimes: ReadonlySet<string> | undefined
): string | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  if (acceptedVideoMimes && acceptedVideoMimes.size > 0) {
    return candidates.find((m) => acceptedVideoMimes.has(m));
  }
  // No Sink info — fall back to the conservative static container list.
  return DIRECT_PLAY_CONTAINERS_FALLBACK.has(container) ? candidates[0] : undefined;
}

function extractExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}
