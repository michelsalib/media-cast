import type { SubtitleSearchResult } from '../../../shared/subtitleSearch';
import {
  fetchOk,
  fileNameFromDisposition,
  ProviderSkipped,
  type SearchContext,
  type SubtitleProvider,
} from '../provider';

// https://subdl.com/api-doc — free API key from a subdl.com account. Downloads are zips.
const API = 'https://api.subdl.com/api/v1/subtitles';
const DOWNLOAD = 'https://dl.subdl.com';

interface SubdlEntry {
  release_name?: string;
  name: string;
  language: string;
  url: string;
  hi?: boolean;
}

// Subdl's codes are upper-case ISO 639-1, except Brazilian Portuguese.
const toSubdl = (code: string): string => (code === 'pt-br' ? 'BR_PT' : code.toUpperCase());
const fromSubdl = (code: string): string => (code === 'BR_PT' ? 'pt-br' : code.toLowerCase());

export const subdl: SubtitleProvider = {
  id: 'subdl',

  async search({ query, settings }: SearchContext): Promise<SubtitleSearchResult[]> {
    const { apiKey } = settings.subdl;
    if (!apiKey) {
      throw new ProviderSkipped('No API key — add a free one in settings');
    }
    const params = new URLSearchParams({
      api_key: apiKey,
      film_name: query.title,
      languages: query.languages.map(toSubdl).join(','),
      subs_per_page: '30',
    });
    if (query.season !== undefined && query.episode !== undefined) {
      params.set('type', 'tv');
      params.set('season_number', String(query.season));
      params.set('episode_number', String(query.episode));
    } else {
      params.set('type', 'movie');
      if (query.year) params.set('year', String(query.year));
    }

    const response = await fetchOk(`${API}?${params}`);
    const body = (await response.json()) as {
      status: boolean;
      message?: string;
      error?: string;
      subtitles?: SubdlEntry[];
    };
    if (!body.status) {
      // "Can't find movie or tv" is just no results.
      if (/can'?t find/i.test(body.error ?? body.message ?? '')) return [];
      throw new Error(body.error ?? body.message ?? 'Search failed');
    }

    // Old Subscene imports are RAR archives, which we can't unpack.
    const zips = (body.subtitles ?? []).filter((s) => !/\.rar(?:\?|$)/i.test(s.url));
    return zips.map((s) => ({
      provider: 'subdl',
      ref: s.url,
      language: fromSubdl(s.language),
      release: s.release_name || s.name,
      hearingImpaired: !!s.hi,
      hashMatch: false,
    }));
  },

  async download(ref) {
    const response = await fetchOk(`${DOWNLOAD}${ref}`);
    return {
      fileName:
        fileNameFromDisposition(response.headers.get('content-disposition')) ??
        ref.split('/').pop() ??
        'subtitles.zip',
      data: new Uint8Array(await response.arrayBuffer()),
    };
  },
};
