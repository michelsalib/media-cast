import { Cast, CheckCircle, Refresh, Tv } from '@mui/icons-material';
import {
  alpha,
  Box,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  IconButton,
  keyframes,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { Device } from '../../../shared/types';

type Props = {
  onChange?: (state: ConnectorState, device: Device | null) => void;
};

type ConnectorState = 'DISCONNECTED' | 'CONNECTED' | 'LOADING';

const pulse = keyframes`
  0%   { transform: scale(1);   opacity: 1;   }
  70%  { transform: scale(2.2); opacity: 0;   }
  100% { transform: scale(2.2); opacity: 0;   }
`;

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-2px); }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

export function Connector({ onChange }: Props): React.JSX.Element {
  const [devices, setDevices] = useState<Device[]>([]);
  const [state, setState] = useState<ConnectorState>('DISCONNECTED');
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const theme = useTheme();

  function refresh(): void {
    window.api.refresh();
    setScanning(true);
    setTimeout(() => setScanning(false), 800);
  }

  useEffect(() => {
    window.api.refresh();
    return window.api.onScan(setDevices);
  }, []);

  useEffect(() => {
    const device = devices.find((d) => d.id === connectedId) ?? null;
    onChange?.(state, device);
  }, [state, connectedId, devices, onChange]);

  async function connect(id: string): Promise<void> {
    if (state === 'LOADING') {
      return;
    }

    try {
      setConnectedId(id);
      setState('LOADING');
      await window.api.connect(id);
      setState('CONNECTED');
    } catch {
      setConnectedId(null);
      setState('DISCONNECTED');
    }
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Box
          sx={{
            position: 'relative',
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: theme.palette.success.main,
            boxShadow: `0 0 8px ${theme.palette.success.main}`,
            '&::after': {
              content: '""',
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              backgroundColor: theme.palette.success.main,
              animation: `${pulse} 2s infinite ease-out`,
            },
          }}
        />
        <Typography
          variant="overline"
          sx={{ letterSpacing: 1.5, color: 'text.secondary', lineHeight: 1 }}
        >
          {devices.length
            ? `${devices.length} device${devices.length > 1 ? 's' : ''} available`
            : 'Scanning for devices…'}
        </Typography>
        <IconButton
          size="small"
          onClick={refresh}
          disabled={scanning}
          aria-label="Rescan for devices"
          sx={{ color: 'text.secondary', ml: 0.5 }}
        >
          <Refresh
            fontSize="small"
            sx={{ animation: scanning ? `${spin} 800ms linear` : 'none' }}
          />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {devices.map((d) => {
          const isChromecast = d.type === 'chromecast';
          const Icon = isChromecast ? Cast : Tv;
          const isConnected = connectedId === d.id && state === 'CONNECTED';
          const isLoading = connectedId === d.id && state === 'LOADING';
          const accent = isChromecast ? theme.palette.secondary.main : theme.palette.primary.light;

          return (
            <Card
              key={d.id}
              elevation={0}
              sx={{
                width: 220,
                position: 'relative',
                overflow: 'hidden',
                background: `linear-gradient(145deg, ${alpha(accent, 0.08)} 0%, ${alpha(
                  theme.palette.background.paper,
                  0.9
                )} 60%)`,
                border: `1px solid ${
                  isConnected ? theme.palette.success.main : 'rgba(255,255,255,0.08)'
                }`,
                boxShadow: isConnected
                  ? `0 0 0 1px ${theme.palette.success.main}, 0 8px 24px ${alpha(
                      theme.palette.success.main,
                      0.25
                    )}`
                  : 'none',
                transition: 'transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease',
                '&:hover': {
                  transform: 'translateY(-3px)',
                  borderColor: alpha(accent, 0.5),
                  boxShadow: `0 10px 28px ${alpha(accent, 0.25)}`,
                },
              }}
            >
              <CardActionArea
                onClick={() => connect(d.id)}
                disabled={state === 'LOADING'}
                sx={{ p: 2 }}
              >
                <Stack spacing={1.5} sx={{ height: 1 }}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: alpha(accent, 0.15),
                        color: accent,
                        animation: isLoading ? 'none' : `${float} 3.5s ease-in-out infinite`,
                      }}
                    >
                      {isLoading ? (
                        <CircularProgress size={22} sx={{ color: accent }} />
                      ) : (
                        <Icon fontSize="medium" />
                      )}
                    </Box>
                    {isConnected && (
                      <CheckCircle sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                    )}
                  </Stack>

                  <Typography
                    noWrap
                    sx={{
                      fontWeight: 600,
                      fontSize: 14,
                      color: 'text.primary',
                    }}
                    title={d.name}
                  >
                    {d.name}
                  </Typography>

                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1.5,
                      width: 1,
                    }}
                  >
                    <Chip
                      label={isChromecast ? 'Chromecast' : 'DLNA'}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: 0.5,
                        color: accent,
                        backgroundColor: alpha(accent, 0.12),
                        border: `1px solid ${alpha(accent, 0.3)}`,
                      }}
                    />
                    {d.ip && (
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', fontFamily: 'monospace' }}
                      >
                        {d.ip}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              </CardActionArea>
            </Card>
          );
        })}

        {!devices.length && (
          <Card
            elevation={0}
            sx={{
              width: 220,
              height: 140,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed rgba(255,255,255,0.12)',
              background: 'transparent',
            }}
          >
            <Stack spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={20} sx={{ color: theme.palette.primary.light }} />
              <Typography variant="caption" color="text.secondary">
                Searching…
              </Typography>
            </Stack>
          </Card>
        )}
      </Stack>
    </Stack>
  );
}
