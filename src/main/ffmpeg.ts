import { execFile, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

// Paths to the ffmpeg/ffprobe binaries. Callers must invoke configureBinaries()
// at startup (main process does this via [[resolveBundledBinary]]). Default to
// PATH lookup so unit-test or script entry points still work before configuration.
let ffmpegPath = 'ffmpeg';
let ffprobePath = 'ffprobe';

export function configureBinaries(paths: { ffmpegPath: string; ffprobePath: string }): void {
  ffmpegPath = paths.ffmpegPath;
  ffprobePath = paths.ffprobePath;
}

export function getBinaryPaths(): { ffmpegPath: string; ffprobePath: string } {
  return { ffmpegPath, ffprobePath };
}

async function runFfmpeg(args: string[]): Promise<Buffer> {
  const { stdout } = await promisify(execFile)(ffmpegPath, args, { encoding: 'buffer' });
  return stdout;
}

export interface FFProbeData {
  streams: {
    index: number;
    codec_name: string;
    codec_long_name: string;
    codec_type: 'subtitle' | 'audio' | 'video';
    width?: number;
    height?: number;
    color_transfer?: string;
    tags: {
      language?: string;
      title?: string;
    };
  }[];
  format: {
    filename: string;
    nb_streams: number;
    format_name: string;
    format_long_name: string;
    duration: string;
    size: string;
    bit_rate: string;
  };
}

export type SubtitleFormat = 'vtt' | 'srt' | 'smi';

export type SubtitleSource =
  | { source: 'external'; path: string }
  | {
      source: 'internal';
      videoPath: string;
      trackIndex: number;
      // Set for image-based tracks (PGS, VobSub, DVB). libass can't render them, so
      // burn-in goes through `overlay` instead. `canvas` is the track's presentation
      // size, often larger than the video when the encode cropped the letterbox.
      bitmap?: { canvas?: VideoSize };
    };

// PQ (HDR10 / Dolby Vision base layer) and HLG need tone mapping once squeezed into
// 8-bit BT.709 — otherwise the picture comes out grey and washed out.
export function isHdrTransfer(colorTransfer: string | undefined): boolean {
  return colorTransfer === 'smpte2084' || colorTransfer === 'arib-std-b67';
}

export function extractSubtitles(source: SubtitleSource, format: 'srt' | 'vtt'): Promise<Buffer> {
  const inputPath = source.source === 'internal' ? source.videoPath : source.path;
  const args = ['-i', inputPath];
  if (source.source === 'internal') {
    args.push('-map', `0:s:${source.trackIndex}`);
  }
  args.push('-f', format === 'vtt' ? 'webvtt' : 'srt', 'pipe:1');
  return runFfmpeg(args);
}

export async function getFfmpegVersion(): Promise<string> {
  const { stdout } = await promisify(execFile)(ffmpegPath, ['-version']);
  // First line: e.g. "ffmpeg version 7.0 Copyright (c) 2000-2024 the FFmpeg developers"
  return stdout.split('\n')[0].trim();
}

export async function probe(videoPath: string): Promise<FFProbeData> {
  const data = await promisify(execFile)(ffprobePath, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-i',
    videoPath,
  ]);

  return JSON.parse(data.stdout);
}

// Bitmap subtitle tracks report no size under the default probe window — the first
// packet usually sits seconds in. Probe just that stream with a wider window.
export async function probeSubtitleCanvas(
  videoPath: string,
  trackIndex: number
): Promise<VideoSize | undefined> {
  try {
    const { stdout } = await promisify(execFile)(ffprobePath, [
      '-v',
      'quiet',
      '-analyzeduration',
      '100M',
      '-probesize',
      '100M',
      '-select_streams',
      `s:${trackIndex}`,
      '-show_entries',
      'stream=width,height',
      '-print_format',
      'json',
      '-i',
      videoPath,
    ]);
    const stream = JSON.parse(stdout).streams?.[0];
    return stream?.width && stream?.height
      ? { width: stream.width, height: stream.height }
      : undefined;
  } catch {
    return undefined;
  }
}

export function thumbnail(videoPath: string, width = 800, height = 600): Promise<Buffer> {
  return runFfmpeg([
    '-i',
    videoPath,
    '-ss',
    '00:01:00',
    '-frames:v',
    '1',
    '-f',
    'image2',
    '-s',
    `${width}x${height}`,
    'pipe:1',
  ]);
}

export interface VideoSize {
  width: number;
  height: number;
}

export interface TranscodeOptions {
  videoPath: string;
  seekSeconds?: number;
  burnSubtitles?: SubtitleSource;
  videoSize?: VideoSize;
  audioTrackIndex?: number;
  hdr?: boolean;
}

export interface TranscodeHandle {
  stream: Readable;
  kill: () => void;
}

/**
 * Transcodes any video to H.264 + AAC in an MPEG-TS stream piped on stdout.
 * Tuned for old DLNA TV decoders: High@4.0, no sliced threading, closed pix_fmt.
 * Returns a Readable for the caller to pipe somewhere, plus a kill function.
 */
