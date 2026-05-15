import { MenuItem, Select } from '@mui/material';
import { useEffect, useState } from 'react';
import { NO_SUBTITLES, type SubtitlesSelection } from './SubtitlesSelection';

type Props = {
  videoFile?: File;
  subFile?: File;
  onChange?: (selection: SubtitlesSelection) => void;
};

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
}: Props): React.JSX.Element {
  const [choices, setChoices] = useState<SubtitlesSelection[]>([NO_SUBTITLES]);
  const [choice, setChoice] = useState(NO_SUBTITLES);

  useEffect(() => {
    let cancelled = false;

    async function compute(): Promise<void> {
      const newChoices: SubtitlesSelection[] = [NO_SUBTITLES];

      if (videoFile) {
        const probeData = await window.api.probe(videoFile);
        const internal = probeData.streams
          .filter((s) => s.codec_type === 'subtitle')
          .map(
            (s, i): SubtitlesSelection => ({
              type: 'internal',
              index: i,
              name: s.tags.title || s.tags.language || 'Unknown video subtitles',
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
        newChoices.find((c) => c.type === 'internal') ??
        NO_SUBTITLES;

      setChoices(newChoices);
      setChoice(autoSelect);
    }

    compute();

    return () => {
      cancelled = true;
    };
  }, [videoFile, subFile]);

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
        <MenuItem key={choiceKey(c)} value={i}>
          {c.name}
        </MenuItem>
      ))}
    </Select>
  );
}
