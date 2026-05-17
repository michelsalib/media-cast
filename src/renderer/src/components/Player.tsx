import { Cast, LinkOff, Tv } from '@mui/icons-material';
import {
  alpha,
  Box,
  IconButton,
  keyframes,
  Slide,
  Slider,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import format from 'format-duration';
import { useEffect, useRef, useState } from 'react';
import type { Device, PlayerStatus } from '../../../shared/types';
import PlayPause from './PlayPauseSeek';

type Props = {
  device: Device | null;
  onDisconnect?: () => void;
};

const wave = keyframes`
  0%, 100% { opacity: 0.4; transform: scaleY(0.6); }
  50%      { opacity: 1;   transform: scaleY(1);   }
`;

export default function Player({ device, onDisconnect }: Props): React.JSX.Element {
  const [status, setStatus] = useState<PlayerStatus | undefined>(undefined);
  const theme = useTheme();
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return window.api.onStatus(setStatus);
  }, []);

  function seek(_evt: Event, value: number): void {
    window.api.seek(value);
  }

  function disconnect(): void {
    window.api.disconnect();
    onDisconnect?.();
  }

  const isPlaying = status?.playerState === 'PLAYING';
  const DeviceIcon = device?.type === 'chromecast' ? Cast : Tv;
  const deviceAccent =
    device?.type === 'chromecast' ? theme.palette.secondary.main : theme.palette.primary.light;

  return (
    <Box>
      <Slide
        direction="down"
        in={!!device}
        container={headerRef.current}
        mountOnEnter
        unmountOnExit
      >
        <Box
          ref={headerRef}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            mb: 3,
            px: 2,
            py: 1.25,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${alpha(deviceAccent, 0.12)} 0%, ${alpha(
              theme.palette.background.paper,
              0.6
            )} 100%)`,
            border: `1px solid ${alpha(deviceAccent, 0.25)}`,
            backdropFilter: 'blur(8px)',
          }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: alpha(deviceAccent, 0.18),
                color: deviceAccent,
                flexShrink: 0,
              }}
            >
              <DeviceIcon fontSize="small" />
            </Box>
            <Stack sx={{ minWidth: 0 }}>
              <Typography
                variant="overline"
                sx={{ lineHeight: 1, color: 'text.secondary', letterSpacing: 1.2 }}
              >
                Casting to
              </Typography>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: 14 }} title={device?.name}>
                {device?.name}
              </Typography>
            </Stack>
            {isPlaying && (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', ml: 1.5 }}>
                {[0, 1, 2].map((i) => (
                  <Box
                    key={i}
                    sx={{
                      width: 3,
                      height: 14,
                      borderRadius: 1,
                      backgroundColor: deviceAccent,
                      animation: `${wave} 1s ease-in-out ${i * 0.15}s infinite`,
                      transformOrigin: 'center',
                    }}
                  />
                ))}
              </Stack>
            )}
          </Stack>
          <Tooltip title="Disconnect" placement="left">
            <IconButton
              onClick={disconnect}
              size="small"
              sx={{
                color: 'text.secondary',
                border: '1px solid rgba(255,255,255,0.08)',
                backgroundColor: alpha(theme.palette.background.paper, 0.6),
                transition: 'all 180ms ease',
                '&:hover': {
                  color: theme.palette.error.light,
                  borderColor: alpha(theme.palette.error.main, 0.5),
                  backgroundColor: alpha(theme.palette.error.main, 0.12),
                  boxShadow: `0 0 12px ${alpha(theme.palette.error.main, 0.35)}`,
                },
              }}
            >
              <LinkOff fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Slide>

      <Stack
        useFlexGap
        direction="column"
        sx={{
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="h3" noWrap sx={{ width: 1 }}>
          {status?.title || 'no media'}
        </Typography>
        <PlayPause status={status} />
        <Slider
          min={0}
          max={status?.duration || 100}
          value={status?.currentTime || 0}
          onChange={seek}
        />
        <Stack direction="row" sx={{ width: '100%', justifyContent: 'space-between' }}>
          <div>{status?.currentTime ? format(status.currentTime * 1000) : 'NA'}</div>
          <div>{status?.duration ? format(status.duration * 1000) : 'NA'}</div>
        </Stack>
      </Stack>
    </Box>
  );
}
