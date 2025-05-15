declare module 'castv2-client' {
  import type { EventEmitter } from 'node:stream';

  export interface ApplicationStatus {
    REMOVE_ME: string;
  }

  export interface ClientStatus {
    isActiveInput: boolean;
    isStandby: boolean;
    applications?: ApplicationStatus[];
    volume: {
      controlType: 'fixed';
      level: number;
      muted: boolean;
      stepInterval: number;
    };
  }

  export interface MediaStatus {
    activeTrackIds: number[];
    currentItemId: number;
    currentTime: number;
    extendedStatus: {
      playerState: 'LOADING';
      media: Media;
    };
    media?: Media;
    mediaSessionId: number;
    playbackRate: number;
    playerState: 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED';
    repeatMode: 'REPEAT_OFF';
    supportedMediaCommands: number;
    videoInfo?: {
      hdrType: 'sdr';
      height: number;
      width: number;
    };
    volume: {
      level: 1;
      muted: boolean;
    };
  }

  export interface LoadOptions {
    autoplay?: boolean;
    activeTrackIds?: number[];
  }

  export interface Media {
    contentId: string;
    contentType: 'video/mp4';
    streamType: 'BUFFERED';
    duration?: number;
    mediaCategory?: 'VIDEO';
    textTrackStyle?: {
      backgroundColor?: `#${string}`;
      foregroundColor?: `#${string}`;
      edgeType?: 'OUTLINE' | 'NONE' | 'DROP_SHADOW' | 'RAISED' | 'DEPRESSED';
      edgeColor?: `#${string}`;
      fontScale?: number;
      fontStyle?: 'NORMAL' | 'BOLD' | 'BOLD_ITALIC' | 'ITALIC';
      fontFamily?: 'Droid Sans';
      fontGenericFamily?:
        | 'SANS_SERIF'
        | 'CURSIVE'
        | 'MONOSPACED_SANS_SERIF'
        | 'SERIF'
        | 'MONOSPACED_SERIF'
        | 'CASUAL'
        | 'SMALL_CAPITALS';
      windowColor?: `#${string}`;
      windowRoundedCornerRadius?: number;
      windowType?: 'NONE' | 'NORMAL' | 'ROUNDED_CORNERS';
    };
    tracks?: {
      trackId: number;
      type: 'TEXT';
      name: string;
      language: `${string}-${string}`;
      subtype: 'SUBTITLES';
      trackContentId: string;
      trackContentType: 'text/vtt';
    }[];
    metadata?: {
      type: number;
      metadataType: number;
      title: string;
      images?: {
        url: string;
      }[];
    };
  }

  export interface Callback<T> {
    (error: Error, result: T): void;
  }

  export class Client {
    connect(host: string, callback: Callback<void>): void;
    getStatus(callback: Callback<ClientStatus>): void;
    close(): void;
    getSessions(callback: Callback<any>): void;
    getAppAvailability(appId: string, callback: Callback<any>): void;
    join<T extends Application>(
      session: string,
      application: { new (): T },
      callback?: Callback<T>
    ): void;
    launch<T extends Application>(application: { new (): T }, callback?: Callback<T>): void;
    stop(application: any, callback: Callback<any>): void;
    setVolume(volume: number, callback: Callback<any>): void;
    getVolume(callback: Callback<any>): void;
  }

  type ApplicationEventMap = {
    status: [MediaStatus];
  };

  export class Application extends EventEmitter<ApplicationEventMap> {
    close(): void;
  }

  export class DefaultMediaReceiver extends Application {
    APP_ID: string;
    getStatus(callback: Callback<any>): void;
    load(media: Media, options: LoadOptions, callback: Callback<MediaStatus>): void;
    play(callback: Callback<any>): void;
    pause(callback: Callback<any>): void;
    stop(callback: Callback<any>): void;
    seek(currentTime: number, callback: Callback<any>): void;
    queueLoad(items: any, options: any, callback: Callback<any>): void;
    queueInsert(items: any, options: any, callback: Callback<any>): void;
    queueRemove(itemIds: any, options: any, callback: Callback<any>): void;
    queueReorder(itemIds: any, options: any, callback: Callback<any>): void;
    queueUpdate(items: any, callback: Callback<any>): void;
  }
}
