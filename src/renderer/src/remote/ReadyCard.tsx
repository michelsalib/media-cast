import { Cast, PlayArrowRounded, Tv } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import type { TorrentStats, TrackChange } from '../../../shared/types';
import { CompatChip } from '../components/CompatChip';
import { SubtitleSizeChoices } from '../components/LiveSubtitles';
import SubtitleSearchDialog from '../components/SubtitleSearchDialog';
import SubtitleSyncDialog from '../components/SubtitleSyncDialog';
import { TorrentChip } from '../components/Torrent';
import TrackSwitcher from '../components/TrackSwitcher';
import VideoInfoButton from '../components/VideoInfoButton';
import { cardSx, chipSx, linkSx } from '../theme';
import { remoteSearch, remoteSync } from './backends';
import { type RemoteState, remote } from './client';

type Props = {
  prepared: NonNullable<RemoteState['prepared']>;
  devices: RemoteState['devices'];
  // The screen picked in the window, preselected here.
  deviceId: string | null;
  // Something else is playing: a smaller card under the controls.
  secondary: boolean;
  // The subtitle size, shared with what plays (so not repeated on the secondary card).
  subtitleScale: number;
  onSubtitleScale: (scale: number) => void;
  // Swarm progress, for a video streamed from a torrent.
  stats?: TorrentStats;
  onMessage: (text: string) => void;
};

