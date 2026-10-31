const HOLD_MS = 10_000;
const CAUGHT_UP_S = 3;

// After a seek the TV keeps reporting the old position until it has re-buffered at the
// new one; showing those reports makes the thumb jump back, then forward again. This
// shows the seek target instead, until a report lands near it (or the TV never gets
// there: then the reports win after HOLD_MS). Shared by the window and the phone.
export class SeekHold {
  private pending?: { target: number; until: number };

  hold(target: number): void {
    this.pending = { target, until: Date.now() + HOLD_MS };
  }

  // The position to show for a reported one.
  shown(reported: number): number {
    const pending = this.pending;
    if (!pending) return reported;
    if (Math.abs(reported - pending.target) < CAUGHT_UP_S || Date.now() > pending.until) {
      this.pending = undefined;
      return reported;
    }
    return pending.target;
  }
}
