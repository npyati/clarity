import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Transport } from '../src/engine/transport.js';

describe('Transport', () => {
  let ctx;
  let transport;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = { currentTime: 0 };
    transport = new Transport(ctx, { lookahead: 0.1, tickMs: 25 });
  });

  afterEach(() => {
    transport.stop();
    vi.useRealTimers();
  });

  it('fires callbacks only when they enter the lookahead window', () => {
    const fired = [];
    transport.schedule(0.5, (when) => fired.push(when));
    transport.schedule(0.05, (when) => fired.push(when));
    transport.start();

    vi.advanceTimersByTime(30); // one tick at currentTime 0, horizon 0.1
    expect(fired).toEqual([0.05]);

    ctx.currentTime = 0.45; // 0.5 now inside horizon 0.55
    vi.advanceTimersByTime(30);
    expect(fired).toEqual([0.05, 0.5]);
  });

  it('fires events in time order regardless of scheduling order', () => {
    const fired = [];
    transport.schedule(0.03, () => fired.push('b'));
    transport.schedule(0.01, () => fired.push('a'));
    transport.schedule(0.05, () => fired.push('c'));
    transport.start();
    vi.advanceTimersByTime(30);
    expect(fired).toEqual(['a', 'b', 'c']);
  });

  it('cancel removes a pending event', () => {
    const fired = [];
    const ev = transport.schedule(0.02, () => fired.push('x'));
    transport.cancel(ev);
    transport.start();
    vi.advanceTimersByTime(60);
    expect(fired).toEqual([]);
  });

  it('a throwing callback does not break the queue', () => {
    const fired = [];
    transport.schedule(0.01, () => { throw new Error('boom'); });
    transport.schedule(0.02, () => fired.push('ok'));
    transport.start();
    vi.advanceTimersByTime(30);
    expect(fired).toEqual(['ok']);
  });
});
