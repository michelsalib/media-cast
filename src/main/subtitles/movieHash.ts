import { open } from 'node:fs/promises';

const CHUNK = 64 * 1024;
const MASK = (1n << 64n) - 1n;

// The OpenSubtitles "moviehash": file size plus the 64-bit little-endian word sums of
// the first and last 64 KiB, modulo 2^64, as 16 hex digits.
export async function movieHash(path: string): Promise<string | undefined> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (size < CHUNK) {
      return undefined;
    }
    let hash = BigInt(size);
    const buffer = Buffer.alloc(CHUNK);
    for (const position of [0, size - CHUNK]) {
      await file.read(buffer, 0, CHUNK, position);
      for (let i = 0; i < CHUNK; i += 8) {
        hash = (hash + buffer.readBigUInt64LE(i)) & MASK;
      }
    }
    return hash.toString(16).padStart(16, '0');
  } finally {
    await file.close();
  }
}
