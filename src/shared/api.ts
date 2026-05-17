import type { FFProbeData } from '../main/ffmpeg';
import type { AppInfo, Device, PlayerStatus } from './types';

// Wire-level contract between main and preload. Single source of truth for channel
// names and signatures — drift between either side becomes a compile error.
// Paths cross IPC as strings; the renderer-facing API in preload re-types the
// File-accepting methods on top of these.

// Renderer → main, awaits response.
export interface InvokeChannels {
  probe: (videoPath: string) => Promise<FFProbeData>;
  appInfo: () => Promise<AppInfo>;
  thumbnail: (videoPath: string, width?: number, height?: number) => Promise<Buffer>;
  connect: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  load: (
    videoPath: string,
    subtitlesPathOrIndex?: string | number,
    audioIndex?: number,
    burnSubtitles?: boolean
  ) => Promise<void>;
}

// Renderer → main, fire-and-forget.
export interface SendChannels {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  refresh: () => void;
  quitAndInstall: () => void;
}

// Main → renderer broadcasts.
export interface EventChannels {
  status: PlayerStatus;
  scan: Device[];
  updateReady: null;
}

export type InvokeChannel = keyof InvokeChannels;
export type SendChannel = keyof SendChannels;
export type EventChannel = keyof EventChannels;

export const INVOKE_CHANNELS = [
  'probe',
  'appInfo',
  'thumbnail',
  'connect',
  'disconnect',
  'load',
] as const satisfies readonly InvokeChannel[];

export const SEND_CHANNELS = [
  'play',
  'pause',
  'seek',
  'refresh',
  'quitAndInstall',
] as const satisfies readonly SendChannel[];

export const EVENT_CHANNELS = [
  'status',
  'scan',
  'updateReady',
] as const satisfies readonly EventChannel[];
