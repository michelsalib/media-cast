import type { FFProbeData } from '../../../main/ffmpeg';
import { audioTrackName } from '../labels';

export interface AudioSelection {
  index: number;
  name: string;
}

export function audioChoices(probeData: FFProbeData): AudioSelection[] {
  return probeData.streams
    .filter((s) => s.codec_type === 'audio')
    .map((s, i) => ({ index: i, name: audioTrackName({ ...s.tags, channels: s.channels }, i) }));
}
