import { Cast, ExpandMore, FolderOpen, MovieCreation, VideoFile } from '@mui/icons-material';
import {
  Accordion,
  AccordionActions,
  AccordionDetails,
  AccordionSummary,
  Backdrop,
  Box,
  Button,
  Stack,
  type SxProps,
  Tooltip,
  Typography,
  alpha,
  keyframes,
  useTheme,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NO_SUBTITLES, type SubtitlesSelection } from './SubtitlesSelection';
import SubtitlesSelector from './SubtitlesSelector';

type Props = SxProps & {
  children: React.JSX.Element;
  connected: boolean;
};

const MediaHeight = 110;
const MediaStyles: SxProps = {
  width: (MediaHeight * 8) / 6,
  height: MediaHeight,
  flexShrink: 0,
  borderRadius: 1.5,
  overflow: 'hidden',
};

const glow = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(124,77,255,0.5); }
  50%      { box-shadow: 0 0 0 6px rgba(124,77,255,0); }
`;

export default function Dropper(props: Props): React.JSX.Element {
  const [isOver, setIsOver] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [video, setVideo] = useState<File | undefined>();
  const [subs, setSubs] = useState<File | undefined>();
  const [subtitlesSelection, setSubtitlesSelection] = useState<SubtitlesSelection>(NO_SUBTITLES);
  const [thumbnail, setThumbnail] = useState<Buffer | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const theme = useTheme();

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
    if (video) {
      if (subtitlesSelection.type === 'external') {
        window.api.load(video, subtitlesSelection.file);
      } else if (subtitlesSelection.type === 'internal') {
        window.api.load(video, subtitlesSelection.index);
      } else {
        window.api.load(video);
      }
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

  const canCast = !!video && props.connected;
  const sizeLabel = video ? formatBytes(video.size) : null;
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
              width: 32,
              height: 32,
              borderRadius: 1.5,
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
            <Typography
              noWrap
              sx={{
                fontWeight: 600,
                fontSize: 14,
                color: video ? 'text.primary' : 'text.secondary',
              }}
            >
              {video ? video.name : 'Drop a video file to get started'}
            </Typography>
            <Typography noWrap variant="caption" sx={{ color: 'text.secondary' }}>
              {video
                ? `${sizeLabel}${
                    subtitlesSelection.type !== 'no subtitles'
                      ? ` · Subtitles: ${subtitlesSelection.name}`
                      : ' · No subtitles'
                  }`
                : 'Drag .mp4 / .mkv and optionally a subtitle file'}
            </Typography>
          </Stack>
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
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, pb: 2, px: 2.5 }}>
          <Box
            sx={{
              position: 'relative',
              display: 'flex',
              gap: 2,
              p: 1.5,
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
            {thumbnailUrl ? (
              <Box
                component="img"
                src={thumbnailUrl}
                sx={{
                  ...MediaStyles,
                  objectFit: 'cover',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}
              />
            ) : (
              <Box
                sx={{
                  ...MediaStyles,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px dashed ${alpha(theme.palette.text.secondary, 0.3)}`,
                  backgroundColor: alpha(theme.palette.background.default, 0.5),
                }}
              >
                <VideoFile
                  fontSize="large"
                  sx={{
                    color: video ? theme.palette.primary.light : theme.palette.text.secondary,
                  }}
                />
              </Box>
            )}
            <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
              <Typography
                variant="overline"
                sx={{ color: 'text.secondary', lineHeight: 1, letterSpacing: 1 }}
              >
                Subtitles
              </Typography>
              <SubtitlesSelector
                subFile={subs}
                videoFile={video}
                onChange={setSubtitlesSelection}
              />
            </Stack>
          </Box>
        </AccordionDetails>
        <AccordionActions sx={{ px: 2.5, pb: 2 }}>
          <Tooltip
            placement="top"
            title={
              !video ? 'Load video first' : !props.connected ? 'Connect to cast device first' : ''
            }
          >
            <span>
              <Button
                variant="contained"
                onClick={cast}
                disabled={!canCast}
                startIcon={<Cast />}
                sx={{
                  px: 3,
                  fontWeight: 600,
                  letterSpacing: 1,
                  borderRadius: 2,
                  background: canCast
                    ? `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`
                    : undefined,
                  animation: canCast ? `${glow} 2s ease-in-out infinite` : 'none',
                  '&:hover': canCast
                    ? {
                        background: `linear-gradient(135deg, ${theme.palette.primary.light} 0%, ${theme.palette.primary.main} 100%)`,
                      }
                    : undefined,
                }}
              >
                Cast
              </Button>
            </span>
          </Tooltip>
        </AccordionActions>
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