export async function transcodeToMpegTs(options: TranscodeOptions): Promise<TranscodeHandle> {
  const {
    videoPath,
    seekSeconds = 0,
    burnSubtitles,
    videoSize,
    audioTrackIndex = 0,
    hdr = false,
  } = options;

  const args: string[] = [];
  if (seekSeconds > 0) {
    // -copyts keeps the original input PTS through the pipeline so the subtitles filter
    // overlays the right cue and the renderer reports the real position.
    args.push('-ss', String(seekSeconds), '-copyts');
  }
  args.push('-i', videoPath);

  // Crop to multiples of 16 (the H.264 macroblock size) so the stream needs no
  // cropping rectangle — one less thing for weak TV decoders to get wrong. Subtitles
  // are placed after the crop so libass scales against the actual rendered height.
  const videoFilters: string[] = [];
  if (hdr) {
    videoFilters.push(HDR_TONEMAP_FILTER);
  }
  videoFilters.push('crop=trunc(iw/16)*16:trunc(ih/16)*16');
  const croppedSize = videoSize ? alignTo16(videoSize) : undefined;

  if (burnSubtitles?.source === 'internal' && burnSubtitles.bitmap) {
    const graph = buildBitmapOverlayGraph(
      videoFilters,
      burnSubtitles.trackIndex,
      burnSubtitles.bitmap.canvas,
      croppedSize
    );
    args.push('-filter_complex', graph, '-map', '[out]');
  } else {
    if (burnSubtitles) {
      videoFilters.push(buildSubtitlesFilter(burnSubtitles, croppedSize));
    }
    args.push('-vf', videoFilters.join(','), '-map', '0:v:0');
  }

  args.push(
    '-map',
    `0:a:${audioTrackIndex}?`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'high',
    '-level',
    '4.0',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '60',
    // Disable sliced threading: per-slice corruption on weak decoders shows as a band of
    // garbage (~1/4 of the screen). Frame-level threading still works.
    '-x264-params',
    'sliced-threads=0',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-b:a',
    '192k',
    '-f',
    'mpegts',
    // Keep the muxer's default delay (0.7s). With -muxdelay 0 most frames finish
    // arriving after their DTS, which breaks the MPEG-TS buffer model decoders rely on.
    'pipe:1'
  );

  const ffmpeg = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrTail = '';
  ffmpeg.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    console.log('[ffmpeg]', text.trimEnd());
    stderrTail = (stderrTail + text).slice(-2000);
  });

  ffmpeg.on('error', (err) => {
    console.error('[ffmpeg] spawn error', err);
  });

  ffmpeg.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGKILL') {
      console.error(`[ffmpeg] exit code=${code} signal=${signal}\n${stderrTail}`);
    }
  });

  if (!ffmpeg.stdout) {
    throw new Error('ffmpeg stdout is not piped');
  }

  return {
    stream: ffmpeg.stdout,
    kill: () => {
      if (!ffmpeg.killed) {
        ffmpeg.kill('SIGKILL');
      }
    },
  };
}

// Linearize, tone map to SDR, then convert back to BT.709 limited range.
const HDR_TONEMAP_FILTER = [
  // Drop the HDR10 metadata too, or x264 copies it into the SDR stream as SEI.
  'sidedata=mode=delete:type=MASTERING_DISPLAY_METADATA',
  'sidedata=mode=delete:type=CONTENT_LIGHT_LEVEL',
  'zscale=t=linear:npl=100',
  'format=gbrpf32le',
  'zscale=p=bt709',
  'tonemap=hable:desat=0',
  'zscale=t=bt709:m=bt709:r=tv',
  'format=yuv420p',
].join(',');

function alignTo16(size: VideoSize): VideoSize {
  return {
    width: Math.floor(size.width / 16) * 16,
    height: Math.floor(size.height / 16) * 16,
  };
}

function buildBitmapOverlayGraph(
  videoFilters: string[],
  trackIndex: number,
  rawCanvas: VideoSize | undefined,
  videoSize: VideoSize | undefined
): string {
  const video = [...videoFilters];
  const subs = ['null'];
  // Same multiple-of-16 constraint as the video crop; the centered overlay below
  // trims the few canvas rows that don't fit.
  const canvas = rawCanvas ? alignTo16(rawCanvas) : undefined;
  if (canvas && videoSize && canvas.width >= videoSize.width && canvas.height >= videoSize.height) {
    // The encode was cropped from the original frame (letterbox bars removed): put the
    // bars back so cues positioned inside them stay on screen.
    video.push(`pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2`);
  } else if (videoSize) {
    subs.push(`scale=${videoSize.width}:${videoSize.height}`);
  }
  return [
    `[0:v:0]${video.join(',')}[video]`,
    `[0:s:${trackIndex}]${subs.join(',')}[subs]`,
    '[video][subs]overlay=(W-w)/2:(H-h)/2:eof_action=pass[out]',
  ].join(';');
}

export function buildSubtitlesFilter(
  spec: SubtitleSource,
  videoSize: VideoSize | undefined
): string {
  const path = spec.source === 'external' ? spec.path : spec.videoPath;
  const parts = [`filename=${escapeFilterPath(path)}`];
  if (spec.source === 'internal') {
    parts.push(`si=${spec.trackIndex}`);
  }
  if (videoSize) {
    parts.push(`original_size=${videoSize.width}x${videoSize.height}`);
  }
  return `subtitles=${parts.join(':')}`;
}

function escapeFilterPath(p: string): string {
  // ffmpeg has nested escape contexts. Backslash-escape twice:
  //   1. option-value level: `:` `'` `\` are special
  //   2. filtergraph level:  `\` `'` `[` `]` `,` `;` are special
  // We apply the inner level first so the `\` added by the inner gets re-escaped by the outer.
  let s = p.replace(/\\/g, '/');
  s = s.replace(/[\\:']/g, (c) => `\\${c}`);
  s = s.replace(/[\\[\]',;]/g, (c) => `\\${c}`);
  return s;
}
