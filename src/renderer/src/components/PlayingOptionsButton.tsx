import { SubtitlesOutlined } from '@mui/icons-material';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { SubtitleCue } from '../../../shared/subtitleSearch';
import type { PlayingTracks, TrackChange } from '../../../shared/types';
import { api, errorMessage, onEvent } from '../ipc';
import { usePlaybackTime } from '../playbackTime';
import { tonalSx } from '../theme';
import LiveSubtitles from './LiveSubtitles';
import TrackSwitcher from './TrackSwitcher';

type Props = {
  // The position shown by the player, and whether the TV is playing.
  position: number;
  playing: boolean;
  resizableSubtitles: boolean;
};

// The player's "Audio & subtitles": switch tracks, resize and retime the subtitles of the
// video playing. The same controls as the phone remote's.
export default function PlayingOptionsButton({
  position,
  playing,
  resizableSubtitles,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<PlayingTracks>();
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [offset, setOffset] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string>();
  const time = usePlaybackTime(position, playing);

  const load = useCallback(async () => {
    try {
      const [t, c, s] = await Promise.all([
        api.playingTracks(),
        api.playingCues(),
        api.subtitleScale(),
      ]);
      setTracks(t);
      setCues(c);
      setScale(s);
      setOffset(t.subtitleOffset);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  // A switch or a retime (here or from the phone) reloads the video: fetch again.
  useEffect(() => {
    if (!open) return;
    void load();
    const offs = [
      onEvent('nowPlaying', (now) => now && void load()),
      onEvent('subtitleScale', setScale),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [open, load]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <Button startIcon={<SubtitlesOutlined />} onClick={() => setOpen(true)} sx={tonalSx}>
        Audio & subtitles
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Audio & subtitles</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {tracks ? (
              <TrackSwitcher
                tracks={tracks}
                deviceType={tracks.deviceType}
                onChange={(change: TrackChange) => run(() => api.changeTracks(change))}
              />
            ) : (
              <Typography sx={{ color: 'text.secondary' }}>Loading…</Typography>
            )}
            {cues.length > 0 && (
              <>
                <Divider />
                <LiveSubtitles
                  cues={cues}
                  time={time}
                  offset={offset}
                  applied={tracks?.subtitleOffset ?? 0}
                  onOffsetChange={setOffset}
                  onApplyOffset={(value) => run(() => api.retimePlaying(value))}
                  scale={resizableSubtitles ? scale : undefined}
                  onScaleChange={(value) => {
                    setScale(value);
                    void run(() => api.setSubtitleScale(value));
                  }}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
