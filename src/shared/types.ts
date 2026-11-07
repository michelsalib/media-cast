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
  // reports back with `api.remoteDone(requestId, error?)`. `videoPath`: the video the
  // phone was shown, refused if the window has another one ready by now.
  remoteLaunch: { requestId: string; videoPath: string; device: Device };
  // The phone remote picked other audio or subtitles for what the window has ready: the
  // window applies it as if picked there, then reports back with `api.remoteDone`.
  remoteTracks: { requestId: string; videoPath: string; change: TrackChange };
  // The subtitle size changed (from the window or the phone).
  subtitleScale: number;
}

// What the window has ready to play and the screen picked, shown on the phone remote.
export interface RemoteContext {
  // `details`: the plain-words summary the window shows (episode, subtitles). `tracks`:
  // what can be picked and what is, once the window has probed the video.
  prepared: { videoPath: string; title: string; details?: string; tracks?: TrackList } | null;
  deviceId: string | null;
}

// The video loaded on the TV, with the options it was loaded with.
export interface NowPlaying {
  videoPath: string;
  subtitlesPathOrIndex?: string | number;
  audioIndex?: number;
  burnSubtitles: boolean;
  // Volume evened out (DLNA only): the audio goes through ffmpeg.
  normalizeAudio: boolean;
  deviceName: string;
  // Whether the subtitle size can change on the TV: any subtitles playing (a Chromecast
  // restyles them; on a DLNA TV a size other than Normal burns them in).
  resizableSubtitles: boolean;
}

// The tracks of a video and those picked, raw: the window and the phone label them alike.
// Built by `describeTracks` (shared/tracks.ts), for the video ready and the one playing.
export interface TrackList {
  audio: { language?: string; title?: string; channels?: number }[];
  subtitles: { language?: string; title?: string; bitmap: boolean }[];
  // The subtitle file added to this video, if any (still offered once switched away).
  externalName?: string;
  // The subtitle files in the video's torrent (no paths: the phone sees this too).
  files: Omit<TorrentSubtitles, 'path'>[];
  selected: { audioIndex: number; subtitles: SubtitleChoice };
}

// The tracks of the video playing.
export interface PlayingTracks extends TrackList {
  deviceType: DeviceType;
  // Seconds the subtitles playing are shifted from their original timing (0: as is).
  subtitleOffset: number;
  // On a DLNA TV with subtitles playing: whether they are burned into the picture, and
  // whether that is forced (image subtitles, or a size other than Normal).
  burn?: { on: boolean; forced: 'bitmap' | 'size' | false };
  // On a DLNA TV: whether the volume is evened out.
  normalizeAudio?: boolean;
}

// Picked subtitles: a track index, the added file, a file of the torrent (by index in
// `TrackList.files`), or none.
export type SubtitleChoice = number | 'external' | `file:${number}` | null;

// A switch while playing; undefined keeps what plays.
export interface TrackChange {
  subtitles?: SubtitleChoice;
  audioIndex?: number;
  // DLNA only: burn the subtitles playing into the picture, or send them as a file.
  burnSubtitles?: boolean;
  // DLNA only: even out the volume, or play the audio as it is.
  normalizeAudio?: boolean;
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

// A subtitle file in a torrent. `label` is its name without the video's or a numbering
// ("English", "en forced"), possibly empty; `folder` where it is in the torrent ("" at
// the top). `path` is the local file it is downloaded to by `api.fetchTorrentSubtitles`.
export interface TorrentSubtitles {
  name: string;
  path: string;
  label: string;
  folder: string;
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
