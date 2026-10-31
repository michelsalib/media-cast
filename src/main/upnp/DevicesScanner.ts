import type { Device, DevicesScanner } from '../../shared/types';
import { fetchDescription } from './description';
import { fetchProtocolInfo } from './protocolInfo';
import { SsdpScanner } from './ssdp';

export interface UpnpDevice extends Device {
  type: 'upnp';
  ip: string;
  avTransportControlUrl: string;
  avTransportEventSubUrl: string;
  renderingControl?: { controlUrl: string; eventSubUrl?: string };
  // Always known for UPnP — narrows Device's optional Sink fields.
  acceptedVideoMimes: readonly string[];
  acceptedWildcardVideoMimes: readonly string[];
}

interface DeviceRecord extends UpnpDevice {
  expiresAt: number;
}

const SEARCH_INTERVAL_MS = 10_000;
const EVICTION_INTERVAL_MS = 15_000;
// Cap device TTL: most renderers advertise 1800s, leaving shut-down devices in the list for 30min.
// We search every 10s, so 30s means a device is gone after ~3 missed responses.
const MAX_TTL_MS = 30_000;
// Long enough that a non-video renderer (e.g. a soundbar) isn't re-queried every minute.
const REJECTION_TTL_MS = 10 * 60_000;

export class UpnpDevicesScanner implements DevicesScanner<UpnpDevice> {
  readonly type = 'upnp';
  private readonly ssdp = new SsdpScanner();
  private readonly devices = new Map<string, DeviceRecord>();
  // Description URLs that turned out not to be video renderers, keyed by SSDP LOCATION.
  private readonly rejectedUntil = new Map<string, number>();
  private readonly idByLocation = new Map<string, string>();
  private callback?: (devices: UpnpDevice[]) => void;
  private readonly searchTimer: NodeJS.Timeout;
  private readonly evictionTimer: NodeJS.Timeout;

  constructor() {
    this.ssdp.start((resp) => {
      this.handleSsdpResponse(resp.location, resp.cacheMaxAge).catch(() => {});
    });

    this.searchTimer = setInterval(() => this.ssdp.search(), SEARCH_INTERVAL_MS);
    this.evictionTimer = setInterval(() => this.evictExpired(), EVICTION_INTERVAL_MS);
  }

  private async handleSsdpResponse(location: string, cacheMaxAge: number): Promise<void> {
    const expiresAt = Date.now() + Math.min(cacheMaxAge * 1000, MAX_TTL_MS);
    // A known renderer answers every search on every interface: just extend its TTL
    // rather than refetching its description each time.
    const knownId = this.idByLocation.get(location);
    const known = knownId ? this.devices.get(knownId) : undefined;
    if (known) {
      known.expiresAt = expiresAt;
      return;
    }
    if ((this.rejectedUntil.get(location) ?? 0) > Date.now()) {
      return;
    }

    const desc = await fetchDescription(location);
    if (!desc) {
      return;
    }
    const id = `upnp:${desc.udn}`;
    const previous = this.devices.get(id);
    const protocolInfo = previous
      ? {
          videoMimes: previous.acceptedVideoMimes,
          wildcardVideoMimes: previous.acceptedWildcardVideoMimes,
        }
      : await fetchProtocolInfo(desc.connectionManagerControlUrl).catch(() => undefined);
    if (!protocolInfo || protocolInfo.videoMimes.length === 0) {
      // Not a video renderer — or one whose ConnectionManager is still booting, so
      // retry after a while instead of hiding it until restart.
      if (!previous) {
        this.rejectedUntil.set(location, Date.now() + REJECTION_TTL_MS);
      }
      return;
    }
    this.idByLocation.set(location, id);
    const record: DeviceRecord = {
      id,
      type: 'upnp',
      name: desc.friendlyName,
      ip: new URL(location).hostname,
      avTransportControlUrl: desc.avTransportControlUrl,
      avTransportEventSubUrl: desc.avTransportEventSubUrl,
      renderingControl: desc.renderingControl,
      acceptedVideoMimes: protocolInfo.videoMimes,
      acceptedWildcardVideoMimes: protocolInfo.wildcardVideoMimes,
      expiresAt,
    };
    this.devices.set(id, record);
    if (!previous || previous.name !== record.name) {
      this.emit();
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, dev] of this.devices) {
      if (dev.expiresAt < now) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.emit();
    }
  }

  private emit(): void {
    if (!this.callback) {
      return;
    }
    this.callback(
      [...this.devices.values()].map(({ expiresAt: _expiresAt, ...d }): UpnpDevice => d)
    );
  }

  onDevices(callback: (devices: UpnpDevice[]) => void): void {
    this.callback = callback;
    this.emit();
  }

  refresh(): void {
    this.ssdp.search();
    this.emit();
  }

  close(): void {
    clearInterval(this.searchTimer);
    clearInterval(this.evictionTimer);
    this.ssdp.close();
  }
}
