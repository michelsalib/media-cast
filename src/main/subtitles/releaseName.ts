import { basename, extname } from 'node:path';

export interface ReleaseInfo {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
}

// Tokens that start the technical tail of a scene name ("…1080p.BluRay.x264-GROUP").
const TAIL_TOKEN =
  /^(\d{3,4}p|4k|uhd|hdr\d*|dv|bluray|blu-ray|bdrip|brrip|web|web-?dl|webrip|hdtv|dvdrip|dvd|remux|x264|x265|h264|h265|hevc|avc|xvid|divx|aac\d*|ac3|dts|ddp?\d*|atmos|proper|repack|extended|unrated|remastered|multi|vostfr|truefrench|french|internal|limited)$/i;

// Best-effort title / year / episode from a file name. The search dialog lets the user
// correct whatever this gets wrong.
export function parseReleaseName(videoPath: string): ReleaseInfo {
  const name = basename(videoPath, extname(videoPath));
  const words = name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const titleWords: string[] = [];
  const info: Omit<ReleaseInfo, 'title'> = {};

  for (const word of words) {
    const episode =
      /^s(\d{1,2})[ .-]?e(\d{1,3})/i.exec(word) ?? /^(\d{1,2})x(\d{2,3})$/i.exec(word);
    if (episode) {
      info.season = Number(episode[1]);
      info.episode = Number(episode[2]);
      break;
    }
    if (TAIL_TOKEN.test(word)) {
      break;
    }
    titleWords.push(word);
  }

  // The year is the last year-like word before the tail, never the first word: titles
  // can be or contain years ("1917", "Blade Runner 2049 (2017)").
  for (let i = titleWords.length - 1; i > 0; i--) {
    const year = /^\(?((?:19|20)\d{2})\)?$/.exec(titleWords[i]);
    if (year) {
      info.year = Number(year[1]);
      titleWords.length = i;
      break;
    }
  }

  const title = (titleWords.length > 0 ? titleWords : words).join(' ').replace(/\s+-$/, '').trim();
  return { title, ...info };
}

// Shared words between a candidate's release name and the video's file name, as a
// rough "same release" score for ranking.
export function releaseSimilarity(videoPath: string, release: string): number {
  const tokens = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1)
    );
  const video = tokens(basename(videoPath, extname(videoPath)));
  let shared = 0;
  for (const t of tokens(release)) {
    if (video.has(t)) shared++;
  }
  return shared;
}
