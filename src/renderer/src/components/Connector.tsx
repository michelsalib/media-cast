import { Cast, Tv } from '@mui/icons-material';
import { alpha, Button, ButtonBase, CircularProgress, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { Device } from '../../../shared/types';
import type { Connection } from '../App';
import { api, onEvent } from '../ipc';

type Props = {
  label: string;
  // Extra links after "Look again".
  actions?: React.ReactNode;
  connection: Connection | null;
  onSelect: (device: Device) => void;
};

const TYPE_LABELS: Record<Device['type'], string> = { upnp: 'TV', chromecast: 'Chromecast' };

export function Connector({ label, actions, connection, onSelect }: Props): React.JSX.Element {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    void api.refresh();
    return onEvent('scan', setDevices);
  }, []);

  function refresh(): void {
    void api.refresh();
    setScanning(true);
    setTimeout(() => setScanning(false), 1500);
  }

  // Scans drop a TV that misses a few SSDP replies (LG does) — the picked one must
  // stay on screen mid-session.
  const picked = connection?.device;
  const shown = picked && !devices.some((d) => d.id === picked.id) ? [picked, ...devices] : devices;
  const busy = connection?.state === 'CONNECTING';

  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', height: 30, pl: 0.5 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary', flex: 1 }}>
          {label}
        </Typography>
        <Button
          size="small"
          onClick={refresh}
          disabled={scanning}
          sx={{ color: 'primary.main', fontWeight: 600 }}
        >
          {scanning ? 'Looking…' : 'Look again'}
        </Button>
        {actions}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5 }}>
        {shown.map((d) => {
          const selected = picked?.id === d.id;
          const state = selected ? connection?.state : undefined;
          const Icon = d.type === 'chromecast' ? Cast : Tv;
          return (
            <ButtonBase
              key={d.id}
              onClick={() => !selected && onSelect(d)}
              disabled={busy && !selected}
              aria-pressed={selected}
              title={d.ip ? `${d.name} · ${d.ip}` : d.name}
              sx={{
                flex: '0 0 184px',
                height: 64,
                px: 1.75,
                gap: 1.5,
                justifyContent: 'flex-start',
                textAlign: 'left',
                borderRadius: '16px',
                bgcolor: selected ? 'tonal.primaryContainer' : 'tonal.surfaceContainerHigh',
                color: selected ? 'tonal.onPrimaryContainer' : 'tonal.onSurface',
                transition: 'background-color 150ms ease',
                '&:hover': {
                  bgcolor: (theme) =>
                    selected
                      ? alpha(theme.palette.tonal.primaryContainer, 0.85)
                      : theme.palette.tonal.surfaceContainerHighest,
                },
                '&.Mui-disabled': { opacity: 0.38 },
              }}
            >
              {state === 'CONNECTING' ? (
                <CircularProgress size={22} color="inherit" />
              ) : (
                <Icon sx={{ fontSize: 24, color: selected ? 'inherit' : 'primary.main' }} />
              )}
              <Stack sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600, fontSize: 14 }}>
                  {d.name}
                </Typography>
                <Typography noWrap sx={{ fontSize: 12, opacity: selected ? 0.8 : 0.7 }}>
                  {TYPE_LABELS[d.type]}
                  {state === 'CONNECTED' && ' · connected'}
                  {state === 'CONNECTING' && ' · connecting…'}
                </Typography>
              </Stack>
            </ButtonBase>
          );
        })}

        {!shown.length && (
          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              flex: '0 0 auto',
              height: 64,
              px: 2.5,
              alignItems: 'center',
              borderRadius: '16px',
              border: '1px dashed',
              borderColor: 'tonal.outlineVariant',
              color: 'text.secondary',
            }}
          >
            <CircularProgress size={18} />
            <Typography sx={{ fontSize: 14 }}>
              Looking for TVs and Chromecasts on your network…
            </Typography>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
