import type { Device, DevicesScanner } from '../../shared/types';
import { fetchDescription } from './description';
import { fetchProtocolInfo } from './protocolInfo';
import { SsdpScanner } from './ssdp';

export interface UpnpDevice extends Device {
  type: 'upnp';
  ip: string;
  avTransportControlUrl: string;
  avTransportEventSubUrl: string;
  // MIME types the renderer claims to accept in its ConnectionManager Sink.
  // Drives container compatibility decisions in [[checkCompat]].
  acceptedVideoMimes: ReadonlySet<string>;
}

interface DeviceRecord extends UpnpDevice {
  expiresAt: number;
}

const SEARCH_INTERVAL_MS = 10_000;
const EVICTION_INTERVAL_MS = 15_000;
// Cap device TTL: most renderers advertise 1800s, leaving shut-down devices in the list for 30min.
// We search every 10s, so 30s means a device is gone after ~3 missed responses.
const MAX_TTL_MS = 30_000;

export class UpnpDevicesScanner implements DevicesScanner<UpnpDevice> {
  readonly type = 'upnp';
  private readonly ssdp = new SsdpScanner();
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly rejectedIds = new Set<string>();
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
    const desc = await fetchDescription(location);
    if (!desc) {
      return;
    }
    const id = `upnp:${desc.udn}`;
    if (this.rejectedIds.has(id)) {
      return;
    }
    const previous = this.devices.get(id);
    const acceptedVideoMimes =
      previous?.acceptedVideoMimes ??
      (await fetchProtocolInfo(desc.connectionManagerControlUrl)
        .then((p) => p.videoMimes)
        .catch(() => undefined));
    if (!acceptedVideoMimes || acceptedVideoMimes.size === 0) {
      if (!previous) {
        this.rejectedIds.add(id);
      }
      return;
    }
    const record: DeviceRecord = {
      id,
      type: 'upnp',
      name: desc.friendlyName,
      ip: new URL(location).hostname,
      avTransportControlUrl: desc.avTransportControlUrl,
      avTransportEventSubUrl: desc.avTransportEventSubUrl,
      acceptedVideoMimes,
      expiresAt: Date.now() + Math.min(cacheMaxAge * 1000, MAX_TTL_MS),
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
