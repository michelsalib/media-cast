import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { app } from 'electron';

// Binaries live under resources/bin/<platform>-<arch>/. In dev that's <projectRoot>/resources/bin/,
// in packaged builds it's <process.resourcesPath>/bin/ (via electron-builder extraResources).
// Falls back to whatever's on PATH if no bundled binary is found.
function resolveBundledBinary(name: 'ffmpeg' | 'ffprobe'): string | undefined {
  const binDir = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
  const ext = process.platform === 'win32' ? '.exe' : '';
  const fullPath = path.join(binDir, `${process.platform}-${process.arch}`, `${name}${ext}`);
  return existsSync(fullPath) ? fullPath : undefined;
}

const ffmpegPath = resolveBundledBinary('ffmpeg') ?? 'ffmpeg';
const ffprobePath = resolveBundledBinary('ffprobe') ?? 'ffprobe';

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
  | { source: 'internal'; videoPath: string; trackIndex: number };

/**
 * Pipe a subtitle stream out as bytes. Formats:
 *   - 'srt' / 'vtt' → ffmpeg decodes+remuxes (assumes input is UTF-8 — caller must
 *     handle non-UTF-8 inputs upstream).
 *   - 'raw' → codec-level bytes, no decoder pass. Use this when the original encoding
 *     matters (e.g. for charset sniffing before burn-in).
 */
export function extractSubtitles(
  source: SubtitleSource,
  format: 'srt' | 'vtt' | 'raw'
): Promise<Buffer> {
  const inputPath = source.source === 'internal' ? source.videoPath : source.path;
  const args = ['-i', inputPath];
  if (source.source === 'internal') {
    args.push('-map', `0:s:${source.trackIndex}`);
  }
  if (format === 'raw') {
    // `-c:s copy -f data` pipes codec bytes without going through the subrip decoder
    // (which would otherwise pre-translate to UTF-8 and mangle Latin-1).
    args.push('-c:s', 'copy', '-f', 'data');
  } else {
    args.push('-f', format === 'vtt' ? 'webvtt' : 'srt');
  }
  args.push('pipe:1');
  return runFfmpeg(args);
}

export { ffmpegPath, ffprobePath };

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
  const { videoPath, seekSeconds = 0, burnSubtitles, videoSize, audioTrackIndex = 0 } = options;

  // libass (via the `subtitles` filter) reads the SRT stream assuming UTF-8. MKVs with
  // mis-encoded Latin-1 subrip tracks render mojibake on accents — sniff the raw bytes
  // once to pick the right `charenc` for the filter.
  const subtitleCharenc = burnSubtitles ? await detectSubtitleCharenc(burnSubtitles) : undefined;

  const args: string[] = [];
  if (seekSeconds > 0) {
    // -copyts keeps the original input PTS through the pipeline so the subtitles filter
    // overlays the right cue and the renderer reports the real position.
    args.push('-ss', String(seekSeconds), '-copyts');
  }
  args.push('-i', videoPath);

  // Crop a few rows from the bottom — removes a glitchy edge row that x264 sometimes
  // produces. Subtitles are placed after the crop so libass scales against the actual
  // rendered height.
  const cropBottom = 4;
  const filters: string[] = [`crop=iw:ih-${cropBottom}:0:0`];
  if (burnSubtitles) {
    const adjustedSize = videoSize
      ? { width: videoSize.width, height: videoSize.height - cropBottom }
      : undefined;
    filters.push(buildSubtitlesFilter(burnSubtitles, adjustedSize, subtitleCharenc));
  }
  args.push('-vf', filters.join(','));

  args.push(
    '-map',
    '0:v:0',
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
    '-muxdelay',
    '0',
    '-muxpreload',
    '0',
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

function buildSubtitlesFilter(
  spec: SubtitleSource,
  videoSize: VideoSize | undefined,
  charenc: string | undefined
): string {
  const path = spec.source === 'external' ? spec.path : spec.videoPath;
  const parts = [`filename=${escapeFilterPath(path)}`];
  if (spec.source === 'internal') {
    parts.push(`si=${spec.trackIndex}`);
  }
  if (videoSize) {
    parts.push(`original_size=${videoSize.width}x${videoSize.height}`);
  }
  if (charenc) {
    // libass assumes UTF-8 otherwise; tell it the real input encoding so accents render.
    parts.push(`charenc=${charenc}`);
  }
  // SRT has no PlayResY, so libass scales FontSize against storage_height — i.e.
  // FontSize maps to ~pixels at the output resolution. Pick it as a fraction of
  // the frame so subs stay the same visual size across 480p / 720p / 1080p / 4K.
  const fontSize = videoSize ? Math.round(videoSize.height * 0.03) : 18;
  parts.push(`force_style=FontSize=${fontSize}`);
  return `subtitles=${parts.join(':')}`;
}

async function detectSubtitleCharenc(spec: SubtitleSource): Promise<string | undefined> {
  // For external files, just read the bytes — going through ffmpeg's srt demuxer would
  // also pre-decode and defeat the sniff.
  const rawBytes =
    spec.source === 'external' ? await readFile(spec.path) : await extractSubtitles(spec, 'raw');
  // Valid UTF-8 → libass's default is right; don't pass charenc (also avoids forcing
  // a re-decode when ASS/SSA tracks are involved).
  if (isValidUtf8(rawBytes)) {
    return undefined;
  }
  // Windows-1252 is a superset of Latin-1 and matches the iconv name libass accepts.
  return 'windows-1252';
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(stripBom(buf));
    return true;
  } catch {
    return false;
  }
}

function stripBom(buf: Buffer): Buffer {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3);
  }
  return buf;
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
