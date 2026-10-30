import { app } from 'electron';
import type { SubtitleSearchResult } from '../../../shared/subtitleSearch';
import {
  fetchOk,
  HttpError,
  ProviderSkipped,
  type SearchContext,
  type SubtitleProvider,
} from '../provider';
import type { SubtitleSettings } from '../settings';

// REST API v1: https://opensubtitles.stoplight.io/docs/opensubtitles-api
const API = 'https://api.opensubtitles.com/api/v1';
// Tokens last 24 h; renew well before.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

interface SubtitleEntry {
  id: string;
  attributes: {
    language: string;
    release?: string;
    hearing_impaired?: boolean;
    download_count?: number;
    moviehash_match?: boolean;
    files: { file_id: number; file_name?: string }[];
  };
}

// Ours → OpenSubtitles. It splits Portuguese and Chinese where we don't.
const TO_OS: Record<string, string> = { pt: 'pt-pt', zh: 'zh-cn,zh-tw' };
const FROM_OS: Record<string, string> = { 'pt-pt': 'pt', 'zh-cn': 'zh', 'zh-tw': 'zh' };

// The canonical form the API redirects to: `+` for spaces, literal commas.
function canonicalEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+').replace(/%2C/gi, ',');
}

let session: { key: string; token: string; baseUrl: string; expires: number } | undefined;

function headers(apiKey: string, token?: string): Record<string, string> {
  return {
    'Api-Key': apiKey,
    // OpenSubtitles requires an app-identifying User-Agent ("Name vVersion").
    'User-Agent': `media-cast v${app.getVersion()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function requireKey(settings: SubtitleSettings): string {
  const { apiKey } = settings.opensubtitles;
  if (!apiKey) {
    throw new ProviderSkipped('No API key — add one in settings');
  }
  return apiKey;
}

// Logged-in downloads get the account's daily quota instead of the tiny anonymous one.
async function login(settings: SubtitleSettings): Promise<typeof session> {
  const { apiKey, username, password } = settings.opensubtitles;
  if (!username || !password) {
    return undefined;
  }
  const key = `${apiKey}\n${username}\n${password}`;
  if (session?.key === key && session.expires > Date.now()) {
    return session;
  }
  const response = await fetchOk(`${API}/login`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ username, password }),
  });
  const body = (await response.json()) as { token: string; base_url?: string };
  // VIP accounts are pointed at another host.
  const baseUrl = body.base_url ? `https://${body.base_url}/api/v1` : API;
  session = { key, token: body.token, baseUrl, expires: Date.now() + TOKEN_TTL_MS };
  return session;
}

export const openSubtitles: SubtitleProvider = {
  id: 'opensubtitles',

  async search({ query, settings, movieHash }: SearchContext): Promise<SubtitleSearchResult[]> {
    const apiKey = requireKey(settings);
    const languages = query.languages
      .map((l) => TO_OS[l] ?? l)
      .join(',')
      .split(',')
      .sort()
      .join(',');

    // The API redirects unless parameters are sorted and lower-case. The hash search
    // and the title search run separately: combined, the hash only reorders results.
    const searches: Record<string, string>[] = [];
    if (movieHash) {
      searches.push({ languages, moviehash: movieHash });
    }
    if (query.title) {
      const params: Record<string, string> = { languages, query: query.title.toLowerCase() };
      if (query.season !== undefined && query.episode !== undefined) {
        params.season_number = String(query.season);
        params.episode_number = String(query.episode);
        params.type = 'episode';
      } else if (query.year) {
        params.year = String(query.year);
      }
      searches.push(params);
    }

    const pages = await Promise.all(
      searches.map(async (params) => {
        const qs = Object.keys(params)
          .sort()
          .map((k) => `${k}=${canonicalEncode(params[k])}`)
          .join('&');
        const response = await fetchOk(`${API}/subtitles?${qs}`, { headers: headers(apiKey) });
        return ((await response.json()) as { data: SubtitleEntry[] }).data;
      })
    );

    const byId = new Map<string, SubtitleSearchResult>();
    for (const entry of pages.flat()) {
      const a = entry.attributes;
      const file = a.files[0];
      if (!file || byId.has(entry.id)) continue;
      byId.set(entry.id, {
        provider: 'opensubtitles',
        ref: String(file.file_id),
        language: FROM_OS[a.language] ?? a.language,
        release: a.release || file.file_name || 'Unnamed release',
        hearingImpaired: !!a.hearing_impaired,
        hashMatch: !!a.moviehash_match,
        downloads: a.download_count,
      });
    }
    return [...byId.values()];
  },

  async download(ref, settings) {
    const apiKey = requireKey(settings);
    const auth = await login(settings);
    let response: Response;
    try {
      response = await fetchOk(`${auth?.baseUrl ?? API}/download`, {
        method: 'POST',
        headers: headers(apiKey, auth?.token),
        body: JSON.stringify({ file_id: Number(ref), sub_format: 'srt' }),
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) session = undefined;
      if (err instanceof HttpError && (err.status === 406 || err.status === 429) && !auth) {
        throw new Error(
          `${err.message}. Anonymous downloads are very limited — add your OpenSubtitles login in settings.`
        );
      }
      throw err;
    }
    const { link, file_name } = (await response.json()) as { link: string; file_name: string };
    const file = await fetchOk(link);
    return { fileName: file_name, data: new Uint8Array(await file.arrayBuffer()) };
  },
};
