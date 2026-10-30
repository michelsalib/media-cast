import { type SubtitleSearchResult, subtitleLanguageName } from '../../../shared/subtitleSearch';
import {
  fetchOk,
  fileNameFromDisposition,
  HttpError,
  ProviderSkipped,
  type SearchContext,
  type SubtitleProvider,
} from '../provider';

// Gestdown: a keyless JSON proxy over Addic7ed. TV episodes only.
const API = 'https://api.gestdown.info';

interface Show {
  id: string;
  name: string;
}

interface Episode {
  version: string;
  completed: boolean;
  hearingImpaired: boolean;
  downloadUri: string;
  downloadCount?: number;
}

// 404 means "no such show / no subtitles", not a failure.
async function getJson<T>(path: string): Promise<T | undefined> {
  try {
    return (await (await fetchOk(`${API}${path}`)).json()) as T;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return undefined;
    throw err;
  }
}

export const gestdown: SubtitleProvider = {
  id: 'gestdown',

  async search({ query }: SearchContext): Promise<SubtitleSearchResult[]> {
    const { season, episode } = query;
    if (season === undefined || episode === undefined) {
      throw new ProviderSkipped('TV episodes only');
    }
    const show = await findShow(query.title);
    if (!show) {
      return [];
    }

    const perLanguage = await Promise.all(
      query.languages.map(async (language) => {
        const body = await getJson<{ matchingSubtitles: Episode[] }>(
          `/subtitles/get/${show.id}/${season}/${episode}/${encodeURIComponent(subtitleLanguageName(language))}`
        );
        return (body?.matchingSubtitles ?? [])
          .filter((s) => s.completed)
          .map(
            (s): SubtitleSearchResult => ({
              provider: 'gestdown',
              ref: s.downloadUri,
              language,
              release: `${show.name} S${pad(season)}E${pad(episode)} ${s.version}`,
              hearingImpaired: s.hearingImpaired,
              hashMatch: false,
              downloads: s.downloadCount,
            })
          );
      })
    );
    return perLanguage.flat();
  },

  async download(ref) {
    const response = await fetchOk(`${API}${ref}`);
    return {
      fileName:
        fileNameFromDisposition(response.headers.get('content-disposition')) ?? 'subtitles.srt',
      data: new Uint8Array(await response.arrayBuffer()),
    };
  },
};

// File names flatten "The Office (US)" to "The Office US", which Gestdown's search
// doesn't find: retry with trailing words dropped, then match ignoring punctuation.
async function findShow(title: string): Promise<Show | undefined> {
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const wanted = normalize(title);
  const words = title.split(/\s+/);
  for (let n = words.length; n >= Math.max(1, words.length - 2); n--) {
    const found = await getJson<{ shows: Show[] }>(
      `/shows/search/${encodeURIComponent(words.slice(0, n).join(' '))}`
    );
    const shows = found?.shows ?? [];
    if (shows.length > 0) {
      return shows.find((s) => normalize(s.name) === wanted) ?? shows[0];
    }
  }
  return undefined;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
