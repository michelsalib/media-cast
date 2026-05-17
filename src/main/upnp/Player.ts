import type { LoadVideoOptions, PlayerState, PlayerStatus, Renderer } from '../../shared/types';
import { UpnpEventing } from './eventing';
import { soapCall } from './soap';
import { escapeXml, extractAttr, extractTag, unescapeXml } from './xml';

export interface UpnpPlayerInfo {
  avTransportControlUrl: string;
  avTransportEventSubUrl: string;
  targetIp: string;
}

export class UpnpPlayer implements Renderer {
  private readonly controlUrl: string;
  private readonly eventing: UpnpEventing;
  private statusCallback?: (status: PlayerStatus) => void;
  private currentTitle?: string;
  private duration?: number;
  private currentTime = 0;
  private playerState: PlayerState = 'IDLE';

  constructor(info: UpnpPlayerInfo) {
    this.controlUrl = info.avTransportControlUrl;
    this.eventing = new UpnpEventing({
      eventSubUrl: info.avTransportEventSubUrl,
      targetIp: info.targetIp,
      onEvent: (xml) => this.handleEvent(xml),
    });
  }

  onStatus(callback: (status: PlayerStatus) => void): void {
    this.statusCallback = callback;
  }

  async connect(): Promise<void> {
    await this.eventing.start();
  }

  async close(): Promise<void> {
    await soapCall(this.controlUrl, 'Stop', { InstanceID: '0' }).catch(() => {});
    // Stop alone leaves the video loaded on most DLNA renderers (TV still shows the title /
    // last frame). Clearing the AVTransport URI is what actually unloads it.
    await soapCall(this.controlUrl, 'SetAVTransportURI', {
      InstanceID: '0',
      CurrentURI: '',
      CurrentURIMetaData: '',
    }).catch(() => {});
    await this.eventing.stop();
  }

  async loadVideo({
    title,
    videoUrl,
    videoMimeType = 'video/mpeg',
    videoTranscoded = true,
    subtitlesUrl,
    subtitlesFormat,
    duration,
  }: LoadVideoOptions): Promise<void> {
    this.currentTitle = title;
    this.duration = duration;
    this.currentTime = 0;
    const metadata = buildDidlMetadata({
      title,
      videoUrl,
      videoMimeType,
      videoTranscoded,
      subtitlesUrl,
      subtitlesFormat,
      duration,
    });
    // Many DLNA renderers reject SetAVTransportURI with 701 "Transition not available" unless
    // they are STOPPED — so loading a second video without going through close() fails. Stop
    // first; ignore errors (already-stopped renderers return 701 for Stop itself).
    await soapCall(this.controlUrl, 'Stop', { InstanceID: '0' }).catch(() => {});
    await soapCall(this.controlUrl, 'SetAVTransportURI', {
      InstanceID: '0',
      CurrentURI: videoUrl,
      CurrentURIMetaData: metadata,
    });

    // Old Samsung TVs return UPnP 501 "Action Failed" when Play is called during TRANSITIONING.
    // Wait until the renderer is past preload, then only send Play if it didn't auto-start.
    const state = await this.waitWhileTransitioning(10_000);
    if (state !== 'PLAYING') {
      // Transcoded MPEG-TS streams can leave the TV buffering past the SOAP timeout —
      // Play then times out even though the TV starts on its own a beat later. GENA
      // events deliver the real state, so this is best-effort.
      await this.play().catch((err) => console.warn('[upnp] Play after load failed:', err));
    }
  }

  private async waitWhileTransitioning(timeoutMs: number): Promise<string | undefined> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const xml = await soapCall(this.controlUrl, 'GetTransportInfo', { InstanceID: '0' });
        const state = extractTag(xml, 'CurrentTransportState')?.trim();
        if (state && state !== 'TRANSITIONING') {
          return state;
        }
      } catch {
        return undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return undefined;
  }

  async play(): Promise<void> {
    await soapCall(this.controlUrl, 'Play', { InstanceID: '0', Speed: '1' });
  }

  async pause(): Promise<void> {
    await soapCall(this.controlUrl, 'Pause', { InstanceID: '0' });
  }

  async seek(time: number): Promise<void> {
    await soapCall(this.controlUrl, 'Seek', {
      InstanceID: '0',
      Unit: 'REL_TIME',
      Target: secondsToHms(time),
    });
  }

  async getStatus(): Promise<void> {
    if (!this.statusCallback) {
      return;
    }
    try {
      const positionXml = await soapCall(this.controlUrl, 'GetPositionInfo', { InstanceID: '0' });
      const durationStr = extractTag(positionXml, 'TrackDuration');
      const relTimeStr = extractTag(positionXml, 'RelTime');
      if (durationStr) {
        const seconds = hmsToSeconds(durationStr);
        if (seconds > 0) {
          this.duration = seconds;
        }
      }
      if (relTimeStr) {
        this.currentTime = hmsToSeconds(relTimeStr);
      }

      const transportXml = await soapCall(this.controlUrl, 'GetTransportInfo', { InstanceID: '0' });
      this.playerState = mapTransportState(extractTag(transportXml, 'CurrentTransportState'));

      this.emit();
    } catch {
      // Renderer is mid-operation or unreachable — leave state as-is.
    }
  }

  private emit(): void {
    this.statusCallback?.({
      playerState: this.playerState,
      currentTime: this.currentTime,
      duration: this.duration,
      title: this.currentTitle,
    });
  }

  private handleEvent(xml: string): void {
    // Body shape:
    //   <e:propertyset><e:property><LastChange>&lt;Event xmlns=...&gt;...&lt;/Event&gt;</LastChange></e:property></e:propertyset>
    const lastChangeRaw = extractTag(xml, 'LastChange');
    if (!lastChangeRaw) {
      return;
    }
    const inner = unescapeXml(lastChangeRaw);

    const state = extractAttr(inner, 'TransportState', 'val');
    if (state) {
      this.playerState = mapTransportState(state);
    }

    const dur = extractAttr(inner, 'CurrentTrackDuration', 'val');
    if (dur) {
      const seconds = hmsToSeconds(dur);
      if (seconds > 0) {
        this.duration = seconds;
      }
    }

    const meta = extractAttr(inner, 'CurrentTrackMetaData', 'val');
    if (meta) {
      const t = extractTag(unescapeXml(meta), 'title');
      if (t) {
        this.currentTitle = t.trim();
      }
    }

    this.emit();
  }
}

