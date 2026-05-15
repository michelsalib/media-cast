export type PlayerState = 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING';

export interface PlayerStatus {
  playerState: PlayerState;
  currentTime: number;
  duration?: number;
  title?: string;
}

export type DeviceType = 'chromecast' | 'upnp';

export interface Device {
  id: string;
  type: DeviceType;
  name: string;
  ip?: string;
}

export interface LoadVideoOptions {
  title: string;
  videoUrl: string;
  subtitlesUrl?: string;
  subtitlesFormat?: 'vtt' | 'srt' | 'smi';
  duration?: number;
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
