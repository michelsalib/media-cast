import { Cast, CheckRounded, Tv } from '@mui/icons-material';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  keyframes,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { Device } from '../../../shared/types';
import type { Connection } from '../App';
import { api, onEvent } from '../ipc';

type Props = {
  label: string;
  connection: Connection | null;
  onSelect: (device: Device) => void;
};

const pulse = keyframes`
  0%   { box-shadow: 0 0 0 0   rgba(94,242,192,0.45); }
  70%  { box-shadow: 0 0 0 8px rgba(94,242,192,0);    }
  100% { box-shadow: 0 0 0 0   rgba(94,242,192,0);    }
`;

const ICON_BACKGROUNDS: Record<Device['type'], string> = {
  upnp: 'linear-gradient(160deg, #6FD3FF, #2E6BE6)',
  chromecast: 'linear-gradient(160deg, #FF8A5B, #E5487A)',
};

export function Connector({ label, connection, onSelect }: Props): React.JSX.Element {
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
    <Stack spacing={1.25} sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: 30 }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{label}</Typography>
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            animation: `${pulse} 2s infinite ease-out`,
          }}
        />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          onClick={refresh}
          disabled={scanning}
          sx={{ color: 'text.secondary', fontWeight: 500 }}
        >
          {scanning ? 'Looking…' : 'Look again'}
        </Button>
      </Stack>

      <Stack direction="row" spacing={1.25} sx={{ overflowX: 'auto', pb: 0.5 }}>
        {shown.map((d) => {
          const selected = picked?.id === d.id;
          const connecting = selected && connection?.state === 'CONNECTING';
          const Icon = d.type === 'chromecast' ? Cast : Tv;
          return (
            <ButtonBase
              key={d.id}
              onClick={() => !selected && onSelect(d)}
              disabled={busy && !selected}
              aria-pressed={selected}
              title={d.ip ? `${d.name} · ${d.ip}` : d.name}
              sx={{
                flex: '0 0 196px',
                height: 68,
                px: 1.75,
                gap: 1.5,
                justifyContent: 'flex-start',
                textAlign: 'left',
                borderRadius: '16px',
                position: 'relative',
                border: '2px solid',
                borderColor: selected ? 'primary.main' : 'transparent',
                bgcolor: selected ? 'rgba(94,242,192,0.12)' : 'rgba(255,255,255,0.07)',
                transition: 'background-color 150ms ease, border-color 150ms ease',
                '&:hover': {
                  bgcolor: selected ? 'rgba(94,242,192,0.16)' : 'rgba(255,255,255,0.12)',
                },
                '&.Mui-disabled': { opacity: 0.5 },
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '12px',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  background: ICON_BACKGROUNDS[d.type],
                }}
              >
                {connecting ? (
                  <CircularProgress size={18} sx={{ color: 'white' }} />
                ) : (
                  <Icon sx={{ fontSize: 20 }} />
                )}
              </Box>
              <Stack sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600, fontSize: 15 }}>
                  {d.name}
                </Typography>
                <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {d.type === 'chromecast' ? 'Chromecast' : 'TV'}
                </Typography>
              </Stack>
              {selected && !connecting && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <CheckRounded sx={{ fontSize: 14 }} />
                </Box>
              )}
            </ButtonBase>
          );
        })}

        {!shown.length && (
          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              flex: '0 0 auto',
              height: 68,
              px: 2.5,
              alignItems: 'center',
              borderRadius: '16px',
              border: '2px dashed rgba(255,255,255,0.12)',
            }}
          >
            <CircularProgress size={18} />
            <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
              Looking for TVs and Chromecasts on your network…
            </Typography>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
