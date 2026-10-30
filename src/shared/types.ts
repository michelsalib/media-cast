export type PlayerState = 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING';

export interface PlayerStatus {
  playerState: PlayerState;
  currentTime: number;
  duration?: number;
  title?: string;
  transcoded?: boolean;
}

export type DeviceType = 'chromecast' | 'upnp';

export interface Device {
  id: string;
  type: DeviceType;
  name: string;
  ip?: string;
  // UPnP only: video MIME types the renderer claims to accept in its ConnectionManager
  // Sink, and the subset advertised with a codec wildcard (`*`). Arrays, not Sets, so
  // they survive IPC — the renderer feeds them to [[checkCompat]] exactly as main does.
  acceptedVideoMimes?: readonly string[];
  acceptedWildcardVideoMimes?: readonly string[];
}

export interface DevicesScanner<D extends Device = Device> {
  readonly type: DeviceType;
  onDevices(callback: (devices: D[]) => void): void;
  refresh(): void;
  close(): void;
}

export interface AppInfo {
  appVersion: string;
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegVersion: string;
}

export interface LoadVideoOptions {
  title: string;
  videoUrl: string;
  videoMimeType?: string;
  videoTranscoded?: boolean;
  subtitlesUrl?: string;
  subtitlesFormat?: 'vtt' | 'srt' | 'smi';
  duration?: number;
  // File size in bytes, for direct play.
  size?: number;
}

export interface Renderer {
  connect(): Promise<void>;
  close(): Promise<void>;
  loadVideo(options: LoadVideoOptions): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(time: number): Promise<void>;
  getStatus(): Promise<void>;
  onStatus(callback: (status: PlayerStatus) => void): void;
}

// Main → renderer pushes. Hand-written: unlike `MainApi` there is no
// implementation object to derive this from.
export interface MainEvents {
  status: PlayerStatus;
  scan: Device[];
  updateReady: null;
  // The OS accent colour changed (Windows), as `#rrggbb`.
  accentColor: string;
}

// Mirrors Electron's `nativeTheme.themeSource`.
export type ThemeSource = 'system' | 'light' | 'dark';

export interface Appearance {
  themeSource: ThemeSource;
  // `#rrggbb`; undefined where the OS has no accent colour (Linux).
  accentColor?: string;
}
