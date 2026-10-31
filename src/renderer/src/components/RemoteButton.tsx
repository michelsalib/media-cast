import { PhoneIphoneOutlined } from '@mui/icons-material';
import {
  Box,
  Button,
  FormControlLabel,
  Popover,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import type { RemoteInfo } from '../../../shared/types';
import { api, errorMessage } from '../ipc';
import { chipSx, tonalSx } from '../theme';

// The way into the phone remote: the on/off switch and the QR code to open it.
// `compact`: a small text button, for the "Play on" header; otherwise a tonal button.
export default function RemoteButton({
  compact = false,
}: {
  compact?: boolean;
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [info, setInfo] = useState<RemoteInfo>();
  const [address, setAddress] = useState<string>();
  const [error, setError] = useState<string>();

  async function update(request: Promise<RemoteInfo>): Promise<void> {
    setError(undefined);
    try {
      setInfo(await request);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const link = info?.links.find((l) => l.address === address) ?? info?.links[0];

  return (
    <>
      <Tooltip title="Control this from your phone">
        <Button
          size={compact ? 'small' : 'medium'}
          startIcon={<PhoneIphoneOutlined />}
          onClick={(e) => {
            setAnchor(e.currentTarget);
            void update(api.remoteInfo());
          }}
          sx={compact ? { color: 'primary.main', fontWeight: 600 } : tonalSx}
        >
          {compact ? 'Phone remote' : 'Phone'}
        </Button>
      </Tooltip>
      {/* Opens upwards: both places it sits are at the bottom of the window. */}
      <Popover
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: -1 } } }}
      >
        {/* Wide rather than tall (QR code beside the text): the window may be short. */}
        <Stack spacing={1.5} sx={{ p: 2, width: 440, maxWidth: 'calc(100vw - 32px)' }}>
          <FormControlLabel
            control={
              <Switch
                checked={info?.enabled ?? false}
                disabled={!info}
                onChange={(e) => void update(api.setRemoteEnabled(e.target.checked))}
              />
            }
            label="Phone remote"
            labelPlacement="start"
            slotProps={{ typography: { sx: { fontWeight: 600, flex: 1 } } }}
            sx={{ m: 0, justifyContent: 'space-between' }}
          />
          {!info?.enabled && (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Control playback from your phone, read the subtitles on it, and fix their timing while
              you watch.
            </Typography>
          )}
          {info?.enabled && !link && (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              This computer isn’t on a network a phone can reach.
            </Typography>
          )}
          {link && info && (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
              <Box
                component="img"
                alt="QR code for the phone remote"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(link.qrSvg)}`}
                // QR codes need dark on light, whatever the theme.
                sx={{ width: 160, flexShrink: 0, bgcolor: '#fff', borderRadius: '12px' }}
              />
              <Stack spacing={1} sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                  Scan it with your phone’s camera. The phone must be on the same Wi-Fi.
                </Typography>
                <Typography
                  sx={{ fontSize: 12, userSelect: 'text', wordBreak: 'break-all', opacity: 0.8 }}
                >
                  {link.url}
                </Typography>
                {info.links.length > 1 && (
                  <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap' }}>
                    {info.links.map((l) => (
                      <Button
                        key={l.address}
                        onClick={() => setAddress(l.address)}
                        title="This computer’s address on another network"
                        sx={chipSx(l === link)}
                      >
                        {l.address}
                      </Button>
                    ))}
                  </Stack>
                )}
                <Tooltip title="Phones using the current link stop working">
                  <Button
                    size="small"
                    onClick={() => void update(api.newRemoteLink())}
                    sx={{ alignSelf: 'flex-start', ml: -0.5 }}
                  >
                    New link
                  </Button>
                </Tooltip>
              </Stack>
            </Stack>
          )}
          {error && <Typography sx={{ fontSize: 13, color: 'error.main' }}>{error}</Typography>}
        </Stack>
      </Popover>
    </>
  );
}
