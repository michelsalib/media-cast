import type {
  SubtitleProviderId,
  SubtitleQuery,
  SubtitleSearchResult,
} from '../../shared/subtitleSearch';
import type { SubtitleSettings } from './settings';

export interface SearchContext {
  query: SubtitleQuery;
  settings: SubtitleSettings;
  // OpenSubtitles moviehash of the video, when it could be computed.
  movieHash?: string;
}

export interface DownloadedFile {
  fileName: string;
  // A subtitle file, or a zip that holds one (Subdl).
  data: Uint8Array;
}

export interface SubtitleProvider {
  readonly id: SubtitleProviderId;
  search(context: SearchContext): Promise<SubtitleSearchResult[]>;
  download(ref: string, settings: SubtitleSettings): Promise<DownloadedFile>;
}

// A provider that can't run for this query (missing key, movie on a TV-only source).
// Shown as a notice, not an error.
export class ProviderSkipped extends Error {}

const TIMEOUT_MS = 20_000;

export async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new HttpError(response.status, await errorText(response));
  }
  return response;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// Most of these APIs answer errors with a JSON { message } or { error }.
async function errorText(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const json = JSON.parse(body) as { message?: string; error?: string; errors?: string[] };
    const message = json.message ?? json.errors?.join(', ') ?? json.error;
    if (message) return `${message} (HTTP ${response.status})`;
  } catch {
    // not JSON
  }
  return `HTTP ${response.status}${body && body.length < 200 ? `: ${body}` : ''}`;
}

export function fileNameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) return decodeURIComponent(star[1]);
  return /filename="?([^";]+)"?/i.exec(header)?.[1];
}
