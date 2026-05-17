import {
  ArrowDropDown,
  Bolt,
  Cast,
  ExpandMore,
  FolderOpen,
  Memory,
  MovieCreation,
  VideoFile,
} from '@mui/icons-material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  alpha,
  Backdrop,
  Box,
  Button,
  ButtonGroup,
  keyframes,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  type SxProps,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import format from 'format-duration';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FFProbeData } from '../../../main/ffmpeg';
import { type CompatReport, checkCompat } from '../../../shared/compat';
import type { Device } from '../../../shared/types';
import type { AudioSelection } from './AudioSelection';
import AudioSelector from './AudioSelector';
import { NO_SUBTITLES, type SubtitlesSelection } from './SubtitlesSelection';
import SubtitlesSelector from './SubtitlesSelector';
import VideoInfoButton from './VideoInfoButton';

type Props = SxProps & {
  children: React.JSX.Element;
  device: Device | null;
};

const glow = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(124,77,255,0.5); }
  50%      { box-shadow: 0 0 0 6px rgba(124,77,255,0); }
`;

const marquee = keyframes`
  0%, 10%   { transform: translateX(0); }
  50%, 90%  { transform: translateX(calc(-1 * var(--marquee-distance, 0px))); animation-timing-function: steps(1, end); }
  100%      { transform: translateX(0); }
