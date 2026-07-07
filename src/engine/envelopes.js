/**
 * Envelope scheduling primitives.
 *
 * Every scheduled ramp is recorded as (time, value) breakpoints in an
 * EnvelopeTracker, so the exact envelope value at any timestamp can be
 * computed analytically. Releases anchor an explicit event at the release
 * time from the *computed* value:
 *  - never read param.value for automation (stale mid-ramp in some engines)
 *  - linearRampToValueAtTime ramps from the previous event, so without an
 *    anchor a release would jump to a mid-interpolated value (audible click)
 *  - works for future timestamps (time-addressable), which
 *    cancelAndHoldAtTime alone cannot anchor and Firefox lacks entirely
 */

export function cancelAndHold(param, time) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(time);
  } else {
    param.cancelScheduledValues(time);
  }
}

export class EnvelopeTracker {
  constructor(param) {
    this.param = param;
    this.points = []; // [{t, v}] sorted by t; linear segments between
  }

  setValueAt(v, t) {
    this.param.setValueAtTime(v, t);
    this._record(t, v, true);
  }

  rampTo(v, t) {
    this.param.linearRampToValueAtTime(v, t);
    this._record(t, v, false);
  }

  _record(t, v, isStep) {
    // Drop any points at/after t (they're being rescheduled)
    while (this.points.length && this.points[this.points.length - 1].t >= t) {
      this.points.pop();
    }
    if (isStep && this.points.length) {
      // A step holds the previous value right up to t
      const prev = this.points[this.points.length - 1];
      this.points.push({ t, v: prev.v });
    }
    this.points.push({ t, v });
  }

  valueAt(t) {
    const pts = this.points;
    if (pts.length === 0) return this.param.value;
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) {
        const a = pts[i - 1];
        const b = pts[i];
        if (b.t === a.t) return b.v;
        const frac = (t - a.t) / (b.t - a.t);
        return a.v + (b.v - a.v) * frac;
      }
    }
    return pts[pts.length - 1].v;
  }

  /**
   * Truncate the envelope at `t` (hold the computed value) — the anchor
   * for a following release ramp.
   */
  holdAt(t) {
    const v = this.valueAt(t);
    cancelAndHold(this.param, t);
    this.param.setValueAtTime(v, t);
    while (this.points.length && this.points[this.points.length - 1].t > t) {
      this.points.pop();
    }
    this.points.push({ t, v });
    return v;
  }

  /**
   * Hold at `when`, then ramp to zero over `releaseTime` seconds.
   * Returns the time the envelope reaches silence.
   */
  release(when, releaseTime) {
    this.holdAt(when);
    const end = when + Math.max(0.003, releaseTime);
    this.rampTo(0, end);
    return end;
  }
}

/**
 * Attack -> sustain (no decay stage; peak == sustain, per-osc level shape)
 */
export function scheduleAttackSustain(tracker, { attack, sustain }, when) {
  tracker.setValueAt(0, when);
  tracker.rampTo(sustain, when + Math.max(0.003, attack));
}

/**
 * Attack -> decay -> sustain (normalized voice shape)
 */
export function scheduleADS(tracker, { attack, decay, sustain, peak = 1 }, when) {
  tracker.setValueAt(0, when);
  const attackEnd = when + Math.max(0.003, attack);
  tracker.rampTo(peak, attackEnd);
  tracker.rampTo(sustain, attackEnd + Math.max(0.003, decay));
}
