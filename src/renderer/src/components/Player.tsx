import { Cast, LinkOff, Memory, Tv } from '@mui/icons-material';
import {
  alpha,
  Box,
  Chip,
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

const marquee = keyframes`
  0%, 10%   { transform: translateX(0); }
  50%, 90%  { transform: translateX(calc(-1 * var(--marquee-distance, 0px))); animation-timing-function: steps(1, end); }
  100%      { transform: translateX(0); }
`;

type Props = {
  device: Device | null;
  onDisconnect?: () => void;
};

const pulse = (color: string) => keyframes`
  0%, 100% { box-shadow: 0 0 0 0   ${alpha(color, 0.45)}; }
  50%      { box-shadow: 0 0 0 6px ${alpha(color, 0)};    }
`;

export default function Player({ device, onDisconnect }: Props): React.JSX.Element {
  const [status, setStatus] = useState<PlayerStatus | undefined>(undefined);
  const [marqueeDistance, setMarqueeDistance] = useState(0);
  const theme = useTheme();
  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    return window.api.onStatus(setStatus);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on device change to clear stale status
  useEffect(() => {
    setStatus(undefined);
  }, [device?.id]);

  function startMarquee(): void {
    const el = titleRef.current;
    if (!el) return;
    setMarqueeDistance(Math.max(0, el.scrollWidth - el.clientWidth));
  }
  function stopMarquee(): void {
    setMarqueeDistance(0);
  }

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
                animation: isPlaying ? `${pulse(deviceAccent)} 1.8s ease-out infinite` : 'none',
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
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
            {status?.transcoded && (
              <Tooltip
                title="ffmpeg is re-encoding this file on the fly for the TV"
                placement="bottom"
              >
                <Chip
                  size="small"
                  icon={<Memory />}
                  label="Transcoding"
                  sx={{
                    height: 22,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    color: theme.palette.warning.light,
                    backgroundColor: alpha(theme.palette.warning.main, 0.12),
                    border: `1px solid ${alpha(theme.palette.warning.main, 0.35)}`,
                    '& .MuiChip-icon': {
                      color: theme.palette.warning.light,
                      fontSize: 14,
                      ml: 0.5,
                    },
                  }}
                />
              </Tooltip>
            )}
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
          </Stack>
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
        <Box
          onMouseEnter={startMarquee}
          onMouseLeave={stopMarquee}
          sx={{ width: 1, overflow: 'hidden' }}
        >
          <Typography
            ref={titleRef}
            variant="h3"
            sx={{
              whiteSpace: 'nowrap',
              ...(marqueeDistance > 0
                ? {
                    display: 'inline-block',
                    '--marquee-distance': `${marqueeDistance}px`,
                    animation: `${marquee} ${marqueeDistance / 60 + 3}s ease-in-out infinite`,
                  }
                : {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }),
            }}
          >
            {status?.title || 'no media'}
          </Typography>
        </Box>
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
