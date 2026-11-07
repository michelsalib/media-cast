import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { extractSubtitles as ffmpegExtractSubtitles, type SubtitleFormat } from './ffmpeg';

export async function extractSubtitles(
  videoPath: string,
  subtitlesPathOrIndex?: string | number,
  format: SubtitleFormat = 'vtt',
  { language }: { language?: string } = {}
): Promise<Buffer | undefined> {
  // ffmpeg has no SMI muxer — request SRT bytes then convert in JS.
  const rawFormat: 'srt' | 'vtt' = format === 'smi' ? 'srt' : format;
  const raw = await readRaw(videoPath, subtitlesPathOrIndex, rawFormat);
  if (!raw) {
    return undefined;
  }

  if (format === 'smi') {
    return Buffer.from(srtToSmi(decodeText(raw), language), 'utf8');
  }

  // Served as charset=utf-8 (and WebVTT is UTF-8 by spec).
  return Buffer.from(decodeText(raw), 'utf8');
}

async function readRaw(
  videoPath: string,
  subtitlesPathOrIndex: string | number | undefined,
  format: 'srt' | 'vtt'
): Promise<Buffer | undefined> {
  if (subtitlesPathOrIndex === undefined) {
    return undefined;
  }

  if (typeof subtitlesPathOrIndex === 'number') {
    return ffmpegExtractSubtitles(
      { source: 'internal', videoPath, trackIndex: subtitlesPathOrIndex },
      format
    );
  }

  const ext = extname(subtitlesPathOrIndex).toLowerCase();

  if (ext === `.${format}`) {
    return readFile(subtitlesPathOrIndex);
  }

  if (TEXT_SUBTITLE_EXTENSIONS.has(ext)) {
    // ffmpeg rejects non-UTF-8 text ("Invalid UTF-8 in decoded subtitles text") unless
    // told the charset.
    return ffmpegExtractSubtitles(
      {
        source: 'external',
        path: subtitlesPathOrIndex,
        charenc: await detectSubtitleCharenc(subtitlesPathOrIndex),
      },
      format
    );
  }

  throw new Error(`Unsupported subtitle file: ${ext || subtitlesPathOrIndex}`);
}

// Text formats ffmpeg can read standalone. (`.sub` is ambiguous — MicroDVD needs a
// frame rate, VobSub needs its `.idx` — so it isn't accepted.)
export const TEXT_SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);

// Sidecar subtitles are very often Windows-1252 (the norm for French/Western European
// releases), not UTF-8. Anything that isn't valid UTF-8 is treated as Windows-1252,
// the superset of Latin-1 those files are actually written in.
export async function detectSubtitleCharenc(path: string): Promise<string | undefined> {
  const bytes = await readFile(path);
  return isUtf8(bytes) ? undefined : 'CP1252';
}

// The file libass burns in for a subtitle file: the file itself (with its charset when
// it isn't UTF-8), or a repaired copy when it has the defect repairCp1252AsLatin1 fixes —
// libass reads the file on its own, so the repair can't happen on the way.
export async function subtitleFileForBurning(
  path: string
): Promise<{ path: string; charenc?: string }> {
  const bytes = await readFile(path);
  if (!isUtf8(bytes)) return { path, charenc: 'CP1252' };
  const repaired = repairSubtitleBytes(bytes);
  if (!repaired) return { path };
  const dir = join(tmpdir(), 'media-cast-subtitles');
  await mkdir(dir, { recursive: true });
  const id = createHash('sha1').update(path).digest('hex').slice(0, 16);
  const copy = join(dir, `${id}${extname(path)}`);
  await writeFile(copy, repaired);
  return { path: copy };
}

function isUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function decodeText(bytes: Buffer): string {
  return isUtf8(bytes)
    ? repairCp1252AsLatin1(new TextDecoder('utf-8').decode(bytes))
    : new TextDecoder('windows-1252').decode(bytes);
}

// A Windows-1252 file converted to UTF-8 as if it were Latin-1 (some subtitle sites do
// this) turns œ ’ … € into C1 control characters, U+0080–U+009F, drawn as boxes. No
// subtitle text uses those, so each is read back as the Windows-1252 byte it was.
export function repairCp1252AsLatin1(text: string): string {
  return text.replace(/[-]/g, (c) => CP1252.decode(Uint8Array.of(c.charCodeAt(0))));
}

const CP1252 = new TextDecoder('windows-1252');

// The same repair on a file's bytes; undefined when there is nothing to repair.
export function repairSubtitleBytes(bytes: Uint8Array): Buffer | undefined {
  const buffer = Buffer.from(bytes);
  if (!isUtf8(buffer)) return undefined;
  const text = buffer.toString('utf8');
  const repaired = repairCp1252AsLatin1(text);
  return repaired === text ? undefined : Buffer.from(repaired, 'utf8');
}

export interface SrtCue {
  startMs: number;
  endMs: number;
  text: string;
}

export function parseSrt(srt: string): SrtCue[] {
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

// ISO 639-2 (what Matroska/ffprobe tag tracks with) → the BCP-47 tag SAMI classes use.
const SAMI_LANGUAGES: Record<string, { name: string; lang: string }> = {
  eng: { name: 'English', lang: 'en-US' },
  fre: { name: 'French', lang: 'fr-FR' },
  fra: { name: 'French', lang: 'fr-FR' },
  spa: { name: 'Spanish', lang: 'es-ES' },
  ger: { name: 'German', lang: 'de-DE' },
  deu: { name: 'German', lang: 'de-DE' },
  ita: { name: 'Italian', lang: 'it-IT' },
  por: { name: 'Portuguese', lang: 'pt-PT' },
  dut: { name: 'Dutch', lang: 'nl-NL' },
  nld: { name: 'Dutch', lang: 'nl-NL' },
};

function srtToSmi(srt: string, language: string | undefined): string {
  // Unknown language (external files carry none): English is what TVs fall back to.
  const { name, lang } = SAMI_LANGUAGES[language ?? ''] ?? SAMI_LANGUAGES.eng;
  const cues = parseSrt(srt);
  const lines: string[] = [];
  for (const cue of cues) {
    lines.push(`<SYNC Start=${cue.startMs}><P Class=SUBCC>${cue.text}</P></SYNC>`);
    lines.push(`<SYNC Start=${cue.endMs}><P Class=SUBCC>&nbsp;</P></SYNC>`);
  }

  return [
    '<SAMI>',
    '<HEAD>',
    '<TITLE>Subtitles</TITLE>',
    '<STYLE TYPE="text/css">',
    '<!--',
    'P { font-family: Arial; font-weight: normal; color: white; background-color: black; text-align: center; }',
    `.SUBCC { Name: ${name}; lang: ${lang}; SAMIType: CC; }`,
    '-->',
    '</STYLE>',
    '</HEAD>',
    '<BODY>',
    ...lines,
    '</BODY>',
    '</SAMI>',
  ].join('\r\n');
}
