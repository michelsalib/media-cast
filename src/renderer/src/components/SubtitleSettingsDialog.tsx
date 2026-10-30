import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { SubtitleSettingsView } from '../../../shared/subtitleSearch';
import { api, errorMessage } from '../ipc';
import LanguagesInput from './LanguagesInput';

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (settings: SubtitleSettingsView) => void;
};

export default function SubtitleSettingsDialog({
  open,
  onClose,
  onSaved,
}: Props): React.JSX.Element {
  const [languages, setLanguages] = useState<string[]>([]);
  const [osUsername, setOsUsername] = useState('');
  const [osPassword, setOsPassword] = useState('');
  const [osHasPassword, setOsHasPassword] = useState(false);
  const [osApiKey, setOsApiKey] = useState('');
  const [osBuiltIn, setOsBuiltIn] = useState(false);
  const [subdlApiKey, setSubdlApiKey] = useState('');
  const [subdlBuiltIn, setSubdlBuiltIn] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setOsPassword('');
    api
      .subtitleSettings()
      .then((s) => {
        setLanguages(s.languages);
        setOsUsername(s.opensubtitles.username);
        setOsHasPassword(s.opensubtitles.hasPassword);
        setOsApiKey(s.opensubtitles.apiKey);
        setOsBuiltIn(s.opensubtitles.hasBuiltInApiKey);
        setSubdlApiKey(s.subdl.apiKey);
        setSubdlBuiltIn(s.subdl.hasBuiltInApiKey);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [open]);

  function save(): void {
    setSaving(true);
    api
      .saveSubtitleSettings({
        languages,
        opensubtitles: {
          username: osUsername.trim(),
          apiKey: osApiKey.trim(),
          // Blank keeps the stored password, unless the username was cleared too.
          ...(osPassword ? { password: osPassword } : osUsername.trim() ? {} : { password: '' }),
        },
        subdl: { apiKey: subdlApiKey.trim() },
      })
      .then((s) => {
        onSaved(s);
        onClose();
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setSaving(false));
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Subtitle search settings</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <LanguagesInput value={languages} onChange={setLanguages} label="Default languages" />

          <Stack spacing={1.5}>
            <Typography variant="subtitle2">OpenSubtitles.com</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Searching works without an account. Downloads are limited to a handful per day unless
              you log in with a free{' '}
              <Link href="https://www.opensubtitles.com/en/users/sign_up" target="_blank">
                opensubtitles.com account
              </Link>
              .
            </Typography>
            <Stack direction="row" spacing={1.5}>
              <TextField
                label="Username"
                size="small"
                fullWidth
                value={osUsername}
                onChange={(e) => setOsUsername(e.target.value)}
                autoComplete="off"
              />
              <TextField
                label="Password"
                size="small"
                type="password"
                fullWidth
                value={osPassword}
                placeholder={osHasPassword ? '•••••••• (saved)' : ''}
                slotProps={{ inputLabel: osHasPassword ? { shrink: true } : undefined }}
                onChange={(e) => setOsPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Stack>
            <TextField
              label={osBuiltIn ? 'API key (optional)' : 'API key'}
              size="small"
              value={osApiKey}
              onChange={(e) => setOsApiKey(e.target.value)}
              helperText={
                osBuiltIn ? (
                  "Leave empty to use the app's key."
                ) : (
                  <>
                    Free — create a consumer key in your{' '}
                    <Link href="https://www.opensubtitles.com/en/consumers" target="_blank">
                      opensubtitles.com API consumers
                    </Link>{' '}
                    page.
                  </>
                )
              }
            />
          </Stack>

          <Stack spacing={1.5}>
            <Typography variant="subtitle2">Subdl</Typography>
            <TextField
              label={subdlBuiltIn ? 'API key (optional)' : 'API key'}
              size="small"
              value={subdlApiKey}
              onChange={(e) => setSubdlApiKey(e.target.value)}
              helperText={
                <>
                  {subdlBuiltIn
                    ? "Leave empty to use the app's key, or use your own: free"
                    : 'Free'}{' '}
                  — sign up on subdl.com, then copy the key from{' '}
                  <Link href="https://subdl.com/panel/api" target="_blank">
                    your API panel
                  </Link>
                  .
                </>
              }
            />
          </Stack>

          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Addic7ed (via Gestdown) needs no setup and covers TV episodes.
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
