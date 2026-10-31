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

export function localIPv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === 'IPv4' && !i.internal)
    .map((i) => i?.address)
    .filter((a): a is string => !!a);
}

// Adapters only this computer can reach: WSL, Hyper-V, Docker, VM host-only networks.
const VIRTUAL_ADAPTER =
  /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|^(docker|br-|veth|virbr|vboxnet|vmnet)/i;

// Addresses another device on the network (a phone) can reach this computer at: no
// virtual adapters, no link-local, home networks (192.168/16) first.
export function lanAddresses(): string[] {
  const rank = (ip: string): number =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2;
  return Object.entries(networkInterfaces())
    .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
    .flatMap(([, ifaces]) => ifaces ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address)
    .sort((a, b) => rank(a) - rank(b));
}
