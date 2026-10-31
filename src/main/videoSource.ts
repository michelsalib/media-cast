import type { IncomingMessage, ServerResponse } from 'node:http';
import { request } from 'node:http';
import { basename, dirname, extname } from 'node:path';
import send from 'send';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding']);

// A video path is a local file, or a loopback URL for a video inside a torrent
// (TorrentStore). ffmpeg reads both; these helpers cover the places that don't.

export function isUrlSource(videoPath: string): boolean {
  return /^https?:\/\//i.test(videoPath);
}

// The file name, decoded for URLs.
export function sourceName(videoPath: string): string {
  return isUrlSource(videoPath)
    ? decodeURIComponent(videoPath.slice(videoPath.lastIndexOf('/') + 1))
    : basename(videoPath);
}

// Byte-range-capable response with the video's bytes, plus `headers`.
export function sendVideo(
  req: IncomingMessage,
  res: ServerResponse,
  videoPath: string,
  headers: Record<string, string> = {}
): void {
  if (!isUrlSource(videoPath)) {
    // send() URL-decodes and dot-checks its path argument, so hand it a root plus an
    // encoded file name: a raw path with `%` or a `.directory` would 400/404.
    send(req, encodeURIComponent(basename(videoPath)), {
      root: dirname(videoPath),
      dotfiles: 'allow',
    })
      .on('headers', (response: ServerResponse) => {
        for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
      })
      .pipe(res);
    return;
  }

  const upstream = request(
    videoPath,
    { method: req.method, headers: req.headers.range ? { range: req.headers.range } : {} },
    (upstreamRes) => {
      const passed = Object.entries(upstreamRes.headers).filter(([name]) => !HOP_BY_HOP.has(name));
      res.writeHead(upstreamRes.statusCode ?? 502, { ...Object.fromEntries(passed), ...headers });
      upstreamRes.pipe(res);
    }
  );
  upstream.on('error', () => res.destroy());
  res.on('close', () => upstream.destroy());
  upstream.end();
}

// The file name without its extension.
export function sourceStem(videoPath: string): string {
  const name = sourceName(videoPath);
  return name.slice(0, name.length - extname(name).length);
}
