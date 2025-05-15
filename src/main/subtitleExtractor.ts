import { readFile } from 'fs/promises';
import { extractSubtitles as ffmpegExtractSubtitles, convertSubtitles } from './ffmpeg';

export async function extractSubtitles(
  videoPath: string,
  subtitlesPathOrIndex?: string | number
): Promise<Buffer | undefined> {
  if (subtitlesPathOrIndex == undefined) {
    return undefined;
  }

  if (typeof subtitlesPathOrIndex == 'number') {
    return ffmpegExtractSubtitles(videoPath, subtitlesPathOrIndex);
  }

  if (subtitlesPathOrIndex.endsWith('.srt') || subtitlesPathOrIndex.endsWith('.ass')) {
    return convertSubtitles(subtitlesPathOrIndex);
  }

  if (subtitlesPathOrIndex.endsWith('.vtt')) {
    return await readFile(subtitlesPathOrIndex);
  }

  return undefined;
}
