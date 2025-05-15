import { ConnectedTv } from '@mui/icons-material';
import { Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

type Props = {
  onChange?: (state: ConnectorState) => void;
};

type ConnectorState = 'DISCONNECTED' | 'CONNECTED' | 'LOADING';

export function Connector({ onChange }: Props): React.JSX.Element {
  const [devices, setDevices] = useState<{ name: string; ip: string }[]>([]);
  const [state, setState] = useState<ConnectorState>('DISCONNECTED');
  const [connectedIp, setConnectedIp] = useState<string | null>(null);

  useEffect(() => {
    window.api.onScan((devices) => {
      setDevices(devices);
    });
  }, []);

  useEffect(() => {
    onChange?.(state);
  }, [state, onChange]);

  async function connect(ip: string): Promise<void> {
    if (state == 'LOADING') {
      return;
    }

    try {
      setConnectedIp(ip);
      setState('LOADING');
      await window.api.connect(ip);
      setState('CONNECTED');
    } catch {
      setConnectedIp(null);
      setState('DISCONNECTED');
    }
  }

  return (
    <Stack direction="row" spacing={2}>
      {devices.map((d) => (
        <Button
          variant="outlined"
          key={d.ip}
          onClick={() => connect(d.ip)}
          color={connectedIp == d.ip ? 'success' : 'inherit'}
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
            {state == 'LOADING' && d.ip == connectedIp ? (
              <CircularProgress
                color="inherit"
                size="1.5rem"
                sx={{ margin: 'auto' }}
              ></CircularProgress>
            ) : (
              <ConnectedTv sx={{ margin: 'auto' }}></ConnectedTv>
            )}
            <Typography noWrap variant="caption">
              {d.ip}
            </Typography>
          </Stack>
        </Button>
      ))}
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
