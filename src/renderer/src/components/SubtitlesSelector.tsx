import { MenuItem, Select } from '@mui/material';
import { useEffect, useState } from 'react';
import { NO_SUBTITLES, SubtitlesSelection } from './SubtitlesSelection';

type Props = {
  videoFile?: File;
  subFile?: File;
  onChange?: (selection: SubtitlesSelection) => void;
};

export default function SubtitlesSelector({
  onChange,
  subFile,
  videoFile,
}: Props): React.JSX.Element {
  const [choices, setChoices] = useState<SubtitlesSelection[]>([NO_SUBTITLES]);
  const [choice, setChoice] = useState(NO_SUBTITLES);

  useEffect(() => {
    const newChoices: SubtitlesSelection[] = choices.filter((c) => c.type != 'external');

    if (subFile) {
      const newChoice: SubtitlesSelection = {
        type: 'external',
        name: subFile.name,
        file: subFile,
      };
      newChoices.push(newChoice);
      setChoice(newChoice);
    } else if (choice.type == 'external') {
      setChoice(NO_SUBTITLES);
    }

    setChoices(newChoices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subFile]);

  useEffect(() => {
    async function compute(): Promise<void> {
      const newChoices: SubtitlesSelection[] = choices.filter((c) => c.type != 'internal');

      if (videoFile) {
        const probeData = await window.api.probe(videoFile);
        const newChoicesItems = probeData.streams
          .filter((s) => s.codec_type == 'subtitle')
          .map((s, i): SubtitlesSelection => {
            return {
              type: 'internal',
              index: i,
              name: s.tags.title || s.tags.language || 'Unknown video subtitles',
            };
          });
        newChoices.push(...newChoicesItems);
        setChoice(newChoicesItems.length ? newChoicesItems[0] : NO_SUBTITLES);
      } else if (choice.type == 'internal') {
        setChoice(NO_SUBTITLES);
      }

      setChoices(newChoices);
    }
    compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoFile]);

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
        <MenuItem key={i} value={i}>
          {c.name}
        </MenuItem>
      ))}
    </Select>
  );
}
