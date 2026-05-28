#!/usr/bin/env node
// Dumps the MPEG-TS that the production MediaServer would hand to a UPnP TV
// for a burn-in transcode. Open the output file in VLC / mpv / any media
// player to verify subtitle rendering.
//
// Usage:
//   npm run dump:burnin -- <video> <subtitle> [timeframe] [outFile]
//
// <subtitle> is either an external file path (.srt/.ass/.vtt) or an integer
// track index referring to an embedded subtitle stream inside <video> (the
// same indexing as ffmpeg's `-map 0:s:<i>`).
//
// The trailing two args are positional but order-independent — anything
// matching START-END is the timeframe, anything else is the output file.
// timeframe accepts HH:MM:SS, MM:SS, or SS on each side (e.g. 17:50-17:55,
// 1:23:45-1:24:00, 90-120). Defaults: timeframe=0:00-0:30, outFile=./burnin-output.ts.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import {
  configureBinaries,
  type FFProbeData,
  probe,
  type SubtitleSource,
} from '../src/main/ffmpeg';
import { MediaServer } from '../src/main/MediaServer';

const PORT = 4044;
const DEFAULT_TIMEFRAME = '0:00-0:30';

async function main(): Promise<void> {
  const [, , videoArg, subtitleArg, ...rest] = process.argv;
  if (!videoArg || !subtitleArg) {
    console.error('Usage: npm run dump:burnin -- <video> <subtitle> [timeframe] [outFile]');
    console.error('  subtitle: external file path, or embedded track index (integer)');
    console.error('  timeframe: START-END (e.g. 17:50-17:55). Default: 0:00-0:30');
    process.exit(1);
  }

  // Trailing args are order-independent: anything parseable as START-END is
  // the timeframe, anything else is the output filename.
  let timeframeArg: string | undefined;
  let outArg: string | undefined;
  for (const a of rest) {
    if (looksLikeTimeframe(a)) {
      timeframeArg = a;
    } else {
      outArg = a;
    }
  }

  const videoPath = path.resolve(videoArg);
  const outFile = path.resolve(outArg ?? 'burnin-output.ts');
  const { start: startSec, end: endSec } = parseTimeframe(timeframeArg ?? DEFAULT_TIMEFRAME);
  const durationSec = endSec - startSec;
  if (durationSec <= 0) {
    console.error(`Bad timeframe: END (${endSec}s) must be > START (${startSec}s)`);
    process.exit(1);
  }

  if (!existsSync(videoPath)) {
    console.error(`No such video: ${videoPath}`);
    process.exit(1);
  }

  // Find bundled ffmpeg/ffprobe the same way main does (without electron).
  const ffmpegPath = findBundled('ffmpeg') ?? 'ffmpeg';
  const ffprobePath = findBundled('ffprobe') ?? 'ffprobe';
  configureBinaries({ ffmpegPath, ffprobePath });

  const probeData = await probe(videoPath);
  const v = probeData.streams.find((s) => s.codec_type === 'video');
  const videoSize = v?.width && v?.height ? { width: v.width, height: v.height } : undefined;

  const burnSubtitles = resolveSubtitleSource(subtitleArg, videoPath, probeData);

  console.log(`Starting MediaServer on port ${PORT}…`);
  const server = new MediaServer(PORT);

  // Same call PlaybackController.load makes for a UPnP burn-in transcode.
  const url = server.serveVideo(videoPath, {
    transcode: true,
    targetIp: '127.0.0.1',
    duration: Number(probeData.format.duration) || undefined,
    burnSubtitles,
    videoSize,
    audioTrackIndex: 0,
  });
  const urlPath = new URL(url).pathname;
  const subDesc =
    burnSubtitles.source === 'external'
      ? `external file ${burnSubtitles.path}`
      : `embedded track ${burnSubtitles.trackIndex}`;
  console.log(`Server URL:  ${url}`);
  console.log(`Fetching     http://127.0.0.1:${PORT}${urlPath}`);
  console.log(`Subtitles    ${subDesc}`);
  console.log(`Timeframe    ${formatNpt(startSec)} → ${formatNpt(endSec)} (${durationSec}s)`);
  console.log(`Writing →    ${outFile}\n`);

  try {
    await downloadSegment(urlPath, startSec, durationSec, outFile, ffmpegPath);
    console.log(`\nDone. Open ${outFile} in your media player.`);
  } finally {
    await server.close();
  }
}