// What the window has ready, as the window shows it: its audio, subtitles and DLNA
// switches (picked here or there, the window keeps them), how it will play, its details,
// subtitles found online and their timing, the screens to play it on, and Play. Choosing
// the video and adding subtitle files from disk stay on the computer.
export default function ReadyCard({
  prepared,
  devices,
  deviceId,
  secondary,
  subtitleScale,
  onSubtitleScale,
  stats,
  onMessage,
}: Props): React.JSX.Element {
  const [pick, setPick] = useState<string>();
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  const chosen =
    devices.find((d) => d.id === (pick ?? deviceId)) ??
    (devices.length === 1 ? devices[0] : undefined);

  const search = useMemo(
    () =>
      remoteSearch(prepared.id, () => {
        setSearchOpen(false);
        onMessage('Subtitles added. Check their timing with “Fix timing”.');
      }),
    [prepared.id, onMessage]
  );
  const sync = useMemo(
    () =>
      remoteSync(prepared.id, () => {
        setSyncOpen(false);
        onMessage('Subtitle timing saved');
      }),
    [prepared.id, onMessage]
  );

  async function launch(): Promise<void> {
    if (!chosen) return;
    setLaunching(true);
    setError(undefined);
    try {
      // Resolves once the TV has the video; the state push then shows the controls.
      await remote.launch(prepared.id, chosen.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }

  async function pickTracks(change: TrackChange): Promise<void> {
    setError(undefined);
    try {
      await remote.pickReadyTracks(prepared.id, change);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // The DLNA switches only mean something on a DLNA TV.
  const tracks =
    prepared.tracks &&
    (chosen?.type === 'upnp'
      ? prepared.tracks
      : { ...prepared.tracks, burn: undefined, normalizeAudio: undefined });
  // Worked out by the window for the screen it has picked.
  const compat = chosen && chosen.id === deviceId ? prepared.compat : undefined;

  return (
    <Stack spacing={1.5} sx={{ ...cardSx, p: 1.5, borderRadius: '28px' }}>
      <Typography sx={{ fontWeight: 600, px: 1, pt: 0.5 }}>
        {secondary ? 'Ready on the computer' : 'Ready to play'}
      </Typography>
      <Stack direction={secondary ? 'row' : 'column'} spacing={1.5} sx={{ alignItems: 'center' }}>
        <Box
          component="img"
          alt=""
          src={`artwork?video=next&title=${encodeURIComponent(prepared.title)}`}
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
          sx={{
            width: secondary ? '40%' : '100%',
            flexShrink: 0,
            aspectRatio: '16 / 9',
            objectFit: 'cover',
            borderRadius: secondary ? '12px' : '20px',
            bgcolor: 'tonal.surfaceContainerHigh',
          }}
        />
        <Stack spacing={0.25} sx={{ px: secondary ? 0 : 1, minWidth: 0, alignSelf: 'stretch' }}>
          <Typography
            variant={secondary ? 'body1' : 'h2'}
            sx={{ fontWeight: 600, wordBreak: 'break-word' }}
          >
            {prepared.title}
          </Typography>
          {prepared.details && (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              {prepared.details}
            </Typography>
          )}
        </Stack>
      </Stack>
      <Stack
        direction="row"
        useFlexGap
        sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center', px: 1 }}
      >
        {compat && chosen && <CompatChip report={compat} deviceName={chosen.name} />}
        <VideoInfoButton
          load={() => remote.videoInfo(prepared.id)}
          videoKey={prepared.id}
          name={prepared.title}
        />
        {prepared.infoHash && <TorrentChip stats={stats} />}
      </Stack>

      {tracks && (
        <Stack spacing={1.5} sx={{ px: 1 }}>
          {/* Image subtitles are ruled out once a Chromecast is the screen picked here. */}
          <TrackSwitcher
            tracks={tracks}
            deviceType={chosen?.type}
            reloads={false}
            onChange={pickTracks}
          />
          <Stack direction="row" useFlexGap sx={{ gap: 2, flexWrap: 'wrap' }}>
            <Link component="button" onClick={() => setSearchOpen(true)} sx={linkSx}>
              Find subtitles online
            </Link>
            <Tooltip
              title={
                prepared.retimable
                  ? ''
                  : tracks.selected.subtitles !== null
                    ? 'These subtitles are images, so they can’t be retimed'
                    : 'Pick subtitles to check their timing'
              }
            >
              <Box component="span" sx={{ display: 'flex' }}>
                <Link
                  component="button"
                  disabled={!prepared.retimable}
                  onClick={() => setSyncOpen(true)}
                  sx={[
                    linkSx,
                    !prepared.retimable && { color: 'text.disabled', cursor: 'default' },
                  ]}
                >
                  Fix timing
                </Link>
              </Box>
            </Tooltip>
          </Stack>
          {!secondary && tracks.selected.subtitles !== null && (
            <SubtitleSizeChoices scale={subtitleScale} onChange={onSubtitleScale} />
          )}
        </Stack>
      )}

      <Stack spacing={1} sx={{ px: 1 }}>
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary', flex: 1 }}>
            Play on
          </Typography>
          <Link
            component="button"
            onClick={() => void remote.refresh().catch(() => {})}
            sx={linkSx}
          >
            Look again
          </Link>
        </Stack>
        {devices.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            No screens found yet. Check that the TV is on and on the same network.
          </Typography>
        ) : (
          <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
            {devices.map((d) => (
              <Button
                key={d.id}
                onClick={() => setPick(d.id)}
                startIcon={d.type === 'chromecast' ? <Cast /> : <Tv />}
                sx={chipSx(d.id === chosen?.id)}
              >
                {d.name}
              </Button>
            ))}
          </Stack>
        )}
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Button
        variant="contained"
        size="large"
        disabled={!chosen || launching}
        onClick={() => void launch()}
        startIcon={
          launching ? (
            <CircularProgress size={20} color="inherit" />
          ) : (
            <PlayArrowRounded sx={{ '&&': { fontSize: 26 } }} />
          )
        }
      >
        {launching ? 'Starting…' : chosen ? 'Play' : 'Pick a screen'}
      </Button>

      <SubtitleSearchDialog
        open={searchOpen}
        backend={search}
        onClose={() => setSearchOpen(false)}
      />
      <SubtitleSyncDialog
        open={syncOpen}
        name={tracks?.externalName}
        backend={sync}
        onClose={() => setSyncOpen(false)}
      />
    </Stack>
  );
}
