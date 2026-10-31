import { Cast, PlayArrowRounded, Tv } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { cardSx, chipSx } from '../theme';
import { type RemoteState, remote } from './client';

type Props = {
  prepared: NonNullable<RemoteState['prepared']>;
  devices: RemoteState['devices'];
  // The screen picked in the window, preselected here.
  deviceId: string | null;
  // Something else is playing: a smaller card under the controls.
  secondary: boolean;
};

// What the window has ready (video and the subtitles/audio chosen there), the screens to
// play it on, and Play. Choosing what to play stays on the computer.
export default function ReadyCard({
  prepared,
  devices,
  deviceId,
  secondary,
}: Props): React.JSX.Element {
  const [pick, setPick] = useState<string>();
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string>();

  const chosen =
    devices.find((d) => d.id === (pick ?? deviceId)) ??
    (devices.length === 1 ? devices[0] : undefined);

  async function launch(): Promise<void> {
    if (!chosen) return;
    setLaunching(true);
    setError(undefined);
    try {
      // Resolves once the TV has the video; the state push then shows the controls.
      await remote.launch(chosen.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }

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

      <Stack spacing={1} sx={{ px: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary' }}>
          Play on
        </Typography>
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
    </Stack>
  );
}