function downloadSegment(
  urlPath: string,
  startSec: number,
  durationSec: number,
  outFile: string,
  ffmpegPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> =
      startSec > 0 ? { 'TimeSeekRange.dlna.org': `npt=${formatNpt(startSec)}-` } : {};
    const req = httpRequest(
      { host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET', headers },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        // Pipe MediaServer's MPEG-TS through a local ffmpeg with `-t` so the
        // segment is bounded by source duration (MediaServer uses `-copyts`,
        // so input PTS = source time and `-t` cuts exactly at endSec).
        const ff = spawn(
          ffmpegPath,
          ['-y', '-i', 'pipe:0', '-c', 'copy', '-t', String(durationSec), '-f', 'mpegts', outFile],
          { stdio: ['pipe', 'ignore', 'inherit'] }
        );
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          process.stdout.write(`\rReceived ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
        });
        res.pipe(ff.stdin);
        // Once ffmpeg hits -t it closes stdin → res.pipe sees EPIPE. Swallow.
        ff.stdin.on('error', () => {});
        res.on('error', () => {});
        ff.on('exit', (code) => {
          req.destroy();
          if (code === 0 || code === 255) {
            resolve();
          } else {
            reject(new Error(`ffmpeg exit ${code}`));
          }
        });
        ff.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function resolveSubtitleSource(
  arg: string,
  videoPath: string,
  probeData: FFProbeData
): SubtitleSource {
  // Integer-only string → embedded subtitle track index (same indexing as
  // ffmpeg's `-map 0:s:<i>` — counts only subtitle streams).
  if (/^\d+$/.test(arg)) {
    const trackIndex = Number(arg);
    const subStreams = probeData.streams.filter((s) => s.codec_type === 'subtitle');
    if (trackIndex >= subStreams.length) {
      console.error(`No embedded subtitle track at index ${trackIndex}.`);
      console.error(describeSubtitleTracks(subStreams));
      process.exit(1);
    }
    return { source: 'internal', videoPath, trackIndex };
  }
  const externalPath = path.resolve(arg);
  if (!existsSync(externalPath)) {
    console.error(`No such subtitle file: ${externalPath}`);
    console.error(
      describeSubtitleTracks(probeData.streams.filter((s) => s.codec_type === 'subtitle'))
    );
    process.exit(1);
  }
  return { source: 'external', path: externalPath };
}

function describeSubtitleTracks(subStreams: FFProbeData['streams']): string {
  if (subStreams.length === 0) {
    return 'Video has no embedded subtitle tracks.';
  }
  const lines = subStreams.map((s, i) => {
    const lang = s.tags?.language ?? '??';
    const title = s.tags?.title ? ` — ${s.tags.title}` : '';
    return `  ${i}: ${s.codec_name} (${lang})${title}`;
  });
  return ['Available embedded subtitle tracks:', ...lines].join('\n');
}

function findBundled(name: 'ffmpeg' | 'ffprobe'): string | undefined {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const p = path.join(
    process.cwd(),
    'resources',
    'bin',
    `${process.platform}-${process.arch}`,
    `${name}${ext}`
  );
  return existsSync(p) ? p : undefined;
}

function looksLikeTimeframe(s: string): boolean {
  try {
    const { start, end } = parseTimeframe(s);
    return end > start;
  } catch {
    return false;
  }
}

function parseTimeframe(tf: string): { start: number; end: number } {
  const dash = tf.lastIndexOf('-');
  if (dash <= 0) {
    throw new Error(`Bad timeframe ${tf}: expected START-END (e.g. 17:50-17:55)`);
  }
  return {
    start: parseTimestamp(tf.slice(0, dash)),
    end: parseTimestamp(tf.slice(dash + 1)),
  };
}

function parseTimestamp(s: string): number {
  // Accept SS[.ms], MM:SS[.ms], or HH:MM:SS[.ms].
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN) || parts.length > 3) {
    throw new Error(`Bad timestamp: ${s}`);
  }
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatNpt(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
