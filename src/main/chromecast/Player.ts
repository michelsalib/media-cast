import { promisify } from 'node:util';
import {
  Client,
  DefaultMediaReceiver,
  type Media,
  type MediaStatus,
  type ReceiverVolume,
} from 'castv2-client';
import type {
  LoadVideoOptions,
  PlayerState,
  PlayerStatus,
  Renderer,
  Volume,
} from '../../shared/types';

// https://github.com/thibauts/node-castv2-client/wiki/How-to-use-subtitles-with-the-DefaultMediaReceiver-app#subtitle-styling
const TEXT_TRACK_STYLE: NonNullable<Media['textTrackStyle']> = {
  fontFamily: 'Droid Sans',
  fontGenericFamily: 'SANS_SERIF',
  backgroundColor: '#00000000',
  edgeType: 'OUTLINE',
  edgeColor: '#000000FF',
};

export class CastPlayer implements Renderer {
  private readonly client: Client = new Client();
  private player?: DefaultMediaReceiver;
  private statusCallback?: (status: PlayerStatus) => void;
  private lastMedia?: Media;
  private volume?: Volume;

  constructor(private readonly host: string) {
    // castv2-client re-emits socket errors and the heartbeat 'Device timeout' as 'error'
    // on the client; with no listener that's an uncaught exception in main.
    this.client.on('error', (err) => {
      console.error('[cast] client error:', err.message);
      this.dropPlayer();
    });
  }

  onStatus(callback: (status: PlayerStatus) => void): void {
    this.statusCallback = callback;
  }

  async connect(): Promise<void> {
    await promisify(this.client.connect).bind(this.client)(this.host);
    // Receiver status: the volume, also when changed from the TV remote or another sender.
    this.client.on('status', (s) => void this.setReceiverVolume(s.volume));
    await this.setReceiverVolume(
      await promisify(this.client.getVolume)
        .bind(this.client)()
        .catch(() => undefined)
    );
    const player = await promisify(this.client.launch).bind(this.client)(DefaultMediaReceiver);
    player.on('status', (s) => this.emit(s));
    // Receiver app closed from elsewhere (phone, TV remote, another sender).
    player.on('close', () => this.dropPlayer());
    this.player = player;
  }

  async close(): Promise<void> {
    // Application.close() dereferences its connection, which is already null once the
    // receiver closed on its own — don't let that skip closing the client.
    try {
      this.player?.close();
    } catch {}
    this.player = undefined;
    try {
      this.client.close();
    } catch {}
  }

  private dropPlayer(): void {
    if (!this.player) {
      return;
    }
    this.player = undefined;
    this.statusCallback?.({
      volume: this.volume,
      playerState: 'IDLE',
      currentTime: 0,
      duration: this.lastMedia?.duration,
      title: this.lastMedia?.metadata?.title,
    });
  }

  async loadVideo({
    title,
    videoUrl,
    subtitlesUrl,
    subtitleScale = 1,
  }: LoadVideoOptions): Promise<void> {
    if (!this.player) {
      throw new Error('Player not ready');
    }

    const media: Media = {
      contentId: videoUrl,
      contentType: 'video/mp4',
      streamType: 'BUFFERED',
      metadata: {
        type: 0,
        metadataType: 0,
        title,
      },
    };

    if (subtitlesUrl) {
      media.textTrackStyle = { ...TEXT_TRACK_STYLE, fontScale: subtitleScale };
      media.tracks = [
        {
          trackId: 1,
          type: 'TEXT',
          trackContentId: subtitlesUrl,
          trackContentType: 'text/vtt',
          name: 'English',
          language: 'en-US',
          subtype: 'SUBTITLES',
        },
      ];
    }

    await promisify(this.player.load).bind(this.player)(media, {
      autoplay: true,
      activeTrackIds: subtitlesUrl ? [1] : [],
    });
  }

  // Live: the receiver restyles the track it is showing (EDIT_TRACKS_INFO).
  async setSubtitleScale(scale: number): Promise<void> {
    if (!this.player) {
      throw new Error('Player not ready');
    }
    const media = this.player.media;
    return promisify(media.sessionRequest).bind(media)({
      type: 'EDIT_TRACKS_INFO',
      textTrackStyle: { ...TEXT_TRACK_STYLE, fontScale: scale },
    });
  }

  // The receiver's volume (the TV's, over HDMI-CEC), not the media's. It takes a level or
  // a mute in one request, not both.
  async setVolume({ level, muted }: Partial<Volume>): Promise<void> {
    const set = promisify(this.client.setVolume).bind(this.client);
    // Resolved once the status carrying it is out, so a slider doesn't flick back.
    if (level !== undefined) {
      await this.setReceiverVolume(await set({ level: Math.min(1, Math.max(0, level)) }));
    }
    if (muted !== undefined) {
      await this.setReceiverVolume(await set({ muted }));
    }
  }

  // A fixed volume can't be changed from here: reported as unknown, so no control shows.
  private async setReceiverVolume(volume: ReceiverVolume | undefined): Promise<void> {
    const next =
      volume && volume.controlType !== 'fixed'
        ? { level: volume.level, muted: volume.muted }
        : undefined;
    if (next?.level === this.volume?.level && next?.muted === this.volume?.muted) {
      return;
    }
    this.volume = next;
    // A fresh media status carries it, at the right position.
    await this.getStatus().catch(() => {});
  }

  async pause(): Promise<void> {
    if (!this.player) {
      throw new Error('Player not ready');
    }
    return promisify(this.player.pause).bind(this.player)();
  }

  async play(): Promise<void> {
    if (!this.player) {
      throw new Error('Player not ready');
    }
    return promisify(this.player.play).bind(this.player)();
  }

  async seek(time: number): Promise<void> {
    if (!this.player) {
      throw new Error('Player not ready');
    }
    return promisify(this.player.seek).bind(this.player)(time);
  }

  async getStatus(): Promise<void> {
    if (!this.statusCallback || !this.player) {
      return;
    }
    const status = await promisify(this.player.getStatus).bind(this.player)();
    this.emit(status);
  }

  private emit(status: MediaStatus): void {
    if (status.media) {
      this.lastMedia = status.media;
    }
    const media = status.media ?? this.lastMedia;
    this.statusCallback?.({
      volume: this.volume,
      playerState: status.playerState as PlayerState,
      currentTime: status.currentTime,
      duration: media?.duration,
      title: media?.metadata?.title,
    });
  }
}
