import type {
  LoadVideoOptions,
  PlayerState,
  PlayerStatus,
  Renderer,
  Volume,
} from '../../shared/types';
import { DIRECT_PLAY_FEATURES, TRANSCODED_FEATURES } from './dlna';
import { UpnpEventing } from './eventing';
import { soapCall } from './soap';
import { escapeXml, extractAttr, extractTag, unescapeXml } from './xml';

export interface UpnpPlayerInfo {
  avTransportControlUrl: string;
  avTransportEventSubUrl: string;
  renderingControl?: { controlUrl: string; eventSubUrl?: string };
  targetIp: string;
}

const STATE_EVENT_STALE_MS = 10_000;
const VOLUME_POLL_MS = 5_000;
const RENDERING_CONTROL = 'urn:schemas-upnp-org:service:RenderingControl:1';
// The spec leaves the range to the renderer (its SCPD); TVs use 0–100.
const MAX_VOLUME = 100;

export class UpnpPlayer implements Renderer {
  private readonly controlUrl: string;
  private readonly eventing: UpnpEventing;
  private readonly volumeUrl?: string;
  private readonly volumeEventing?: UpnpEventing;
  private statusCallback?: (status: PlayerStatus) => void;
  private currentTitle?: string;
  private duration?: number;
  private currentTime = 0;
  private playerState: PlayerState = 'IDLE';
  private lastStateEventAt = 0;
  private volume?: Volume;
  private volumePolledAt = 0;
  // RenderingControl events carry the volume: no need to poll it.
  private volumeEvented = false;

  constructor(info: UpnpPlayerInfo) {
    this.controlUrl = info.avTransportControlUrl;
    this.eventing = new UpnpEventing({
      eventSubUrl: info.avTransportEventSubUrl,
      targetIp: info.targetIp,
      onEvent: (xml) => this.handleEvent(xml),
    });
    this.volumeUrl = info.renderingControl?.controlUrl;
    const volumeEventSubUrl = info.renderingControl?.eventSubUrl;
    if (volumeEventSubUrl) {
      this.volumeEventing = new UpnpEventing({
        eventSubUrl: volumeEventSubUrl,
        targetIp: info.targetIp,
        onEvent: (xml) => this.handleVolumeEvent(xml),
      });
    }
  }

  onStatus(callback: (status: PlayerStatus) => void): void {
    this.statusCallback = callback;
  }

  async connect(): Promise<void> {
    await this.eventing.start();
    if (this.volumeUrl) {
      // Volume is a nicety: a renderer that won't tell it just shows no control.
      await this.readVolume().catch(() => {});
      await this.volumeEventing
        ?.start()
        .catch((err) => console.warn('[upnp] RenderingControl subscription failed:', err));
    }
  }

  async close(): Promise<void> {
    await soapCall(this.controlUrl, 'Stop', { InstanceID: '0' }).catch(() => {});
    // Note: don't SetAVTransportURI('') here. On LG TVs the empty-URI call leaves the
    // renderer in vendor-specific LG_TRANSITIONING and it never resolves — every later
    // SetAVTransportURI then fails with UPnP 701 "Transition not available" until the
    // TV is rebooted. Stop alone leaves the title/last frame on screen, which is the
    // lesser evil; the next load replaces it anyway.
    await this.eventing.stop();
    await this.volumeEventing?.stop();
  }

