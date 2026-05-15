import { networkInterfaces } from 'node:os';

export function pickLocalIpFor(targetIp: string): string {
  const ifaces = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === 'IPv4' && !i.internal);

  const target = ipToInt(targetIp);
  if (target !== undefined) {
    for (const iface of ifaces) {
      if (!iface?.netmask) {
        continue;
      }
      const addr = ipToInt(iface.address);
      const mask = ipToInt(iface.netmask);
      if (addr === undefined || mask === undefined) {
        continue;
      }
      if ((addr & mask) === (target & mask)) {
        return iface.address;
      }
    }
  }

  return ifaces[0]?.address ?? '127.0.0.1';
}

function ipToInt(ip: string): number | undefined {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return undefined;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
