import { CloudDownloadOutlined, MovieOutlined } from '@mui/icons-material';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
} from '@mui/material';
import type { TorrentContents, TorrentStats } from '../../../shared/types';
import { formatBytes } from '../labels';

// Season packs and multi-part releases: the user picks which video to play.
export function TorrentPicker({
  contents,
  onPick,
  onClose,
}: {
  contents?: TorrentContents;
  onPick: (video: TorrentContents['videos'][number]) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Dialog open={!!contents} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ wordBreak: 'break-word' }}>{contents?.name}</DialogTitle>
      <DialogContent sx={{ px: 1 }}>
        <List dense>
          {contents?.videos.map((video) => (
            <ListItemButton key={video.path} onClick={() => onPick(video)} sx={{ borderRadius: 2 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <MovieOutlined />
              </ListItemIcon>
              <ListItemText
                primary={video.name}
                secondary={formatBytes(video.size)}
                slotProps={{ primary: { sx: { wordBreak: 'break-word' } } }}
              />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

// Swarm health of the torrent a video streams from.
export function TorrentChip({ stats }: { stats?: TorrentStats }): React.JSX.Element {
  return (
    <Tooltip
      title={
        stats
          ? `Streaming from a torrent — ${formatBytes(stats.downloaded)} downloaded so far. Only the parts being watched are fetched.`
          : 'Streaming from a torrent'
      }
    >
      <Stack
        direction="row"
        spacing={0.75}
        sx={{
          height: 32,
          px: 1.5,
          alignItems: 'center',
          borderRadius: '8px',
          bgcolor: 'tonal.secondaryContainer',
          color: 'tonal.onSecondaryContainer',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'help',
          whiteSpace: 'nowrap',
          // Steady width as the numbers tick.
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <CloudDownloadOutlined sx={{ fontSize: 16 }} />
        <span>
          {stats
            ? `${stats.peers} ${stats.peers === 1 ? 'peer' : 'peers'} · ${(stats.downloadSpeed / 1024 / 1024).toFixed(1)} MB/s`
            : 'Torrent'}
        </span>
      </Stack>
    </Tooltip>
  );
}
