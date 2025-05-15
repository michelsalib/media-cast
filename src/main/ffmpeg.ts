import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface FFProbeData {
  streams: {
    index: number;
    codec_name: string;
    codec_long_name: string;
    codec_type: 'subtitle' | 'audio' | 'video';
    tags: {
      language?: string;
      title?: string;
    };
  }[];
  format: {
    filename: string;
    nb_streams: number;
    format_name: string;
    format_long_name: string;
    duration: string;
    size: string;
    bit_rate: string;
  };
}

export async function extractSubtitles(videoPath: string, track: number): Promise<Buffer> {
  const { stdout } = await promisify(execFile)(
    'ffmpeg',
    ['-i', videoPath, '-map', `0:s:${track}`, '-f', 'webvtt', 'pipe:1'],
    {
      encoding: 'buffer',
    }
  );

  return stdout;
}

export async function convertSubtitles(subtitlepath: string): Promise<Buffer> {
  const { stdout } = await promisify(execFile)(
    'ffmpeg',
    ['-i', subtitlepath, '-f', 'webvtt', 'pipe:1'],
    {
      encoding: 'buffer',
    }
  );

  return stdout;
}

export async function probe(videoPath: string): Promise<FFProbeData> {
  const data = await promisify(execFile)('ffprobe', [
    '-v',
    'quiet',
    '-output_format',
    'json',
    '-show_format',
    '-show_streams',
    '-i',
    videoPath,
  ]);

  return JSON.parse(data.stdout);
}

export async function thumbail(videoPath: string, width = 800, height = 600): Promise<Buffer> {
  const data = await promisify(execFile)(
    'ffmpeg',
    [
      '-i',
      videoPath,
      '-ss',
      '00:01:00',
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-s',
      `${width}x${height}`,
      'pipe:1',
    ],
    {
      encoding: 'buffer',
    }
  );

  return data.stdout;
}
