import { open } from 'node:fs/promises';
import { isUrlSource } from '../videoSource';

const CHUNK = 64 * 1024;
const MASK = (1n << 64n) - 1n;

// The OpenSubtitles "moviehash": file size plus the 64-bit little-endian word sums of
// the first and last 64 KiB, modulo 2^64, as 16 hex digits.
export async function movieHash(path: string): Promise<string | undefined> {
  const source = isUrlSource(path) ? await urlChunks(path) : await fileChunks(path);
  if (!source) {
    return undefined;
  }
  let hash = BigInt(source.size);
  for (const buffer of source.chunks) {
    for (let i = 0; i < CHUNK; i += 8) {
      hash = (hash + buffer.readBigUInt64LE(i)) & MASK;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

interface Chunks {
  size: number;
  chunks: Buffer[];
}

async function fileChunks(path: string): Promise<Chunks | undefined> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (size < CHUNK) {
      return undefined;
    }
    const chunks: Buffer[] = [];
    for (const position of [0, size - CHUNK]) {
      const buffer = Buffer.alloc(CHUNK);
      await file.read(buffer, 0, CHUNK, position);
      chunks.push(buffer);
    }
    return { size, chunks };
  } finally {
    await file.close();
  }
}

// A torrent video: two range requests to its loopback URL (each fetches a piece or two).
async function urlChunks(url: string): Promise<Chunks | undefined> {
  const head = await fetch(url, { headers: { range: `bytes=0-${CHUNK - 1}` } });
  const size = Number(head.headers.get('content-range')?.split('/')[1]);
  if (!Number.isFinite(size) || size < CHUNK) {
    await head.body?.cancel();
    return undefined;
  }
  const tail = await fetch(url, { headers: { range: `bytes=${size - CHUNK}-${size - 1}` } });
  return {
    size,
    chunks: [Buffer.from(await head.arrayBuffer()), Buffer.from(await tail.arrayBuffer())],
  };
}