function secondsToHms(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function hmsToSeconds(hms: string): number {
  const parts = hms.split(':');
  if (parts.length !== 3) {
    return 0;
  }
  const [h, m, s] = parts.map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) {
    return 0;
  }
  return h * 3600 + m * 60 + s;
}

function mapTransportState(state: string | undefined): PlayerState {
  switch (state) {
    case 'PLAYING':
      return 'PLAYING';
    case 'PAUSED_PLAYBACK':
    case 'PAUSED_RECORDING':
    case 'PAUSED':
      return 'PAUSED';
    case 'TRANSITIONING':
      return 'BUFFERING';
    default:
      return 'IDLE';
  }
}

interface DidlOptions {
  title: string;
  videoUrl: string;
  videoMimeType: string;
  videoTranscoded: boolean;
  subtitlesUrl?: string;
  subtitlesFormat?: 'vtt' | 'srt' | 'smi';
  duration?: number;
}

function buildDidlMetadata({
  title,
  videoUrl,
  videoMimeType,
  videoTranscoded,
  subtitlesUrl,
  subtitlesFormat = 'smi',
  duration,
}: DidlOptions): string {
  const subMime =
    subtitlesFormat === 'smi'
      ? 'application/smil'
      : subtitlesFormat === 'srt'
        ? 'application/x-subrip'
        : 'text/vtt';
  const captionInfo = subtitlesUrl
    ? `<sec:CaptionInfoEx sec:type="${subtitlesFormat}">${escapeXml(subtitlesUrl)}</sec:CaptionInfoEx>` +
      `<sec:CaptionInfo sec:type="${subtitlesFormat}">${escapeXml(subtitlesUrl)}</sec:CaptionInfo>` +
      `<res protocolInfo="http-get:*:${subMime}:*">${escapeXml(subtitlesUrl)}</res>`
    : '';

  // Transcoded: MPEG-TS, time-based seek (OP=10), CI=1, FLAGS bit 30 (lsop_TimeBasedSeek) set.
  // Direct play: native container, byte-range seek (OP=01), CI=0, no PN so the TV doesn't
  // reject the file on a profile/level mismatch.
  const videoProtocolInfo = videoTranscoded
    ? `http-get:*:${videoMimeType}:DLNA.ORG_PN=MPEG_TS_SD_EU_ISO;DLNA.ORG_OP=10;DLNA.ORG_CI=1;DLNA.ORG_FLAGS=CD700000000000000000000000000000`
    : `http-get:*:${videoMimeType}:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000`;

  const durationAttr =
    duration && Number.isFinite(duration) ? ` duration="${secondsToHmsMs(duration)}"` : '';
  // pv:subtitleFileUri / Type — non-standard attrs many old DLNA TVs (incl. Samsung) actually honor
  // for sidecar subtitles, in addition to / instead of sec:CaptionInfoEx.
  const pvSubsAttrs = subtitlesUrl
    ? ` pv:subtitleFileUri="${escapeXml(subtitlesUrl)}" pv:subtitleFileType="${subtitlesFormat}"`
    : '';

  return (
    `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ` +
    `xmlns:sec="http://www.sec.co.kr/" ` +
    `xmlns:pv="http://www.pv.com/pvns/">` +
    `<item id="1" parentID="0" restricted="1">` +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    `<upnp:class>object.item.videoItem.movie</upnp:class>` +
    `<upnp:storageMedium>UNKNOWN</upnp:storageMedium>` +
    `<res protocolInfo="${videoProtocolInfo}"${durationAttr}${pvSubsAttrs}>${escapeXml(videoUrl)}</res>` +
    captionInfo +
    `</item>` +
    `</DIDL-Lite>`
  );
}

function secondsToHmsMs(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sStr = s.toFixed(3).padStart(6, '0'); // SS.fff
  return `${h}:${String(m).padStart(2, '0')}:${sStr}`;
}
