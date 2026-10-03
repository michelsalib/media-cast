import { MenuItem, Select } from '@mui/material';
import { useEffect, useState } from 'react';
import { isBitmapSubtitleCodec } from '../../../shared/subtitles';
import type { DeviceType } from '../../../shared/types';
import { api, pathFor } from '../ipc';
import { NO_SUBTITLES, type SubtitlesSelection } from './SubtitlesSelection';

type Props = {
  videoFile?: File;
  subFile?: File;
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
      return `ext:${c.file.name}`;
    case 'internal':
      return `int:${c.index}`;
    default:
      return 'none';
  }
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
      const newChoices: SubtitlesSelection[] = [NO_SUBTITLES];

      if (videoFile) {
        const probeData = await api.probe(pathFor(videoFile));
        const internal = probeData.streams
          .filter((s) => s.codec_type === 'subtitle')
          .map(
            (s, i): SubtitlesSelection => ({
              type: 'internal',
              index: i,
              name: s.tags.title || s.tags.language || 'Unknown video subtitles',
              bitmap: isBitmapSubtitleCodec(s.codec_name),
            })
          );
        newChoices.push(...internal);
      }

      if (subFile) {
        newChoices.push({ type: 'external', name: subFile.name, file: subFile });
      }

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
    <Select
      variant="standard"
      value={choices.indexOf(choice)}
      onChange={(e) => {
        const selection = choices[Number(e.target.value)];
        setChoice(selection);
      }}
    >
      {choices.map((c, i) => (
        <MenuItem key={choiceKey(c)} value={i} disabled={!isSupported(c, deviceType)}>
          {isSupported(c, deviceType) ? c.name : `${c.name} (image subtitles, not supported)`}
        </MenuItem>
      ))}
    </Select>
  );
}
