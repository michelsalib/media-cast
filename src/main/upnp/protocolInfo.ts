import { soapCall } from './soap';
import { extractTag } from './xml';

const CONNECTION_MANAGER = 'urn:schemas-upnp-org:service:ConnectionManager:1';

export async function supportsVideoSink(controlUrl: string): Promise<boolean> {
  const xml = await soapCall(controlUrl, 'GetProtocolInfo', {}, CONNECTION_MANAGER);
  const sink = extractTag(xml, 'Sink') ?? '';
  return sink
    .split(',')
    .map((p) => p.split(':')[2]?.trim().toLowerCase() ?? '')
    .some((mime) => mime.startsWith('video/'));
}
