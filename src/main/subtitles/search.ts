import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { app } from 'electron';
import { unzipSync } from 'fflate';
import type {
  SubtitleCue,
  SubtitleQuery,
  SubtitleSearchResponse,
  SubtitleSearchResult,
  SubtitleTiming,
} from '../../shared/subtitleSearch';
import { extractSubtitles, parseSrt, TEXT_SUBTITLE_EXTENSIONS } from '../subtitleExtractor';
import { movieHash } from './movieHash';
import { ProviderSkipped, type SubtitleProvider } from './provider';
import { gestdown } from './providers/gestdown';
import { openSubtitles } from './providers/opensubtitles';
import { subdl } from './providers/subdl';
import { releaseSimilarity } from './releaseName';
import { loadSubtitleSettings } from './settings';

const PROVIDERS: readonly SubtitleProvider[] = [openSubtitles, subdl, gestdown];

export interface SavedSubtitles {
  path: string;
  name: string;
}

export async function searchSubtitles(
  videoPath: string,
  query: SubtitleQuery
): Promise<SubtitleSearchResponse> {
  const settings = await loadSubtitleSettings();
  const hash = await movieHash(videoPath).catch(() => undefined);
  const outcomes = await Promise.allSettled(
    PROVIDERS.map((p) => p.search({ query, settings, movieHash: hash }))
  );

  const response: SubtitleSearchResponse = { results: [], notices: [] };
  outcomes.forEach((outcome, i) => {
    const provider = PROVIDERS[i].id;
    if (outcome.status === 'fulfilled') {
      response.results.push(...outcome.value);
    } else {
      const err = outcome.reason;
      if (!(err instanceof ProviderSkipped)) {
        console.error(`[subtitles] ${provider} search failed:`, err);
      }
      response.notices.push({
        provider,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Preferred language first; within one, hash matches (timed for this exact file),
  // then the release name closest to the video's, then popularity.
  const rank = (r: SubtitleSearchResult): number[] => [
    query.languages.indexOf(r.language) === -1 ? 99 : query.languages.indexOf(r.language),
    r.hashMatch ? 0 : 1,
    -releaseSimilarity(videoPath, r.release),
    -(r.downloads ?? 0),
  ];
  response.results.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    return 0;
  });
  return response;
}

export async function downloadSubtitle(
  result: SubtitleSearchResult,
  query: Pick<SubtitleQuery, 'season' | 'episode'>
): Promise<SavedSubtitles> {
  const provider = PROVIDERS.find((p) => p.id === result.provider);
  if (!provider) {
    throw new Error(`Unknown subtitle provider: ${result.provider}`);
  }
  const settings = await loadSubtitleSettings();
  const file = await provider.download(result.ref, settings);
  const { fileName, data } = isZip(file.data)
    ? pickFromZip(file.data, query)
    : { fileName: file.fileName, data: file.data };

  const ext = extname(fileName).toLowerCase();
  if (!TEXT_SUBTITLE_EXTENSIONS.has(ext)) {
    throw new Error(`Downloaded file isn't a supported subtitle format: ${fileName}`);
  }
  const id = createHash('sha1').update(`${result.provider}:${result.ref}`).digest('hex');
  const dir = join(await cacheDir(), id.slice(0, 12));
  await mkdir(dir, { recursive: true });
  const path = join(dir, safeFileName(fileName));
  await writeFile(path, data);
  return { path, name: basename(path) };
}

function isZip(data: Uint8Array): boolean {
  return data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

// Season packs hold one file per episode: take the one named for ours, else the
// biggest subtitle file (the full track rather than a forced/signs-only one).
function pickFromZip(
  zip: Uint8Array,
  { season, episode }: Pick<SubtitleQuery, 'season' | 'episode'>
): { fileName: string; data: Uint8Array } {
  const entries = Object.entries(unzipSync(zip))
    .filter(
      ([name]) =>
        !name.startsWith('__MACOSX/') && TEXT_SUBTITLE_EXTENSIONS.has(extname(name).toLowerCase())
    )
    .map(([name, data]) => ({ fileName: basename(name), data }));
  if (entries.length === 0) {
    throw new Error('The downloaded archive contains no subtitle file');
  }
  if (season !== undefined && episode !== undefined) {
    const tag = new RegExp(
      `s0*${season}[ ._-]?e0*${episode}(?!\\d)|\\b0*${season}x0*${episode}\\b`,
      'i'
    );
    const match = entries.find((e) => tag.test(e.fileName));
    if (match) return match;
  }
  return entries.reduce((a, b) => (b.data.length > a.data.length ? b : a));
}

async function cacheDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'subtitle-cache');
  await mkdir(dir, { recursive: true });
  return dir;
}

function safeFileName(name: string): string {
  // Characters Windows forbids in file names, plus control characters.
  const cleaned = [...name].map((c) => (c < ' ' || '<>:"/\\|?*'.includes(c) ? '_' : c)).join('');
  return cleaned.slice(-180) || 'subtitles.srt';
}

// Cues as plain text, for the preview overlay. Any text source works: a sidecar file
// (any of the supported formats, any charset) or an internal track.
export async function subtitleCues(
  videoPath: string,
  subtitlesPathOrIndex: string | number
): Promise<SubtitleCue[]> {
  const srt = await extractSubtitles(videoPath, subtitlesPathOrIndex, 'srt');
  if (!srt) return [];
  return parseSrt(srt.toString('utf8')).map((c) => ({
    start: c.startMs / 1000,
    end: c.endMs / 1000,
    text: c.text
      .replace(/<br>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, ''),
  }));
}

// Writes the retimed track as a new SRT in the cache; the source is never modified.
export async function retimeSubtitles(
  videoPath: string,
  subtitlesPathOrIndex: string | number,
  timing: SubtitleTiming
): Promise<SavedSubtitles> {
  const srt = await extractSubtitles(videoPath, subtitlesPathOrIndex, 'srt');
  if (!srt) {
    throw new Error('No subtitles to resync');
  }
  const shift = (ms: number): number =>
    Math.max(0, Math.round(ms * timing.ratio + timing.offset * 1000));
  const body = parseSrt(srt.toString('utf8'))
    .map(
      (c, i) =>
        `${i + 1}\r\n${srtTime(shift(c.startMs))} --> ${srtTime(shift(c.endMs))}\r\n${c.text.replace(/<br>/g, '\r\n')}\r\n`
    )
    .join('\r\n');

  const source =
    typeof subtitlesPathOrIndex === 'string'
      ? basename(subtitlesPathOrIndex, extname(subtitlesPathOrIndex))
      : `${basename(videoPath, extname(videoPath))}.track${subtitlesPathOrIndex}`;
  const label = `${timing.offset >= 0 ? '+' : ''}${timing.offset.toFixed(1)}s${timing.ratio !== 1 ? `.x${timing.ratio.toFixed(4)}` : ''}`;
  const dir = join(await cacheDir(), 'resynced');
  await mkdir(dir, { recursive: true });
  // Drop a previous resync label so re-resyncing doesn't stack suffixes.
  const name = safeFileName(
    `${source.replace(/\.resync[+-][\d.]+s(?:\.x[\d.]+)?$/, '')}.resync${label}.srt`
  );
  const path = join(dir, name);
  await writeFile(path, body, 'utf8');
  return { path, name };
}

function srtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`;
}
