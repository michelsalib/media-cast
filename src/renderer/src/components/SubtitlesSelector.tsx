import type { DeviceType } from '../../../shared/types';
import { subtitleFileName } from '../labels';
import SubtitleChoices, { type SubtitleOption } from './SubtitleChoices';
import {
  bundledSelection,
  isSupported,
  NO_SUBTITLES,
  type SubtitlesFile,
  type SubtitlesSelection,
} from './SubtitlesSelection';

type Props = {
  // The video's own tracks.
  internal: SubtitlesSelection[];
  subFile?: SubtitlesFile;
  // The subtitle files in a torrent video's torrent: listed, downloaded when picked.
  bundled: SubtitlesFile[];
  deviceType?: DeviceType;
  value: SubtitlesSelection;
  // The torrent file being downloaded, while it is.
  fetching?: string;
  onPick: (selection: SubtitlesSelection) => void;
  onPickFile: (file: SubtitlesFile) => void;
};

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

// The subtitle choices for the video ready. Dropper owns what is picked (the phone
// remote can pick too) and the defaults; this only draws them.
export default function SubtitlesSelector({
  internal,
  subFile,
  bundled,
  deviceType,
  value,
  fetching,
  onPick,
  onPickFile,
}: Props): React.JSX.Element {
  const external: SubtitlesSelection | undefined = subFile && {
    type: 'external',
    name: subFile.name,
    path: subFile.path,
  };
  const options: (SubtitleOption & { selection?: SubtitlesSelection; file?: SubtitlesFile })[] = [
    ...(external
      ? [
          {
            key: choiceKey(external),
            label: 'Added subtitles',
            detail: external.name,
            selection: external,
          },
        ]
      : []),
    ...internal.map((c) => ({
      key: choiceKey(c),
      label: c.name,
      group: 'In the video',
      disabled: !isSupported(c, deviceType),
      hint: isSupported(c, deviceType)
        ? undefined
        : 'Image subtitles can’t be shown on a Chromecast',
      selection: c,
    })),
    ...bundled.map((f) => ({
      key: choiceKey(bundledSelection(f)),
      label: subtitleFileName(f.label ?? ''),
      group: 'In the torrent',
      detail: f.folder ? `${f.folder}/${f.name}` : f.name,
      file: f,
    })),
    { key: choiceKey(NO_SUBTITLES), label: 'Off', selection: NO_SUBTITLES },
  ];

  function pick(key: string): void {
    const option = options.find((o) => o.key === key);
    if (option?.selection) onPick(option.selection);
    else if (option?.file) onPickFile(option.file);
  }

  return (
    <SubtitleChoices
      options={options}
      selected={choiceKey(value)}
      loading={fetching && `ext:${fetching}`}
      disabled={!!fetching}
      onPick={pick}
    />
  );
}
