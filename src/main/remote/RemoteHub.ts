import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { Device, MainEvents, RemoteContext, TrackChange } from '../../shared/types';
import { sendEvent } from '../api';

// Probing, extracting subtitles and a slow TV can make a load take a while; a torrent
// still finding its first pieces even longer.
const LAUNCH_TIMEOUT_MS = 180_000;
// A pick is instant, unless it's a torrent's subtitle file still to download.
const TRACKS_TIMEOUT_MS = 60_000;

// Between the window and the phone remote. The window owns what is ready to play (video,
// subtitles, audio, burn-in) and the connection state, so it reports its context here and
// a phone's Play or track pick is handed back to it to run exactly like its own.
export class RemoteHub {
  private context: RemoteContext = { prepared: null, deviceId: null };
  // Names the video ready: a phone acts on the one it was shown, never on one picked since.
  private preparedId?: string;
  private readonly listeners = new Set<() => void>();
  private readonly requests = new Map<
    string,
    { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly window: BrowserWindow) {
    // A reloaded window will never answer what was asked before.
    window.webContents.on('did-start-loading', () => this.rejectAll());
  }

  get current(): RemoteContext {
    return this.context;
  }

  // The id of the video ready, if any (see `checkPrepared`).
  get currentPreparedId(): string | undefined {
    return this.preparedId;
  }

  setContext(context: RemoteContext): void {
    if (context.prepared?.videoPath !== this.context.prepared?.videoPath) {
      this.preparedId = context.prepared ? randomUUID() : undefined;
    }
    this.context = context;
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  // Throws unless `id` is still the video ready.
  checkPrepared(id: string): void {
    if (!this.context.prepared) throw new Error('Nothing is ready on the computer');
    if (id !== this.preparedId) throw new Error('Another video is ready on the computer now');
  }

  // Both act on the video ready now (see `checkPrepared`).
  launch(device: Device): Promise<void> {
    const videoPath = this.readyPath();
    return this.request('remoteLaunch', LAUNCH_TIMEOUT_MS, (requestId) => ({
      requestId,
      videoPath,
      device,
    }));
  }

  // Another audio or subtitle pick for what is ready (not for what plays).
  pickTracks(change: TrackChange): Promise<void> {
    const videoPath = this.readyPath();
    return this.request('remoteTracks', TRACKS_TIMEOUT_MS, (requestId) => ({
      requestId,
      videoPath,
      change,
    }));
  }

  private readyPath(): string {
    const prepared = this.context.prepared;
    if (!prepared) throw new Error('Nothing is ready on the computer');
    return prepared.videoPath;
  }

  // The window's answer to a request.
  done(requestId: string, error?: string): void {
    const request = this.requests.get(requestId);
    if (!request) return;
    this.requests.delete(requestId);
    clearTimeout(request.timer);
    if (error) request.reject(new Error(error));
    else request.resolve();
  }

  private rejectAll(): void {
    for (const requestId of [...this.requests.keys()]) {
      this.done(requestId, 'The computer’s window was reloaded');
    }
  }

  private request<K extends 'remoteLaunch' | 'remoteTracks'>(
    channel: K,
    timeoutMs: number,
    payload: (requestId: string) => MainEvents[K]
  ): Promise<void> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId);
        reject(new Error('The computer didn’t answer'));
      }, timeoutMs);
      this.requests.set(requestId, { resolve, reject, timer });
      sendEvent(this.window, channel, payload(requestId));
    });
  }
}
