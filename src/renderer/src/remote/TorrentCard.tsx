import { MovieOutlined } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { formatBytes } from '../labels';
import { cardSx } from '../theme';
import { type RemoteState, remote } from './client';

type Props = {
  choice: RemoteState['torrentChoice'];
  opening: boolean;
};

// A torrent from the phone, as pasting a magnet link in the window: opened by the
// window, which then offers its videos to pick from, here too.
export default function TorrentCard({ choice, opening }: Props): React.JSX.Element {
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState<number>();
  const [error, setError] = useState<string>();

  async function open(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!link.trim()) return;
    setSending(true);
    setError(undefined);
    try {
      await remote.openMagnet(link.trim());
      setLink('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function pick(index: number): Promise<void> {
    if (!choice) return;
    setPicking(index);
    setError(undefined);
    try {
      await remote.pickTorrentVideo(choice.infoHash, index);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(undefined);
    }
  }

  return (
    <Stack spacing={1.5} sx={{ ...cardSx, p: 2 }}>
      {choice ? (
        <>
          <Box>
            <Typography sx={{ fontWeight: 600 }}>Which video?</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', wordBreak: 'break-word' }}>
              {choice.name}
            </Typography>
          </Box>
          <List dense disablePadding>
            {choice.videos.map((video, i) => (
              <ListItemButton
                // biome-ignore lint/suspicious/noArrayIndexKey: videos are picked by index
                key={i}
                disabled={picking !== undefined}
                onClick={() => void pick(i)}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {picking === i ? <CircularProgress size={20} /> : <MovieOutlined />}
                </ListItemIcon>
                <ListItemText
                  primary={video.name}
                  secondary={formatBytes(video.size)}
                  slotProps={{ primary: { sx: { wordBreak: 'break-word' } } }}
                />
              </ListItemButton>
            ))}
          </List>
        </>
      ) : opening || sending ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          <Typography sx={{ fontSize: 14 }}>
            Opening the torrent… This can take up to a minute.
          </Typography>
        </Stack>
      ) : (
        <Stack component="form" spacing={1} onSubmit={(e) => void open(e)}>
          <Typography sx={{ fontWeight: 600 }}>Stream a torrent</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              placeholder="Paste a magnet link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { autoCapitalize: 'off', autoCorrect: 'off' } }}
            />
            <Button type="submit" variant="contained" disabled={!link.trim()}>
              Open
            </Button>
          </Stack>
        </Stack>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
