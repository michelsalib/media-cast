import { SystemUpdateAlt } from '@mui/icons-material';
import { IconButton, Tooltip } from '@mui/material';
import { useEffect, useState } from 'react';

export default function UpdateButton(): React.JSX.Element | null {
  const [ready, setReady] = useState(false);

  useEffect(() => window.api.onUpdateReady(() => setReady(true)), []);

  if (!ready) return null;

  return (
    <Tooltip title="Update ready — click to restart and install">
      <IconButton
        onClick={() => window.api.quitAndInstall()}
        size="small"
        sx={{
          appRegion: 'no-drag',
          color: '#66bb6a',
          padding: '4px',
        }}
      >
        <SystemUpdateAlt fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
