import { resultKey } from '../../../shared/subtitleSearch';
import type { SubtitleSearchBackend, SubtitleSyncBackend } from '../components/subtitleBackends';
import { remote } from './client';

// The phone's side of the shared subtitle dialogs. `target`: the id of the video the
// computer has ready, or null for the one playing.

// A download is added to the video ready, or played with the one playing.
export function remoteSearch(target: string | null, onUsed: () => void): SubtitleSearchBackend {
  return {
    // Languages, accounts and API keys are set on the computer.
    settings: false,
    guess: () => remote.subtitleQuery(target),
    search: (query) => remote.searchSubtitles(target, query),
    download: async (result, episode) => {
      await remote.downloadSubtitle(target, resultKey(result), episode);
      onUsed();
    },
  };
}

// The subtitles picked for the video ready; a new timing adds a retimed copy in their place.
export function remoteSync(preparedId: string, onDone: () => void): SubtitleSyncBackend {
  return {
    start: () => remote.readyTiming(preparedId),
    stop: () => void remote.stopPreview().catch(() => {}),
    apply: async (timing, changed) => {
      if (changed) await remote.retimeReady(preparedId, timing);
      onDone();
    },
  };
}