`;

export default function Dropper(props: Props): React.JSX.Element {
  const [isOver, setIsOver] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [video, setVideo] = useState<File | undefined>();
  const [subs, setSubs] = useState<File | undefined>();
  const [subtitlesSelection, setSubtitlesSelection] = useState<SubtitlesSelection>(NO_SUBTITLES);
  const [audioSelection, setAudioSelection] = useState<AudioSelection | undefined>();
  const [thumbnail, setThumbnail] = useState<Buffer | undefined>(undefined);
  const [probeData, setProbeData] = useState<FFProbeData | undefined>(undefined);
  const [burnSubtitles, setBurnSubtitles] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [marqueeDistance, setMarqueeDistance] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);

  function startMarquee(): void {
    const el = nameRef.current;
    if (!el) return;
    setMarqueeDistance(Math.max(0, el.scrollWidth - el.clientWidth));
  }
  function stopMarquee(): void {
    setMarqueeDistance(0);
  }
  const theme = useTheme();
  const connected = props.device !== null;
  const hasSubs = subtitlesSelection.type !== 'no subtitles';
  const showBurnToggle = props.device?.type === 'upnp' && hasSubs;

  function ingest(files: Iterable<File>): void {
    for (const file of files) {
      if (file.name.endsWith('mp4') || file.name.endsWith('mkv')) {
        setVideo(file);
      } else {
        setSubs(file);
      }
    }
  }

  function drop(event: React.DragEvent): void {
    event.preventDefault();
    ingest(event.dataTransfer.files);
    setIsOver(false);
    setIsOpen(true);
  }

  function browse(event: React.MouseEvent): void {
    event.stopPropagation();
    fileInput.current?.click();
  }

  function onFilesPicked(event: React.ChangeEvent<HTMLInputElement>): void {
    if (event.target.files) {
      ingest(event.target.files);
      setIsOpen(true);
    }
    event.target.value = '';
  }

  function dragOver(event: React.DragEvent): void {
    event.preventDefault();
    setIsOver(true);
  }

  function dragLeave(event: React.DragEvent): void {
    event.preventDefault();
    setIsOver(false);
  }

  function cast(event: React.MouseEvent): void {
    event.stopPropagation();
    if (!video) {
      return;
    }
    const audioArg = audioSelection?.index;
    const burn = props.device?.type === 'upnp' ? burnSubtitles : false;
    if (subtitlesSelection.type === 'external') {
      window.api.load(video, subtitlesSelection.file, audioArg, burn);
    } else if (subtitlesSelection.type === 'internal') {
      window.api.load(video, subtitlesSelection.index, audioArg, burn);
    } else {
      window.api.load(video, undefined, audioArg, burn);
    }
  }

  useEffect(() => {
    async function generate(): Promise<void> {
      if (!video) {
        return;
      }

      const thumbnail = await window.api.thumbnail(video);

      setThumbnail(thumbnail);
    }

    generate();
  }, [video]);

  useEffect(() => {
    if (!video) {
      setProbeData(undefined);
      return;
    }
    let cancelled = false;
    window.api.probe(video).then((data) => {
      if (!cancelled) setProbeData(data);
    });
    return () => {
      cancelled = true;
    };
  }, [video]);

  const compat = useMemo<CompatReport | undefined>(() => {
    if (!video || !probeData || !props.device) return undefined;
    return checkCompat({
      videoFileName: video.name,
      probeData,
      deviceType: props.device.type,
      burnSubtitles: showBurnToggle && burnSubtitles,
      audioIndex: audioSelection?.index,
    });
  }, [video, probeData, props.device, showBurnToggle, burnSubtitles, audioSelection]);

  const canCast = !!video && connected;
  const durationSec = probeData ? Number(probeData.format.duration) : Number.NaN;
  const durationLabel = Number.isFinite(durationSec) ? format(durationSec * 1000) : null;
  const caption = !video
    ? 'Drag .mp4 / .mkv and optionally a subtitle file'
    : (durationLabel ?? formatBytes(video.size));
  const hasAudio = probeData?.streams.some((s) => s.codec_type === 'audio') ?? false;
  const thumbnailUrl = useMemo(
    () =>
      thumbnail
        ? `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(thumbnail)))}`
        : undefined,
    [thumbnail]
  );

  return (
    <Box onDrop={drop} onDragOver={dragOver} onDragLeave={dragLeave} sx={{ height: '100%' }}>
      {props.children}
      <input
        ref={fileInput}
        type="file"
        accept=".mp4,.mkv,.srt,.vtt,.ass,.ssa,.sub"
        multiple
        hidden
        onChange={onFilesPicked}
      />

      <Accordion
        expanded={isOpen || isOver}
        onChange={() => setIsOpen(!isOpen)}
        variant="elevation"
        elevation={0}
        sx={{
          width: 520,
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translate(-50%)',
          margin: '0px !important',
          background: `linear-gradient(180deg, ${alpha(
            theme.palette.background.paper,
            0.85
          )} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          borderBottomLeftRadius: '0 !important',
          borderBottomRightRadius: '0 !important',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
          '&::before': { height: 0 },
          '&.Mui-expanded': { margin: '0px !important' },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMore />}
          sx={{
            px: 2.5,
            '& .MuiAccordionSummary-content': {
              alignItems: 'center',
              gap: 1.5,
              my: 1.5,
              overflow: 'hidden',
            },
          }}
        >
          <Box
            sx={{
              width: thumbnailUrl ? (32 * 16) / 9 : 32,
              height: 32,
              borderRadius: thumbnailUrl ? 0.5 : 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              overflow: 'hidden',
              backgroundColor: alpha(
                video ? theme.palette.primary.main : theme.palette.text.secondary,
                0.15
              ),
              color: video ? theme.palette.primary.light : theme.palette.text.secondary,
              backgroundImage: thumbnailUrl ? `url(${thumbnailUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!thumbnailUrl && <MovieCreation fontSize="small" />}
          </Box>
          <Stack sx={{ overflow: 'hidden', minWidth: 0, flex: 1 }}>
            <Box
              onMouseEnter={startMarquee}
              onMouseLeave={stopMarquee}
              sx={{ overflow: 'hidden', minWidth: 0 }}
            >
              <Typography
                ref={nameRef}
                sx={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: video ? 'text.primary' : 'text.secondary',
                  whiteSpace: 'nowrap',
                  ...(marqueeDistance > 0
                    ? {
                        display: 'inline-block',
                        '--marquee-distance': `${marqueeDistance}px`,
                        animation: `${marquee} ${marqueeDistance / 40 + 3}s ease-in-out infinite`,
                      }
                    : {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }),
                }}
              >
                {video ? video.name : 'Drop a video file to get started'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ minWidth: 0, alignItems: 'center' }}>
              <Typography noWrap variant="caption" sx={{ color: 'text.secondary' }}>
                {caption}
              </Typography>
              {compat && <CompatChip report={compat} />}
            </Stack>
          </Stack>
          {video ? (
            <Tooltip placement="top" title={!connected ? 'Connect to cast device first' : ''}>
              <ButtonGroup
                variant="contained"
                size="small"
                disableElevation
                sx={{
                  flexShrink: 0,
                  mr: 1,
                  borderRadius: 2,
                  overflow: 'hidden',
                  background: canCast
                    ? `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`
                    : alpha(theme.palette.primary.main, 0.18),
                  animation: canCast ? `${glow} 2s ease-in-out infinite` : 'none',
                  transition: 'background 200ms ease',
                  '&:hover': canCast
                    ? {
                        background: `linear-gradient(135deg, ${theme.palette.primary.light} 0%, ${theme.palette.primary.main} 100%)`,
                      }
                    : undefined,
                  '& .MuiButton-root': {
                    background: 'transparent',
                    boxShadow: 'none',
                    color: canCast ? '#fff' : alpha(theme.palette.primary.light, 0.7),
                    borderColor: alpha(theme.palette.common.black, 0.25),
                    '&:hover': {
                      background: alpha(theme.palette.common.white, 0.08),
                    },
                    '&.Mui-disabled': {
                      color: alpha(theme.palette.primary.light, 0.55),
                      borderColor: alpha(theme.palette.common.black, 0.25),
                    },
                  },
                }}
              >
                <Button
                  component="div"
                  role="button"
                  onClick={cast}
                  disabled={!canCast}
                  startIcon={<Cast />}
                  sx={{
                    px: 2,
                    fontWeight: 600,
                    letterSpacing: 1,
                  }}
                >
                  Cast
                </Button>
                <Button
                  component="div"
                  role="button"
                  aria-label="more options"
                  aria-haspopup="menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuAnchor(e.currentTarget);
                  }}
                  sx={{
                    px: 0.5,
                    minWidth: 32,
                  }}
                >
                  <ArrowDropDown />
                </Button>
              </ButtonGroup>
            </Tooltip>
          ) : (
            <Button
              component="div"
              role="button"
              variant="outlined"
              size="small"
              onClick={browse}
              startIcon={<FolderOpen />}
              sx={{
                flexShrink: 0,
                mr: 1,
                fontWeight: 600,
                letterSpacing: 0.5,
                borderRadius: 2,
                borderColor: alpha(theme.palette.primary.light, 0.4),
                color: theme.palette.primary.light,
                '&:hover': {
                  borderColor: theme.palette.primary.light,
                  backgroundColor: alpha(theme.palette.primary.main, 0.08),
                },
              }}
            >
              Browse
            </Button>
          )}
          <Menu
            anchorEl={menuAnchor}
            open={!!menuAnchor}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem
              onClick={(e) => {
                setMenuAnchor(null);
                browse(e);
              }}
            >
              <ListItemIcon>
                <FolderOpen fontSize="small" />
              </ListItemIcon>
              <ListItemText>Browse…</ListItemText>
            </MenuItem>
          </Menu>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, pb: 2, px: 2.5 }}>
          <Box
            sx={{
              position: 'relative',
              p: 2,
              borderRadius: 2,
              overflow: 'hidden',
              isolation: 'isolate',
              background: `linear-gradient(145deg, ${alpha(
                theme.palette.primary.main,
                0.06
              )} 0%, ${alpha(theme.palette.background.paper, 0.4)} 100%)`,
              border: '1px solid rgba(255,255,255,0.06)',
              '&::before': thumbnailUrl
                ? {
                    content: '""',
                    position: 'absolute',
                    inset: -40,
                    backgroundImage: `url(${thumbnailUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: 'blur(32px) saturate(1.4)',
                    opacity: 0.55,
                    zIndex: -1,
                  }
                : undefined,
              '&::after': thumbnailUrl
                ? {
                    content: '""',
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: alpha(theme.palette.background.paper, 0.45),
                    zIndex: -1,
                  }
                : undefined,
            }}
          >
            {video && (
              <VideoInfoButton
                video={video}
                sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
              />
            )}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '140px minmax(0, 1fr)',
                alignItems: 'center',
                rowGap: 1.5,
                columnGap: 2,
                pr: video ? 5 : 0,
                '& .MuiSelect-select': {
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                },
                '& .MuiInputBase-root': { width: '100%' },
              }}
            >
              {hasAudio && (
                <>
                  <FormLabel>Audio</FormLabel>
                  <AudioSelector videoFile={video} onChange={setAudioSelection} />
                </>
              )}
              <FormLabel>Subtitles</FormLabel>
              <SubtitlesSelector
                subFile={subs}
                videoFile={video}
                onChange={setSubtitlesSelection}
              />
              {showBurnToggle && (
                <>
                  <FormLabel>Burn into video</FormLabel>
                  <Tooltip
                    placement="top"
                    enterDelay={300}
                    title="Re-encodes the video to embed subtitles. Required only for older TVs that ignore sidecar captions."
                  >
                    <Box sx={{ justifySelf: 'start' }}>
                      <Switch
                        size="small"
                        checked={burnSubtitles}
                        onChange={(e) => setBurnSubtitles(e.target.checked)}
                      />
                    </Box>
                  </Tooltip>
                </>
              )}
            </Box>
          </Box>
        </AccordionDetails>
      </Accordion>
      <Backdrop
        open={isOver}
        sx={{
          backgroundColor: alpha(theme.palette.primary.main, 0.15),
          backdropFilter: 'blur(4px)',
          flexDirection: 'column',
          gap: 2,
          zIndex: theme.zIndex.modal + 1,
        }}
      >
        <Box
          sx={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: alpha(theme.palette.primary.main, 0.2),
            border: `2px dashed ${theme.palette.primary.light}`,
          }}
        >
          <VideoFile sx={{ fontSize: 40, color: theme.palette.primary.light }} />
        </Box>
        <Typography variant="h6" sx={{ color: theme.palette.primary.light, fontWeight: 600 }}>
          Drop to load
        </Typography>
      </Backdrop>
    </Box>
  );
}

function FormLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Typography
      variant="overline"
      sx={{ color: 'text.secondary', lineHeight: 1, letterSpacing: 1 }}
    >
      {children}
    </Typography>
  );
}

function CompatChip({ report }: { report: CompatReport }): React.JSX.Element {
  const theme = useTheme();
  const transcoding = report.needsTranscoding;
  const accent = transcoding ? theme.palette.warning.main : theme.palette.success.main;
  const accentLight = transcoding ? theme.palette.warning.light : theme.palette.success.light;

  return (
    <Tooltip
      placement="top"
      enterDelay={200}
      title={
        <Box sx={{ minWidth: 220 }}>
          <Box sx={{ fontWeight: 600, fontSize: 13, mb: 0.75 }}>
            {transcoding ? 'Transcoding required' : 'Direct play'}
          </Box>
          <Stack spacing={0.25} sx={{ fontSize: 12 }}>
            <Box>
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Container:{' '}
              </Box>
              {report.container || 'unknown'}
            </Box>
            <Box>
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Video:{' '}
              </Box>
              {report.videoCodec ?? 'unknown'}
            </Box>
            <Box>
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Audio:{' '}
              </Box>
              {report.audioCodec ?? 'unknown'}
            </Box>
          </Stack>
          {report.issues.length > 0 && (
            <Box sx={{ mt: 1, pt: 0.75, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <Box sx={{ fontSize: 11, color: 'text.secondary', mb: 0.25 }}>Why re-encode</Box>
              <Stack component="ul" sx={{ pl: 2, m: 0, fontSize: 12 }} spacing={0.25}>
                {report.issues.map((issue) => (
                  <li key={issue.kind}>{issue.detail}</li>
                ))}
              </Stack>
            </Box>
          )}
        </Box>
      }
      slotProps={{
        tooltip: {
          sx: {
            backgroundColor: alpha(theme.palette.background.paper, 0.98),
            color: theme.palette.text.primary,
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 1.5,
            padding: '10px 12px',
            maxWidth: 360,
            lineHeight: 1.5,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(8px)',
          },
        },
      }}
    >
      <Box
        component="span"
        sx={{
          flexShrink: 0,
          mr: 1,
          width: 24,
          height: 24,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: accentLight,
          backgroundColor: alpha(accent, 0.12),
          border: `1px solid ${alpha(accent, 0.35)}`,
          cursor: 'help',
        }}
      >
        {transcoding ? <Memory sx={{ fontSize: 14 }} /> : <Bolt sx={{ fontSize: 14 }} />}
      </Box>
    </Tooltip>
  );
}

function formatBytes(bytes: number): string {
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
