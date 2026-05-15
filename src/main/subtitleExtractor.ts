import { readFile } from 'node:fs/promises';
import {
  convertSubtitles,
  extractSubtitles as ffmpegExtractSubtitles,
  type SubtitleFormat,
} from './ffmpeg';

export async function extractSubtitles(
  videoPath: string,
  subtitlesPathOrIndex?: string | number,
  format: SubtitleFormat = 'vtt'
): Promise<Buffer | undefined> {
  // ffmpeg has no SMI muxer — request SRT bytes then convert in JS.
  const rawFormat: SubtitleFormat = format === 'smi' ? 'srt' : format;
  const raw = await readRaw(videoPath, subtitlesPathOrIndex, rawFormat);
  if (!raw) {
    return undefined;
  }

  if (format === 'smi') {
    const srt = stripBom(raw).toString('utf8');
    return Buffer.from(srtToSmi(srt), 'latin1');
  }

  if (format === 'srt') {
    // Old DLNA TVs (Samsung especially) reject UTF-8 SRT. Re-encode as Latin-1.
    return Buffer.from(stripBom(raw).toString('utf8'), 'latin1');
  }

  return raw;
}

async function readRaw(
  videoPath: string,
  subtitlesPathOrIndex: string | number | undefined,
  format: SubtitleFormat
): Promise<Buffer | undefined> {
  if (subtitlesPathOrIndex === undefined) {
    return undefined;
  }

  if (typeof subtitlesPathOrIndex === 'number') {
    return ffmpegExtractSubtitles(videoPath, subtitlesPathOrIndex, format);
  }

  const lower = subtitlesPathOrIndex.toLowerCase();

  // Passthrough when the on-disk format already matches the target.
  if (format === 'srt' && lower.endsWith('.srt')) {
    return readFile(subtitlesPathOrIndex);
  }
  if (format === 'vtt' && lower.endsWith('.vtt')) {
    return readFile(subtitlesPathOrIndex);
  }

  if (lower.endsWith('.srt') || lower.endsWith('.ass') || lower.endsWith('.vtt')) {
    return convertSubtitles(subtitlesPathOrIndex, format);
  }

  return undefined;
}

function stripBom(input: Buffer): Buffer {
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    return input.subarray(3);
  }
  return input;
}

interface SrtCue {
  startMs: number;
  endMs: number;
  text: string;
}

function parseSrt(srt: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = srt.replace(/^﻿/, '').split(/\r?\n\r?\n+/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.length > 0);
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) {
      continue;
    }
    const m =
      /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/.exec(
        lines[timeIdx]
      );
    if (!m) {
      continue;
    }
    const startMs =
      Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 + Number(m[4]);
    const endMs =
      Number(m[5]) * 3_600_000 + Number(m[6]) * 60_000 + Number(m[7]) * 1000 + Number(m[8]);
    const text = lines.slice(timeIdx + 1).join('<br>');
    cues.push({ startMs, endMs, text });
  }

  return cues;
}

function srtToSmi(srt: string): string {
  const cues = parseSrt(srt);
  const lines: string[] = [];
  for (const cue of cues) {
    lines.push(`<SYNC Start=${cue.startMs}><P Class=FRCC>${cue.text}</P></SYNC>`);
    lines.push(`<SYNC Start=${cue.endMs}><P Class=FRCC>&nbsp;</P></SYNC>`);
  }

  return [
    '<SAMI>',
    '<HEAD>',
    '<TITLE>Subtitles</TITLE>',
    '<STYLE TYPE="text/css">',
    '<!--',
    'P { font-family: Arial; font-weight: normal; color: white; background-color: black; text-align: center; }',
    '.FRCC { Name: French; lang: fr-FR; SAMIType: CC; }',
    '-->',
    '</STYLE>',
    '</HEAD>',
    '<BODY>',
    ...lines,
    '</BODY>',
    '</SAMI>',
  ].join('\r\n');
}
