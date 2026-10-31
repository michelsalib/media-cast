import { useEffect, useState } from 'react';

// The TV reports its position about once a second; subtitle lines need finer steps. Runs
// the last report forward while playing (5 updates a second), restarting at each report.
export function usePlaybackTime(reported: number, playing: boolean): number {
  const [anchor, setAnchor] = useState({ time: reported, at: performance.now() });
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    setAnchor({ time: reported, at: performance.now() });
  }, [reported]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(timer);
  }, [playing]);

  return anchor.time + (playing ? Math.max(0, now - anchor.at) / 1000 : 0);
}
