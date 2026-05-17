import { soapCall } from './soap';
import { extractTag } from './xml';

const CONNECTION_MANAGER = 'urn:schemas-upnp-org:service:ConnectionManager:1';

export interface ProtocolInfo {
  videoMimes: ReadonlySet<string>;
}

// Parse the renderer's ConnectionManager::GetProtocolInfo Sink list. Each entry is
// `protocol:network:mime[;params]:extra` — we keep the MIME (stripped of params,
// lowercased) for entries whose type is `video/*`. Used both as a "this is a video
// sink" filter and to drive per-device content negotiation in compat.ts.
export async function fetchProtocolInfo(controlUrl: string): Promise<ProtocolInfo> {
  const xml = await soapCall(controlUrl, 'GetProtocolInfo', {}, CONNECTION_MANAGER);
  const sink = extractTag(xml, 'Sink') ?? '';
  const videoMimes = new Set<string>();
  for (const entry of sink.split(',')) {
    const mime = entry.split(':')[2]?.split(';')[0]?.trim().toLowerCase();
    if (mime?.startsWith('video/')) {
      videoMimes.add(mime);
    }
  }
  return { videoMimes };
}
