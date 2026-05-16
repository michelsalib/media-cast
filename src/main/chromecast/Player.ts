import { promisify } from 'node:util';
import { Client, DefaultMediaReceiver, type Media, type MediaStatus } from 'castv2-client';
import type { LoadVideoOptions, PlayerState, PlayerStatus, Renderer } from '../../shared/types';

export class CastPlayer implements Renderer {
  private readonly client: Client = new Client();
  private player?: DefaultMediaReceiver;
  private statusCallback?: (status: PlayerStatus) => void;
  private lastMedia?: Media;

  constructor(private readonly host: string) {}

  onStatus(callback: (status: PlayerStatus) => void): void {
    this.statusCallback = callback;
  }

  async connect(): Promise<void> {
    await promisify(this.client.connect).bind(this.client)(this.host);
    this.player = await promisify(this.client.launch).bind(this.client)(DefaultMediaReceiver);
    this.player.on('status', (s) => this.emit(s));
  }

  async close(): Promise<void> {
    this.player?.close();
    this.client.close();
  }

  async loadVideo({ title, videoUrl, subtitlesUrl }: LoadVideoOptions): Promise<void> {
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
      // https://github.com/thibauts/node-castv2-client/wiki/How-to-use-subtitles-with-the-DefaultMediaReceiver-app#subtitle-styling
      media.textTrackStyle = {
        fontFamily: 'Droid Sans',
        fontGenericFamily: 'SANS_SERIF',
        backgroundColor: '#00000000',
        edgeType: 'OUTLINE',
        edgeColor: '#000000FF',
      };
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
      playerState: status.playerState as PlayerState,
      currentTime: status.currentTime,
      duration: media?.duration,
      title: media?.metadata?.title,
    });
  }
}
