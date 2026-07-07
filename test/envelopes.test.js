import { describe, it, expect } from 'vitest';
import { EnvelopeTracker, scheduleAttackSustain, scheduleADS } from '../src/engine/envelopes.js';

// Fake AudioParam that records scheduled events
function fakeParam(initial = 0) {
  const events = [];
  return {
    value: initial,
    events,
    setValueAtTime: (v, t) => events.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => events.push(['ramp', v, t]),
    cancelScheduledValues: (t) => events.push(['cancel', t]),
  };
}

describe('EnvelopeTracker.valueAt', () => {
  it('interpolates linearly inside a ramp', () => {
    const tracker = new EnvelopeTracker(fakeParam());
    tracker.setValueAt(0, 0);
    tracker.rampTo(1, 1);
    expect(tracker.valueAt(0)).toBe(0);
    expect(tracker.valueAt(0.5)).toBeCloseTo(0.5);
    expect(tracker.valueAt(1)).toBe(1);
    expect(tracker.valueAt(2)).toBe(1); // holds after the last point
  });

  it('models A-D-S shapes exactly', () => {
    const tracker = new EnvelopeTracker(fakeParam());
    scheduleADS(tracker, { attack: 0.1, decay: 0.1, sustain: 0.5 }, 0);
    expect(tracker.valueAt(0.05)).toBeCloseTo(0.5); // mid-attack toward peak 1
    expect(tracker.valueAt(0.1)).toBeCloseTo(1);    // attack peak
    expect(tracker.valueAt(0.15)).toBeCloseTo(0.75); // mid-decay
    expect(tracker.valueAt(0.5)).toBeCloseTo(0.5);  // sustain
  });

  it('steps hold the previous value up to the step time', () => {
    const tracker = new EnvelopeTracker(fakeParam());
    tracker.setValueAt(1, 0);
    tracker.setValueAt(0.2, 2);
    expect(tracker.valueAt(1.999)).toBeCloseTo(1);
    expect(tracker.valueAt(2.001)).toBeCloseTo(0.2);
  });
});

describe('EnvelopeTracker.release', () => {
  it('anchors the release at the computed value, not a stale one', () => {
    const param = fakeParam();
    const tracker = new EnvelopeTracker(param);
    scheduleAttackSustain(tracker, { attack: 1, sustain: 0.8 }, 0);

    // Release mid-attack: the held value must be the mid-ramp value
    tracker.release(0.5, 0.25);
    const held = param.events.find(([kind, , t]) => kind === 'set' && t === 0.5);
    expect(held).toBeDefined();
    expect(held[1]).toBeCloseTo(0.4); // 0.8 * (0.5/1.0)
    expect(tracker.valueAt(0.5)).toBeCloseTo(0.4);
    expect(tracker.valueAt(0.75)).toBeCloseTo(0);
  });

  it('returns the silence time', () => {
    const tracker = new EnvelopeTracker(fakeParam());
    scheduleAttackSustain(tracker, { attack: 0.01, sustain: 1 }, 0);
    expect(tracker.release(1, 0.5)).toBeCloseTo(1.5);
  });

  it('release after the envelope completed holds the sustain value', () => {
    const tracker = new EnvelopeTracker(fakeParam());
    scheduleAttackSustain(tracker, { attack: 0.1, sustain: 0.3 }, 0);
    tracker.release(5, 0.5);
    expect(tracker.valueAt(5)).toBeCloseTo(0.3);
    expect(tracker.valueAt(5.25)).toBeCloseTo(0.15);
  });
});
