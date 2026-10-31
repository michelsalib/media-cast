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
  // execFile kills the child past maxBuffer (default 1 MiB) — too small for a long
  // subtitle track or a styled .ass.
  const { stdout } = await promisify(execFile)(ffmpegPath, args, {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

export interface FFProbeData {
  streams: {
    index: number;
    codec_name: string;
    codec_long_name: string;
    codec_type: 'subtitle' | 'audio' | 'video';
    profile?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    channels?: number;
    color_transfer?: string;
    avg_frame_rate?: string;
    // ffprobe omits `tags` entirely on untagged streams.
    tags?: {
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
  | {
      source: 'external';
      path: string;
      // ffmpeg -sub_charenc / libass charenc for text files that aren't UTF-8.
      charenc?: string;
    }
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
  const args: string[] = [];
  if (source.source === 'external' && source.charenc) {
    args.push('-sub_charenc', source.charenc);
  }
  args.push('-i', inputPath);
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

// JPEG, aspect preserved. -ss before -i seeks the input to a keyframe instead of
// decoding the first minute; a video shorter than that yields no frame, so retry at 0.
export async function thumbnail(videoPath: string, width = 800): Promise<Buffer> {
  const frame = await runFfmpeg(thumbnailArgs(videoPath, 60, width));
  return frame.length > 0 ? frame : runFfmpeg(thumbnailArgs(videoPath, 0, width));
}

function thumbnailArgs(videoPath: string, atSeconds: number, width: number): string[] {
  return [
    '-ss',
    String(atSeconds),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:-2,format=yuvj420p`,
    '-c:v',
    'mjpeg',
    '-q:v',
    '4',
    '-f',
    'image2',
    'pipe:1',
  ];
}

// ffprobe's avg_frame_rate is a fraction ("24000/1001"); "0/0" when unknown.
export function parseFrameRate(rate: string | undefined): number | undefined {
  const [num, den] = (rate ?? '').split('/').map(Number);
  const fps = den ? num / den : num;
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
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
  frameRate?: number;
  audioTrackIndex?: number;
  hdr?: boolean;
  // Burned-in text subtitles, as a scale of their own size; 1 = as authored.
  subtitleScale?: number;
}

// Never encode above 1080p. A 4K H.264 stream is outside what High@4.x TV decoders
// accept, and libx264 at 4K (or with the float tone map) runs slower than real time on
// most PCs — the TV's buffer drains and webOS gives up on the stream.
const MAX_OUTPUT: VideoSize = { width: 1920, height: 1080 };

export interface TranscodeHandle {
  stream: Readable;
  kill: () => void;
}

/**
 * Transcodes any video to H.264 + AAC in an MPEG-TS stream piped on stdout.
 * Tuned for old DLNA TV decoders: ≤1080p, High@4.0/4.2, VBV-capped, 8-bit 4:2:0.
 * Returns a Readable for the caller to pipe somewhere, plus a kill function.
 */
export async function transcodeToMpegTs(options: TranscodeOptions): Promise<TranscodeHandle> {
  const {
    videoPath,
    seekSeconds = 0,
    burnSubtitles,
    videoSize,
    frameRate,
    audioTrackIndex = 0,
    hdr = false,
    subtitleScale = 1,
  } = options;
  const downscaled =
    !!videoSize && (videoSize.width > MAX_OUTPUT.width || videoSize.height > MAX_OUTPUT.height);

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
  // Downscale first so the tone map works on at most 1080p.
  const videoFilters: string[] = [];
  if (downscaled) {
    videoFilters.push(
      `scale=${MAX_OUTPUT.width}:${MAX_OUTPUT.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`
    );
  }
  if (hdr) {
    videoFilters.push(HDR_TONEMAP_FILTER);
  }
  videoFilters.push('crop=trunc(iw/16)*16:trunc(ih/16)*16');
  const croppedSize = videoSize ? alignTo16(fitWithin(videoSize, MAX_OUTPUT)) : undefined;

  if (burnSubtitles?.source === 'internal' && burnSubtitles.bitmap) {
    const graph = buildBitmapOverlayGraph(
      videoFilters,
      burnSubtitles.trackIndex,
      burnSubtitles.bitmap.canvas,
      croppedSize,
      videoSize ? fitRatio(videoSize, MAX_OUTPUT) : 1,
      subtitleScale
    );
    args.push('-filter_complex', graph, '-map', '[out]');
  } else {
    if (burnSubtitles) {
      videoFilters.push(buildSubtitlesFilter(burnSubtitles, croppedSize, subtitleScale));
    }
    args.push('-vf', videoFilters.join(','), '-map', '0:v:0');
  }

  args.push(
    '-map',
    `0:a:${audioTrackIndex}?`,
    '-c:v',
    'libx264',
    // Downscaling and tone mapping eat into the real-time budget; trade a little
    // compression efficiency for speed there.
    '-preset',
    downscaled || hdr ? 'superfast' : 'veryfast',
    '-profile:v',
    'high',
    // 4.0 covers 1080p30; 1080p50/60 needs 4.2. x264 only writes the label, so it has
    // to match what the stream really is or strict decoders reject it.
    '-level',
    frameRate && frameRate > 30 ? '4.2' : '4.0',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '60',
    // -level alone only labels the stream; without VBV, x264's CRF bitrate is unbounded
    // and grainy scenes overshoot what the TV's buffer (and Wi-Fi) sustain. Cap well
    // under High@4.0's 25 Mb/s.
    '-maxrate',
    '12M',
    '-bufsize',
    '24M',
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
  // Surface a missing/unrunnable binary to the caller (→ HTTP 500) instead of
  // answering 200 with an empty body.
  await new Promise<void>((resolve, reject) => {
    ffmpeg.once('spawn', resolve);
    ffmpeg.once('error', reject);
  });

  return {
    stream: ffmpeg.stdout,
    kill: () => {
      if (!ffmpeg.killed) {
        ffmpeg.kill('SIGKILL');
      }
    },
  };
}

export interface PreviewTranscodeOptions {
  videoPath: string;
  seekSeconds: number;
  audioTrackIndex?: number;
  hdr?: boolean;
}

/**
 * Fast 720p H.264 + AAC fragmented MP4 for the in-app <video> preview, starting at
 * `seekSeconds`. Video is always re-encoded: input seeking is then frame-accurate and
 * output time 0 is exactly `seekSeconds` — stream copy would start at the previous
 * keyframe and throw subtitle sync checks off by seconds.
 */
export async function transcodePreview(options: PreviewTranscodeOptions): Promise<TranscodeHandle> {
  const { videoPath, seekSeconds, audioTrackIndex = 0, hdr = false } = options;
  const filters = ['scale=-2:min(720\\,ih)'];
  if (hdr) {
    filters.push(HDR_TONEMAP_FILTER);
  }
  filters.push('format=yuv420p');
  const args = [
    ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    '-i',
    videoPath,
    '-map',
    '0:v:0',
    '-map',
    `0:a:${audioTrackIndex}?`,
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-crf',
    '26',
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '128k',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  ];

  const ffmpeg = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  if (!ffmpeg.stdout) {
    throw new Error('ffmpeg stdout is not piped');
  }
  await new Promise<void>((resolve, reject) => {
    ffmpeg.once('spawn', resolve);
    ffmpeg.once('error', reject);
  });
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

// Mirrors the scale filter's force_original_aspect_ratio=decrease:force_divisible_by=2.
function fitRatio(size: VideoSize, max: VideoSize): number {
  return Math.min(1, max.width / size.width, max.height / size.height);
}

function fitWithin(size: VideoSize, max: VideoSize): VideoSize {
  const ratio = fitRatio(size, max);
  if (ratio === 1) {
    return size;
  }
  return {
    width: Math.floor((size.width * ratio) / 2) * 2,
    height: Math.floor((size.height * ratio) / 2) * 2,
  };
}

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
  videoSize: VideoSize | undefined,
  // Factor the video was downscaled by; the canvas must shrink with it or padding to
  // it would bring the frame back above 1080p.
  downscale: number,
  // The subtitle size chosen; the whole subtitle canvas is scaled by it.
  subtitleScale = 1
): string {
  const video = [...videoFilters];
  const subs = ['null'];
  // Same multiple-of-16 constraint as the video crop; the centered overlay below
  // trims the few canvas rows that don't fit.
  const canvas = rawCanvas
    ? alignTo16({
        width: Math.round(rawCanvas.width * downscale),
        height: Math.round(rawCanvas.height * downscale),
      })
    : undefined;
  if (canvas && videoSize && canvas.width >= videoSize.width && canvas.height >= videoSize.height) {
    // The encode was cropped from the original frame (letterbox bars removed): put the
    // bars back so cues positioned inside them stay on screen.
    video.push(`pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2`);
    if (downscale < 1) {
      subs.push(`scale=${canvas.width}:${canvas.height}`);
    }
  } else if (videoSize) {
    subs.push(`scale=${videoSize.width}:${videoSize.height}`);
  }
  // Resized subtitles keep the canvas's bottom edge on the frame's, where cues sit: larger
  // ones grow upwards (the canvas sides that overflow are empty), smaller ones shrink
  // towards the bottom centre.
  let position = '(W-w)/2:(H-h)/2';
  if (subtitleScale !== 1) {
    subs.push(`scale=trunc(iw*${subtitleScale}/2)*2:trunc(ih*${subtitleScale}/2)*2`);
    position = '(W-w)/2:H-h';
  }
  return [
    `[0:v:0]${video.join(',')}[video]`,
    `[0:s:${trackIndex}]${subs.join(',')}[subs]`,
    `[video][subs]overlay=${position}:eof_action=pass[out]`,
  ].join(';');
}

export function buildSubtitlesFilter(
  spec: SubtitleSource,
  videoSize: VideoSize | undefined,
  scale = 1
): string {
  const path = spec.source === 'external' ? spec.path : spec.videoPath;
  const parts = [`filename=${escapeFilterPath(path)}`];
  if (spec.source === 'internal') {
    parts.push(`si=${spec.trackIndex}`);
  }
  if (spec.source === 'external' && spec.charenc) {
    parts.push(`charenc=${spec.charenc}`);
  }
  if (videoSize) {
    parts.push(`original_size=${videoSize.width}x${videoSize.height}`);
  }
  if (scale !== 1) {
    // ScaleX/ScaleY rather than FontSize: each style of an ASS file keeps its own font
    // size relative to the others. A factor, not the percent ASS files use: libass
    // applies overrides without its usual /100 (100 here renders 100× — off screen).
    parts.push(`force_style='ScaleX=${scale},ScaleY=${scale}'`);
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
