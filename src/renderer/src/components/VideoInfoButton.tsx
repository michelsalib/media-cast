import { InfoOutlined } from '@mui/icons-material';
import {
  alpha,
  Box,
  Divider,
  IconButton,
  Popover,
  Stack,
  type SxProps,
  Typography,
  useTheme,
} from '@mui/material';
import { useRef, useState } from 'react';
import type { FFProbeData } from '../../../main/ffmpeg';

interface Props {
  video: File;
  sx?: SxProps;
}

export default function VideoInfoButton({ video, sx }: Props): React.JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<FFProbeData>();
  const [error, setError] = useState<string>();
  const [lastVideo, setLastVideo] = useState(video);
  const theme = useTheme();

  // Render-phase reset of cached probe data when the video prop changes.
  // https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes
  if (lastVideo !== video) {
    setLastVideo(video);
    setInfo(undefined);
    setError(undefined);
  }

  async function show(event: React.MouseEvent): Promise<void> {
    event.stopPropagation();
    setOpen(true);
    if (!info && !error) {
      try {
        setInfo(await window.api.probe(video));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const videoStreams = info?.streams.filter((s) => s.codec_type === 'video') ?? [];
  const audioStreams = info?.streams.filter((s) => s.codec_type === 'audio') ?? [];
  const subtitleStreams = info?.streams.filter((s) => s.codec_type === 'subtitle') ?? [];

  return (
    <>
      <IconButton
        ref={anchorRef}
        onClick={show}
        size="small"
        sx={{
          color: alpha(theme.palette.common.white, 0.7),
          backgroundColor: alpha(theme.palette.background.paper, 0.5),
          backdropFilter: 'blur(8px)',
          '&:hover': {
            color: theme.palette.primary.light,
            backgroundColor: alpha(theme.palette.background.paper, 0.7),
          },
          ...sx,
        }}
      >
        <InfoOutlined fontSize="small" />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, maxWidth: 420, minWidth: 280 }}>
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : info ? (
            <Stack spacing={1.5}>
              <Section title="Format">
                <Row label="Container" value={info.format.format_long_name} />
                <Row label="Duration" value={formatDuration(Number(info.format.duration))} />
                <Row label="Size" value={formatBytes(Number(info.format.size))} />
                <Row label="Bitrate" value={formatBitrate(Number(info.format.bit_rate))} />
              </Section>

              {videoStreams.length > 0 && (
                <>
                  <Divider />
                  <Section title="Video">
                    {videoStreams.map((s) => (
                      <Row
                        key={s.index}
                        label={s.codec_name.toUpperCase()}
                        value={s.width && s.height ? `${s.width}×${s.height}` : '—'}
                      />
                    ))}
                  </Section>
                </>
              )}

              {audioStreams.length > 0 && (
                <>
                  <Divider />
                  <Section title="Audio">
                    {audioStreams.map((s) => (
                      <Row
                        key={s.index}
                        label={s.codec_name.toUpperCase()}
                        value={formatLangTitle(s.tags.language, s.tags.title)}
                      />
                    ))}
                  </Section>
                </>
              )}

              {subtitleStreams.length > 0 && (
                <>
                  <Divider />
                  <Section title="Subtitles">
                    {subtitleStreams.map((s) => (
                      <Row
                        key={s.index}
                        label={s.codec_name.toUpperCase()}
                        value={formatLangTitle(s.tags.language, s.tags.title)}
                      />
                    ))}
                  </Section>
                </>
              )}
            </Stack>
          ) : (
            <Typography variant="body2">Loading…</Typography>
          )}
        </Box>
      </Popover>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack spacing={0.5}>
      <Typography
        variant="overline"
        sx={{ color: 'text.secondary', lineHeight: 1, letterSpacing: 1 }}
      >
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="caption" sx={{ wordBreak: 'break-word', textAlign: 'right' }}>
        {value}
      </Typography>
    </Stack>
  );
}

function formatLangTitle(language?: string, title?: string): string {
  const lang = language ? language.toUpperCase() : undefined;
  if (lang && title) return `${lang} · ${title}`;
  return lang ?? title ?? '—';
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatBitrate(bitsPerSec: number): string {
  if (!Number.isFinite(bitsPerSec) || bitsPerSec <= 0) return '—';
  if (bitsPerSec >= 1_000_000) return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`;
  if (bitsPerSec >= 1_000) return `${(bitsPerSec / 1_000).toFixed(0)} kbps`;
  return `${bitsPerSec} bps`;
}
