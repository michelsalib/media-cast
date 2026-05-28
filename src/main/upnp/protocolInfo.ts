import { soapCall } from './soap';
import { extractTag } from './xml';

const CONNECTION_MANAGER = 'urn:schemas-upnp-org:service:ConnectionManager:1';

export interface ProtocolInfo {
  videoMimes: ReadonlySet<string>;
  // Subset of videoMimes whose protocolInfo additional-info field is `*` — the
  // renderer accepts the container with any codec inside. Lets us lift the
  // direct-play codec allow-list per-MIME in [[checkCompat]].
  wildcardVideoMimes: ReadonlySet<string>;
}

// Parse the renderer's ConnectionManager::GetProtocolInfo Sink list. Each entry is
// `protocol:network:mime[;params]:additional-info` — we keep the MIME (stripped of
// params, lowercased) for entries whose type is `video/*`, and separately track
// the subset where additional-info is `*` (codec wildcard).
export async function fetchProtocolInfo(controlUrl: string): Promise<ProtocolInfo> {
  const xml = await soapCall(controlUrl, 'GetProtocolInfo', {}, CONNECTION_MANAGER);
  const sink = extractTag(xml, 'Sink') ?? '';
  const videoMimes = new Set<string>();
  const wildcardVideoMimes = new Set<string>();
  for (const entry of sink.split(',')) {
    const parts = entry.split(':');
    const mime = parts[2]?.split(';')[0]?.trim().toLowerCase();
    const additionalInfo = parts[3]?.trim();
    if (mime?.startsWith('video/')) {
      videoMimes.add(mime);
      if (additionalInfo === '*') {
        wildcardVideoMimes.add(mime);
      }
    }
  }
  return { videoMimes, wildcardVideoMimes };
}
