import type { FFProbeData } from '../main/ffmpeg';
import type { DeviceType } from './types';

// Codecs old DLNA TVs reliably play without re-encoding. Conservative on purpose —
// H.264 + AAC/AC3/MP3 is universal. These lists only apply when the renderer's
// Sink entry for the chosen container is profile-locked (e.g. `DLNA.ORG_PN=AVC_*`).
// When the Sink advertises the MIME with a `*` wildcard in the additional-info
// field, the renderer is signalling "any codec inside this container" and only the
// WILDCARD_UNSUPPORTED_* deny-lists apply — see [[checkCompat]] and [[fetchProtocolInfo]].
export const DIRECT_PLAY_VIDEO_CODECS = new Set(['h264']);
export const DIRECT_PLAY_AUDIO_CODECS = new Set(['aac', 'ac3', 'eac3', 'mp3', 'mp2']);

// A `*` wildcard means the renderer accepts the container, not that it decodes every
// codec inside. These are still refused under a wildcard: DTS and TrueHD were dropped
// by most 2016–2019 TVs (LG included), AV1 only arrived around 2020, and consumer
// H.264 decoders are 8-bit 4:2:0 only (no Hi10P / 4:2:2 / 4:4:4).
export const WILDCARD_UNSUPPORTED_VIDEO_CODECS = new Set(['av1']);
export const WILDCARD_UNSUPPORTED_AUDIO_CODECS = new Set(['dts', 'truehd', 'mlp']);
const H264_DIRECT_PLAY_PIX_FMTS = new Set(['yuv420p', 'yuvj420p']);

// For each source container we know about, the candidate MIME types we'd be willing
// to advertise in the DIDL res `protocolInfo`. The first one the renderer also
// advertises in its Sink wins — that's the one we send to the TV, so the
// protocolInfo we hand out matches an entry the TV claims to accept.
export const CONTAINER_MIMES: Record<string, readonly string[]> = {
  '.mp4': ['video/mp4'],
  '.mkv': ['video/x-matroska'],
  '.avi': ['video/x-msvideo', 'video/avi'],
};

// Last-resort fallback when the renderer didn't return a usable Sink. Direct play
// is allowed for these containers using the first MIME from CONTAINER_MIMES.
export const DIRECT_PLAY_CONTAINERS_FALLBACK = new Set(['.mp4']);

export type CompatIssueKind =
  'container' | 'videoCodec' | 'audioCodec' | 'subtitles' | 'audioTrack';

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
  acceptedVideoMimes?: readonly string[];
  // Subset of acceptedVideoMimes whose Sink entry had a `*` codec wildcard. When
  // the chosen MIME is in this set, the codec allow-list is bypassed.
  acceptedWildcardVideoMimes?: readonly string[];
}

export function checkCompat(input: CompatInput): CompatReport {
  const {
    videoFileName,
    probeData,
    deviceType,
    burnSubtitles,
    audioIndex,
    acceptedVideoMimes,
    acceptedWildcardVideoMimes,
  } = input;
  const container = extractExt(videoFileName);
  const video = probeData.streams.find((s) => s.codec_type === 'video');
  // The track that will actually play, not just the first one.
  const audio = probeData.streams.filter((s) => s.codec_type === 'audio')[audioIndex ?? 0];
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
      detail: acceptedVideoMimes?.length
        ? `Container ${container || 'unknown'} not advertised by renderer`
        : `Container ${container || 'unknown'} not supported for direct play`,
    });
  }

  // If the renderer advertised the chosen MIME with a codec wildcard, swap the
  // codec allow-list for the much shorter WILDCARD_UNSUPPORTED_* deny-list.
  const codecWildcard =
    videoMimeType !== undefined && (acceptedWildcardVideoMimes?.includes(videoMimeType) ?? false);

  if (codecWildcard) {
    if (videoCodec && WILDCARD_UNSUPPORTED_VIDEO_CODECS.has(videoCodec)) {
      issues.push({
        kind: 'videoCodec',
        detail: `Video codec ${videoCodec} is rarely decoded by DLNA TVs`,
      });
    }

    if (audioCodec && WILDCARD_UNSUPPORTED_AUDIO_CODECS.has(audioCodec)) {
      issues.push({
        kind: 'audioCodec',
        detail: `Audio codec ${audioCodec} is not decoded by most DLNA TVs`,
      });
    }
  } else {
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
  }

  // Whatever the Sink says, H.264 decoders in TVs are 8-bit 4:2:0 (no Hi10P, 4:2:2, 4:4:4).
  if (videoCodec === 'h264' && video?.pix_fmt && !H264_DIRECT_PLAY_PIX_FMTS.has(video.pix_fmt)) {
    issues.push({
      kind: 'videoCodec',
      detail: `H.264 ${video.profile ?? ''} ${video.pix_fmt} (TV decoders are 8-bit 4:2:0 only)`,
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
  acceptedVideoMimes: readonly string[] | undefined
): string | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  if (acceptedVideoMimes && acceptedVideoMimes.length > 0) {
    return candidates.find((m) => acceptedVideoMimes.includes(m));
  }
  // No Sink info — fall back to the conservative static container list.
  return DIRECT_PLAY_CONTAINERS_FALLBACK.has(container) ? candidates[0] : undefined;
}

function extractExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}
