import { CheckRounded, FormatSizeRounded } from '@mui/icons-material';
import { Button, Link, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import { useEffect, useState } from 'react';
import { SUBTITLE_SCALES } from '../../../shared/subtitles';
import { api, errorMessage, onEvent } from '../ipc';
import { linkSx, tonalSx } from '../theme';

type Props = {
  // A text link (the Subtitles section's actions); otherwise a tonal button (the player).
  link?: boolean;
  onError?: (message: string) => void;
};

// The subtitle size, shared with the phone remote. Main remembers it for every load and
// applies it to the video playing when the TV allows it.
export default function SubtitleSizeButton({ link = false, onError }: Props): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    api
      .subtitleScale()
      .then(setScale)
      .catch(() => {});
    return onEvent('subtitleScale', setScale);
  }, []);

  function choose(value: number): void {
    setAnchor(null);
    setScale(value);
    api.setSubtitleScale(value).catch((err) => onError?.(errorMessage(err)));
  }

  const label = SUBTITLE_SCALES.find((s) => s.value === scale)?.label ?? 'Normal';

  return (
    <>
      <Tooltip title={`Subtitle size: ${label}`}>
        {link ? (
          <Link
            component="button"
            onClick={(e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
            sx={linkSx}
          >
            Size
          </Link>
        ) : (
          <Button
            startIcon={<FormatSizeRounded />}
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={tonalSx}
          >
            Size
          </Button>
        )}
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {SUBTITLE_SCALES.map((s) => (
          <MenuItem key={s.value} selected={s.value === scale} onClick={() => choose(s.value)}>
            <ListItemText>{s.label}</ListItemText>
            {s.value === scale && <CheckRounded fontSize="small" sx={{ ml: 2 }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