  async loadVideo({
    title,
    videoUrl,
    videoMimeType = 'video/mpeg',
    videoTranscoded = true,
    subtitlesUrl,
    subtitlesFormat,
    duration,
    size,
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
      size,
    });
    // Stop → SetAVTransportURI → Play is the spec sequence. Swapping the URI under a
    // playing renderer makes it tear down a live pipeline mid-request, and LG answers
    // UPnP 701 "Transition not available" while its vendor LG_TRANSITIONING state is
    // active — so stop first, then wait the transition out before issuing the new URI.
    const before = await this.waitWhileTransitioning(5_000);
    if (before !== 'STOPPED' && before !== 'NO_MEDIA_PRESENT') {
      await soapCall(this.controlUrl, 'Stop', { InstanceID: '0' }).catch(() => {});
      await this.waitWhileTransitioning(5_000);
    }
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
        const xml = await soapCall(
          this.controlUrl,
          'GetTransportInfo',
          { InstanceID: '0' },
          undefined,
          { quiet: true }
        );
        const state = extractTag(xml, 'CurrentTransportState')?.trim();
        // LG reports vendor-specific "LG_TRANSITIONING" instead of the spec "TRANSITIONING";
        // match any state containing "TRANSITIONING" so we don't proceed prematurely.
        if (state && !state.includes('TRANSITIONING')) {
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
      const positionXml = await soapCall(
        this.controlUrl,
        'GetPositionInfo',
        { InstanceID: '0' },
        undefined,
        { quiet: true }
      );
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

      // GENA already pushes TransportState; only poll it when events have gone quiet
      // (subscription lost, or a renderer that doesn't event it) to halve the SOAP load
      // on the TV.
      if (Date.now() - this.lastStateEventAt > STATE_EVENT_STALE_MS) {
        const transportXml = await soapCall(
          this.controlUrl,
          'GetTransportInfo',
          { InstanceID: '0' },
          undefined,
          { quiet: true }
        );
        this.playerState = mapTransportState(extractTag(transportXml, 'CurrentTransportState'));
      }

      // Same for the volume, changed with the TV's own remote: polled, slower, only on
      // renderers that don't event it.
      if (
        this.volumeUrl &&
        !this.volumeEvented &&
        Date.now() - this.volumePolledAt > VOLUME_POLL_MS
      ) {
        await this.readVolume();
      }

      this.emit();
    } catch {
      // Renderer is mid-operation or unreachable — leave state as-is.
    }
  }

  async setVolume({ level, muted }: Partial<Volume>): Promise<void> {
    if (!this.volumeUrl) {
      throw new Error('This TV doesn’t let its volume be changed');
    }
    if (level !== undefined) {
      const desired = Math.round(Math.min(1, Math.max(0, level)) * MAX_VOLUME);
      await soapCall(
        this.volumeUrl,
        'SetVolume',
        { InstanceID: '0', Channel: 'Master', DesiredVolume: String(desired) },
        RENDERING_CONTROL
      );
      this.volume = { level: desired / MAX_VOLUME, muted: this.volume?.muted ?? false };
    }
    if (muted !== undefined) {
      await soapCall(
        this.volumeUrl,
        'SetMute',
        { InstanceID: '0', Channel: 'Master', DesiredMute: muted ? '1' : '0' },
        RENDERING_CONTROL
      );
      this.volume = { level: this.volume?.level ?? 0, muted };
    }
    this.emit();
  }

  private async readVolume(): Promise<void> {
    if (!this.volumeUrl) {
      return;
    }
    this.volumePolledAt = Date.now();
    const args = { InstanceID: '0', Channel: 'Master' };
    const volumeXml = await soapCall(this.volumeUrl, 'GetVolume', args, RENDERING_CONTROL, {
      quiet: true,
    });
    const level = Number(extractTag(volumeXml, 'CurrentVolume'));
    if (!Number.isFinite(level)) {
      return;
    }
    // Mute is optional in the spec.
    const muteXml = await soapCall(this.volumeUrl, 'GetMute', args, RENDERING_CONTROL, {
      quiet: true,
    }).catch(() => undefined);
    this.volume = {
      level: Math.min(1, level / MAX_VOLUME),
      muted: isTrue(muteXml && extractTag(muteXml, 'CurrentMute')),
    };
  }

  private handleVolumeEvent(xml: string): void {
    const lastChangeRaw = extractTag(xml, 'LastChange');
    if (!lastChangeRaw) {
      return;
    }
    const inner = unescapeXml(lastChangeRaw);
    const level = Number(masterValue(inner, 'Volume'));
    const mute = masterValue(inner, 'Mute');
    if (!Number.isFinite(level) && mute === undefined) {
      return;
    }
    this.volumeEvented = true;
    this.volume = {
      level: Number.isFinite(level) ? Math.min(1, level / MAX_VOLUME) : (this.volume?.level ?? 0),
      muted: mute !== undefined ? isTrue(mute) : (this.volume?.muted ?? false),
    };
    this.emit();
  }

  private emit(): void {
    this.statusCallback?.({
      volume: this.volume,
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
      this.lastStateEventAt = Date.now();
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

// The `val` of the Master channel's `tag` in a RenderingControl LastChange (Volume and
// Mute come once per channel: Master, LF, RF…).
function masterValue(xml: string, tag: string): string | undefined {
  for (const [element] of xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>`, 'gi'))) {
    const channel = extractAttr(element, tag, 'channel');
    if (channel === undefined || channel === 'Master') {
      return extractAttr(element, tag, 'val');
    }
  }
  return undefined;
}

function isTrue(value: string | undefined): boolean {
  return value?.trim() === '1' || value?.trim().toLowerCase() === 'true';
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
  // LG reports vendor-specific LG_TRANSITIONING — same meaning as the spec word.
  if (state?.includes('TRANSITIONING')) {
    return 'BUFFERING';
  }
  switch (state) {
    case 'PLAYING':
      return 'PLAYING';
    case 'PAUSED_PLAYBACK':
    case 'PAUSED_RECORDING':
    case 'PAUSED':
      return 'PAUSED';
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
  size?: number;
}

function buildDidlMetadata({
  title,
  videoUrl,
  videoMimeType,
  videoTranscoded,
  subtitlesUrl,
  subtitlesFormat = 'smi',
  duration,
  size,
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

  const videoProtocolInfo = `http-get:*:${videoMimeType}:${
    videoTranscoded ? TRANSCODED_FEATURES : DIRECT_PLAY_FEATURES
  }`;

  const durationAttr =
    duration && Number.isFinite(duration) ? ` duration="${secondsToHmsMs(duration)}"` : '';
  // Direct play only: lets the renderer size byte-range seeks without a HEAD first.
  const sizeAttr = size && !videoTranscoded ? ` size="${size}"` : '';
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
    `<res protocolInfo="${videoProtocolInfo}"${durationAttr}${sizeAttr}${pvSubsAttrs}>${escapeXml(videoUrl)}</res>` +
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
