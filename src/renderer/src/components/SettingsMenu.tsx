import {
  CastOutlined,
  CheckRounded,
  ContrastOutlined,
  DarkModeOutlined,
  InfoOutlined,
  LightModeOutlined,
  OpenInNewOutlined,
  SendOutlined,
  SettingsOutlined,
} from '@mui/icons-material';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import type {
  AppInfo,
  ShellIntegration,
  ShellIntegrationKey,
  ThemeSource,
} from '../../../shared/types';
import { api, errorMessage } from '../ipc';

const THEMES: { value: ThemeSource; label: string; Icon: typeof LightModeOutlined }[] = [
  { value: 'system', label: 'Use system setting', Icon: ContrastOutlined },
  { value: 'light', label: 'Light', Icon: LightModeOutlined },
  { value: 'dark', label: 'Dark', Icon: DarkModeOutlined },
];

type Props = {
  themeSource: ThemeSource;
  onThemeSourceChange: (value: ThemeSource) => void;
};

// Windows Explorer entries for videos and torrents, each switched on or off here.
const SHELL_ENTRIES: { key: ShellIntegrationKey; label: string; Icon: typeof CastOutlined }[] = [
  { key: 'contextMenu', label: 'Cast with Media Cast', Icon: CastOutlined },
  { key: 'openWith', label: 'Open with › Media Cast', Icon: OpenInNewOutlined },
  { key: 'sendTo', label: 'Send to › Media Cast', Icon: SendOutlined },
];

// The title bar's one menu: theme, Explorer entries (Windows), and the about box
// (versions, ffmpeg paths).
export default function SettingsMenu({
  themeSource,
  onThemeSourceChange,
}: Props): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [info, setInfo] = useState<AppInfo>();
  const [error, setError] = useState<string>();
  // null off Windows (section hidden); undefined until read.
  const [shell, setShell] = useState<ShellIntegration | null>();
  const [shellBusy, setShellBusy] = useState(false);
  const [shellError, setShellError] = useState<string>();

  // Read again on each open: the registry is the truth, and the uninstaller or the
  // user may have changed it.
  function openMenu(target: HTMLElement): void {
    setAnchor(target);
    setShellError(undefined);
    api
      .shellIntegration()
      .then(setShell)
      .catch((err) => setShellError(errorMessage(err)));
  }

  async function toggleShell(key: ShellIntegrationKey): Promise<void> {
    if (!shell) return;
    setShellBusy(true);
    setShellError(undefined);
    try {
      setShell(await api.setShellIntegration(key, !shell[key]));
    } catch (err) {
      setShellError(errorMessage(err));
    } finally {
      setShellBusy(false);
    }
  }

  async function showAbout(): Promise<void> {
    setAnchor(null);
    setAboutOpen(true);
    if (!info) {
      try {
        setInfo(await api.appInfo());
      } catch (err) {
        setError(errorMessage(err));
      }
    }
  }

  return (
    <>
      <Tooltip title="Settings">
        <IconButton
          aria-label="Settings"
          aria-haspopup="menu"
          onClick={(e) => openMenu(e.currentTarget)}
          size="small"
          sx={{
            appRegion: 'no-drag',
            color: 'text.secondary',
            // The title bar is only 32px tall.
            padding: '4px',
          }}
        >
          <SettingsOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>Theme</ListSubheader>
        {THEMES.map(({ value, label, Icon }) => (
          <MenuItem
            key={value}
            selected={value === themeSource}
            onClick={() => {
              onThemeSourceChange(value);
              setAnchor(null);
            }}
          >
            <ListItemIcon>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{label}</ListItemText>
            {value === themeSource && <CheckRounded fontSize="small" sx={{ ml: 2 }} />}
          </MenuItem>
        ))}
        {shell !== null && <Divider />}
        {shell !== null && (
          <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
            Right-click a video in Explorer
          </ListSubheader>
        )}
        {shell !== null &&
          SHELL_ENTRIES.map(({ key, label, Icon }) => (
            <MenuItem
              key={key}
              disabled={!shell || shellBusy}
              onClick={() => void toggleShell(key)}
            >
              <ListItemIcon>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{label}</ListItemText>
              {shell?.[key] && <CheckRounded fontSize="small" sx={{ ml: 2 }} />}
            </MenuItem>
          ))}
        {shell !== null && shellError && (
          <Typography
            variant="caption"
            color="error"
            sx={{ display: 'block', px: 2, py: 0.5, maxWidth: 280 }}
          >
            {shellError}
          </Typography>
        )}
        <Divider />
        <MenuItem onClick={() => void showAbout()}>
          <ListItemIcon>
            <InfoOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>About Media Cast</ListItemText>
        </MenuItem>
      </Menu>
      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Media Cast {info?.appVersion}</DialogTitle>
        <DialogContent>
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : info ? (
            <Stack spacing={1}>
              <Typography variant="body2">{info.ffmpegVersion}</Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                <strong>ffmpeg:</strong> {info.ffmpegPath}
              </Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                <strong>ffprobe:</strong> {info.ffprobePath}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2">Loading…</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAboutOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
