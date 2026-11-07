import { StopRounded, VideoLibraryOutlined } from '@mui/icons-material';
import { Box, Button, Slider, Stack, Typography } from '@mui/material';
import format from 'format-duration';
import { useReducer, useState } from 'react';
import type { Device, PlayerStatus } from '../../../shared/types';
import { api } from '../ipc';
import { SeekHold } from '../seekHold';
import { cardSx, tonalSx } from '../theme';
import { Artwork } from './Artwork';
import { ConvertingChip } from './CompatChip';
import PlayingOptionsButton from './PlayingOptionsButton';
import PlayPause from './PlayPauseSeek';
import RemoteButton from './RemoteButton';
import VideoInfoButton from './VideoInfoButton';

type Props = {
  status: PlayerStatus;
  device: Device;
  artworkUrl?: string;
  title: string;
  details?: string;
  // Extra chips next to the playback state.
  badges?: React.ReactNode;
  // The subtitles playing can be resized on this TV.
  resizableSubtitles?: boolean;
  onBrowse: () => void;
  onStop: () => void;
};

async function probePlaying() {
  const path = await api.playingPath();
  if (!path) throw new Error('Nothing is playing');
  return api.probe(path);
}

const STATE_LABELS: Record<PlayerStatus['playerState'], string> = {
  PLAYING: 'Playing on',
  PAUSED: 'Paused on',
  BUFFERING: 'Loading on',
  IDLE: 'Ready on',
};

export default function Player({
  status,
  device,
  artworkUrl,
  title,
  details,
  badges,
  resizableSubtitles,
  onBrowse,
  onStop,
}: Props): React.JSX.Element {
  const [dragValue, setDragValue] = useState<number | undefined>();
  const [seekHold] = useState(() => new SeekHold());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const duration = status.duration || 0;
  const position = dragValue ?? seekHold.shown(status.currentTime ?? 0);

  // Seek once on release. onChange fires continuously while dragging: every Seek makes a
  // UPnP TV re-request the stream, which restarts the transcoder each time. Meanwhile the
  // thumb follows the drag instead of snapping back to each 1 s status tick.
  function seek(value: number): void {
    seekHold.hold(value);
    setDragValue(undefined);
    rerender();
    void api.seek(value);
  }

  return (
    <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0, px: 2.5, pt: 1, pb: 2.5 }}>
      <Stack
        direction="row"
        spacing={2.5}
        sx={{ ...cardSx, p: 2, borderRadius: '28px', alignItems: 'center', flex: 1, minHeight: 0 }}
      >
        <Artwork url={artworkUrl} sx={{ width: 'min(400px, 48%)' }} />
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                height: 32,
                px: 1.5,
                alignItems: 'center',
                borderRadius: '8px',
                bgcolor: 'tonal.primaryContainer',
                color: 'tonal.onPrimaryContainer',
                fontSize: 13,
                fontWeight: 600,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'currentColor',
                  flexShrink: 0,
                }}
              />
              <Box
                component="span"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {STATE_LABELS[status.playerState]} {device.name}
              </Box>
            </Stack>
            {status.transcoded && <ConvertingChip />}
            <VideoInfoButton load={probePlaying} videoKey={title} name={title} />
            {badges}
          </Stack>
          <Typography
            variant="h1"
            title={title}
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {title}
          </Typography>
          {details && <Typography sx={{ color: 'text.secondary' }}>{details}</Typography>}
        </Stack>
      </Stack>

      <Box sx={{ ...cardSx, px: 2.5, pt: 1.5, pb: 2, flexShrink: 0 }}>
        <Slider
          aria-label="Position"
          min={0}
          max={duration || 100}
          value={position}
          disabled={!duration}
          onChange={(_evt, value) => setDragValue(value)}
          onChangeCommitted={(_evt, value) => seek(value)}
          sx={{ height: 6, py: 1 }}
        />
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span>{format(position * 1000)}</span>
          <span>{duration ? `−${format(Math.max(0, duration - position) * 1000)}` : ''}</span>
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            alignItems: 'center',
            mt: 0.5,
          }}
        >
          <Stack direction="row" spacing={1}>
            <Button onClick={onBrowse} startIcon={<VideoLibraryOutlined />} sx={tonalSx}>
              Another video
            </Button>
            <PlayingOptionsButton
              position={position}
              playing={status.playerState === 'PLAYING'}
              resizableSubtitles={!!resizableSubtitles}
            />
          </Stack>
          <Stack sx={{ alignItems: 'center' }}>
            <PlayPause status={status} position={position} onSeek={seek} />
          </Stack>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <RemoteButton />
            <Button onClick={onStop} startIcon={<StopRounded />} sx={tonalSx}>
              Stop
            </Button>
          </Stack>
        </Box>
      </Box>
    </Stack>
  );
}
