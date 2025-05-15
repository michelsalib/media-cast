import { Client, DefaultMediaReceiver, Media, MediaStatus } from 'castv2-client';
import { promisify } from 'node:util';

export class CastPlayer {
  private readonly client: Client = new Client();
  private player?: DefaultMediaReceiver;
  private statusCallback?: (status: MediaStatus) => void;
  private _host?: string;

  get host(): string | undefined {
    return this._host;
  }

  onStatus(callback: (status: MediaStatus) => void): void {
    this.statusCallback = callback;
  }

  async connect(host: string): Promise<DefaultMediaReceiver> {
    await promisify(this.client.connect).bind(this.client)(host);

    this._host = host;

    this.player = await promisify(this.client.launch).bind(this.client)(DefaultMediaReceiver);

    this.player.on('status', (s) => this.statusCallback?.(s));

    return this.player;
  }

  async close(): Promise<void> {
    this.player?.close();
    this.client.close();
  }

  async loadVideo(title: string, videoUrl: string, subtitlesUrl?: string): Promise<MediaStatus> {
    if (!this.player) {
      throw new Error('Player not ready');
    }

    const media: Media = {
      // Here you can plug an URL to any mp4, webm, mp3 or jpg file with the proper contentType.
      contentId: videoUrl,
      contentType: 'video/mp4',
      streamType: 'BUFFERED', // or LIVE
      metadata: {
        type: 0,
        metadataType: 0,
        title,
      },
    };

    if (subtitlesUrl) {
      // Styling can be done like so
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

    return promisify(this.player.load).bind(this.player)(media, {
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

    this.statusCallback(status);
  }
}
