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
  // Subtitle size, for players that draw them (Chromecast); 1 = default.
  subtitleScale?: number;
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
  // Resizes the subtitles of the loaded video; only where the player draws them (Chromecast).
  setSubtitleScale?(scale: number): Promise<void>;
}

// Main → renderer pushes. Hand-written: unlike `MainApi` there is no
// implementation object to derive this from.
export interface MainEvents {
  status: PlayerStatus;
  scan: Device[];
  updateReady: null;
  // The OS accent colour changed (Windows), as `#rrggbb`.
  accentColor: string;
  // Swarm progress of every open torrent, once a second while any is open.
  torrents: TorrentStats[];
  // What the TV was last sent; null after a disconnect.
  nowPlaying: NowPlaying | null;
  // The phone remote pressed Stop: the window stops as if its own button was used.
  remoteStop: null;
  // The phone remote pressed Play: the window plays what it has ready on `device`, then
  // reports back with `api.remoteLaunchDone(requestId, error?)`.
  remoteLaunch: { requestId: string; device: Device };
  // The subtitle size changed (from the window or the phone).
  subtitleScale: number;
}

// What the window has ready to play and the screen picked, shown on the phone remote.
export interface RemoteContext {
  // `details`: the plain-words summary the window shows (episode, subtitles).
  prepared: { videoPath: string; title: string; details?: string } | null;
  deviceId: string | null;
}

// The video loaded on the TV, with the options it was loaded with.
export interface NowPlaying {
  videoPath: string;
  subtitlesPathOrIndex?: string | number;
  audioIndex?: number;
  burnSubtitles: boolean;
  deviceName: string;
  // Whether the subtitle size can change on the TV: any subtitles playing (a Chromecast
  // restyles them; on a DLNA TV a size other than Normal burns them in).
  resizableSubtitles: boolean;
}

// The tracks of the video playing, raw: the window and the phone label them alike.
export interface PlayingTracks {
  deviceType: DeviceType;
  audio: { language?: string; title?: string; channels?: number }[];
  subtitles: { language?: string; title?: string; bitmap: boolean }[];
  // The subtitle file loaded with this video, if any (still offered once switched away).
  externalName?: string;
  selected: { audioIndex: number; subtitles: number | 'external' | null };
  // Seconds the subtitles playing are shifted from their original timing (0: as is).
  subtitleOffset: number;
}

// A switch while playing: a subtitle track index, the added file, or none (null);
// undefined keeps what plays.
export interface TrackChange {
  subtitles?: number | 'external' | null;
  audioIndex?: number;
}

// The phone remote's switch and the addresses a phone can open it on.
export interface RemoteInfo {
  enabled: boolean;
  links: { address: string; url: string; qrSvg: string }[];
}

// A video picked for playback: a local file, or a video inside a torrent, whose path
// is then a loopback URL (see TorrentStore). Either way `path` is what main takes.
export interface VideoSource {
  name: string;
  path: string;
  size?: number;
  // Set for torrent videos.
  infoHash?: string;
}

export interface TorrentContents {
  infoHash: string;
  name: string;
  videos: { name: string; path: string; size: number }[];
}

export interface TorrentStats {
  infoHash: string;
  peers: number;
  // Bytes per second.
  downloadSpeed: number;
  downloaded: number;
}

// Mirrors Electron's `nativeTheme.themeSource`.
export type ThemeSource = 'system' | 'light' | 'dark';

export interface Appearance {
  themeSource: ThemeSource;
  // `#rrggbb`; undefined where the OS has no accent colour (Linux).
  accentColor?: string;
}
