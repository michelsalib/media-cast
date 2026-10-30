import { CheckRounded } from '@mui/icons-material';
import { Button, Stack, Tooltip } from '@mui/material';
import { useEffect, useState } from 'react';
import { isBitmapSubtitleCodec } from '../../../shared/subtitles';
import type { DeviceType } from '../../../shared/types';
import { api, pathFor } from '../ipc';
import { languageName } from '../labels';
import { chipSx } from '../theme';
import { NO_SUBTITLES, type SubtitlesFile, type SubtitlesSelection } from './SubtitlesSelection';

type Props = {
  videoFile?: File;
  subFile?: SubtitlesFile;
  deviceType?: DeviceType;
  onChange?: (selection: SubtitlesSelection) => void;
};

// Chromecast always direct-plays with sidecar WebVTT, so image-based tracks have no
// path to the screen there.
function isSupported(c: SubtitlesSelection, deviceType: DeviceType | undefined): boolean {
  return !(c.type === 'internal' && c.bitmap && deviceType === 'chromecast');
}

function choiceKey(c: SubtitlesSelection): string {
  switch (c.type) {
    case 'external':
      return `ext:${c.path}`;
    case 'internal':
      return `int:${c.index}`;
    default:
      return 'none';
  }
}

function choiceLabel(c: SubtitlesSelection): string {
  switch (c.type) {
    case 'external':
      return 'Added subtitles';
    case 'internal':
      return c.name;
    default:
      return 'Off';
  }
}

// "English", "English · SDH", or the track title alone when it already names the language.
function trackName(language: string | undefined, title: string | undefined, i: number): string {
  const lang = languageName(language);
  if (lang && title && !title.toLowerCase().includes(lang.toLowerCase())) {
    return `${lang} · ${title}`;
  }
  return title || lang || `Track ${i + 1}`;
}

export default function SubtitlesSelector({
  onChange,
  subFile,
  videoFile,
  deviceType,
}: Props): React.JSX.Element {
  const [choices, setChoices] = useState<SubtitlesSelection[]>([NO_SUBTITLES]);
  const [choice, setChoice] = useState(NO_SUBTITLES);

  useEffect(() => {
    let cancelled = false;

    async function compute(): Promise<void> {
      const newChoices: SubtitlesSelection[] = [];

      if (subFile) {
        newChoices.push({ type: 'external', name: subFile.name, path: subFile.path });
      }

      if (videoFile) {
        const probeData = await api.probe(pathFor(videoFile));
        const internal = probeData.streams
          .filter((s) => s.codec_type === 'subtitle')
          .map(
            (s, i): SubtitlesSelection => ({
              type: 'internal',
              index: i,
              name: trackName(s.tags?.language, s.tags?.title, i),
              bitmap: isBitmapSubtitleCodec(s.codec_name),
            })
          );
        newChoices.push(...internal);
      }

      newChoices.push(NO_SUBTITLES);

      if (cancelled) {
        return;
      }

      const autoSelect =
        newChoices.find((c) => c.type === 'external') ??
        newChoices.find((c) => c.type === 'internal' && isSupported(c, deviceType)) ??
        NO_SUBTITLES;

      setChoices(newChoices);
      setChoice(autoSelect);
    }

    compute();

    return () => {
      cancelled = true;
    };
  }, [videoFile, subFile, deviceType]);

  useEffect(() => {
    onChange?.(choice);
  }, [choice, onChange]);

  return (
    <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
      {choices.map((c) => {
        const selected = c === choice;
        const supported = isSupported(c, deviceType);
        const hint = !supported
          ? 'Image subtitles can’t be shown on a Chromecast'
          : c.type === 'external'
            ? c.name
            : '';
        return (
          <Tooltip key={choiceKey(c)} title={hint} placement="top">
            <span>
              <Button
                aria-pressed={selected}
                disabled={!supported}
                onClick={() => setChoice(c)}
                sx={chipSx(selected)}
                startIcon={selected ? <CheckRounded /> : undefined}
              >
                {choiceLabel(c)}
              </Button>
            </span>
          </Tooltip>
        );
      })}
    </Stack>
  );
}
