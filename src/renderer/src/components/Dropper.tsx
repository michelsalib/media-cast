import { Cast, ExpandMore, VideoFile } from '@mui/icons-material';
import {
  Accordion,
  AccordionActions,
  AccordionDetails,
  AccordionSummary,
  Backdrop,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Stack,
  SxProps,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { NO_SUBTITLES, SubtitlesSelection } from './SubtitlesSelection';
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
};

export default function Dropper(props: Props): React.JSX.Element {
  const [isOver, setIsOver] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [video, setVideo] = useState<File | undefined>();
  const [subs, setSubs] = useState<File | undefined>();
  const [subtitlesSelection, setSubtitlesSelection] = useState<SubtitlesSelection>(NO_SUBTITLES);
  const [thumbnail, setThumbnail] = useState<Buffer | undefined>(undefined);
  const theme = useTheme();

  function drop(event: React.DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer.files[0];

    // video drop
    if (file.name.endsWith('mp4') || file.name.endsWith('mkv')) {
      setVideo(file);
    }
    // subdrop
    else {
      setSubs(file);
    }

    setIsOver(false);
    setIsOpen(true);
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
      if (subtitlesSelection.type == 'external') {
        window.api.load(video, subtitlesSelection.file);
      } else if (subtitlesSelection.type == 'internal') {
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

  return (
    <Box onDrop={drop} onDragOver={dragOver} onDragLeave={dragLeave} sx={{ height: '100%' }}>
      {props.children}
      <Accordion
        expanded={isOpen || isOver}
        onChange={() => setIsOpen(!isOpen)}
        variant="elevation"
        sx={{
          width: '500px',
          // place at the bottom center
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translate(-50%)',
          margin: '0px !important',
          // bottom corners
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          borderBottomLeftRadius: '0 !important',
          borderBottomRightRadius: '0 !important',
          // remove top border
          '&::before': {
            height: 0,
          },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMore />}>
          {video ? video.name : 'No video - drag file to load'}
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <Card sx={{ display: 'flex' }}>
              {thumbnail ? (
                <CardMedia
                  component="img"
                  sx={MediaStyles}
                  image={`data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(thumbnail)))}`}
                />
              ) : (
                <CardMedia
                  component="div"
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    ...MediaStyles,
                  }}
                  color={video ? theme.palette.success.main : undefined}
                >
                  <VideoFile sx={{ margin: 'auto' }} fontSize="large"></VideoFile>
                </CardMedia>
              )}
              <CardContent sx={{ overflow: 'hidden' }}>
                <Stack spacing={2}>
                  <Typography
                    variant="caption"
                    color={video ? theme.palette.success.main : undefined}
                    noWrap
                  >
                    {video?.name || 'No file'}
                  </Typography>
                  <SubtitlesSelector
                    subFile={subs}
                    videoFile={video}
                    onChange={setSubtitlesSelection}
                  ></SubtitlesSelector>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </AccordionDetails>
        <AccordionActions>
          <Tooltip
            placement="top"
            title={
              !video ? 'Load video first' : !props.connected ? 'Connect to cast device first' : ''
            }
          >
            {/* This span is for the tooltip to trigger when the button is disabled */}
            <span>
              <Button
                variant="contained"
                onClick={cast}
                disabled={!video || !props.connected}
                startIcon={<Cast />}
              >
                Cast
              </Button>
            </span>
          </Tooltip>
        </AccordionActions>
      </Accordion>
      <Backdrop open={isOver} sx={{ backgroundColor: `${theme.palette.primary.main}55` }}>
        Drop here
      </Backdrop>
    </Box>
  );
}
