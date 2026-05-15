import { Cast, Tv } from '@mui/icons-material';
import { Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { Device } from '../../../shared/types';

type Props = {
  onChange?: (state: ConnectorState) => void;
};

type ConnectorState = 'DISCONNECTED' | 'CONNECTED' | 'LOADING';

export function Connector({ onChange }: Props): React.JSX.Element {
  const [devices, setDevices] = useState<Device[]>([]);
  const [state, setState] = useState<ConnectorState>('DISCONNECTED');
  const [connectedId, setConnectedId] = useState<string | null>(null);

  useEffect(() => {
    return window.api.onScan(setDevices);
  }, []);

  useEffect(() => {
    onChange?.(state);
  }, [state, onChange]);

  async function connect(id: string): Promise<void> {
    if (state === 'LOADING') {
      return;
    }

    try {
      setConnectedId(id);
      setState('LOADING');
      await window.api.connect(id);
      setState('CONNECTED');
    } catch {
      setConnectedId(null);
      setState('DISCONNECTED');
    }
  }

  return (
    <Stack direction="row" spacing={2}>
      {devices.map((d) => {
        const Icon = d.type === 'chromecast' ? Cast : Tv;
        return (
          <Button
            variant="outlined"
            key={d.id}
            onClick={() => connect(d.id)}
            color={connectedId === d.id ? 'success' : 'inherit'}
            sx={{ width: '200px' }}
          >
            <Stack
              direction="column"
              useFlexGap
              spacing={1}
              sx={{
                width: 1,
                height: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <Typography noWrap>{d.name}</Typography>
              {state === 'LOADING' && d.id === connectedId ? (
                <CircularProgress color="inherit" size="1.5rem" sx={{ margin: 'auto' }} />
              ) : (
                <Icon sx={{ margin: 'auto' }} />
              )}
              <Typography noWrap variant="caption">
                {d.ip ?? (d.type === 'chromecast' ? 'Chromecast' : 'DLNA')}
              </Typography>
            </Stack>
          </Button>
        );
      })}
      {!devices.length ? (
        <Typography variant="overline" color="textSecondary">
          No cast device detected
        </Typography>
      ) : (
        ''
      )}
    </Stack>
  );
}
