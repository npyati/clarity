/**
 * Transport — lookahead scheduler seam ("A Tale of Two Clocks").
 *
 * Implemented and tested now, wired to nothing: Level-4 sequencing drives
 * the engine's time-addressable API (`when` timestamps) through this
 * without any engine changes. Quantized edit application is
 * transport.schedule(nextBarTime, () => engine.applySnapshot(...)).
 */
export class Transport {
  constructor(audioContext, { lookahead = 0.1, tickMs = 25 } = {}) {
    this.audioContext = audioContext;
    this.lookahead = lookahead;
    this.tickMs = tickMs;
    this.queue = []; // [{ when, fn }] kept sorted by when
    this._timer = null;
  }

  get now() {
    return this.audioContext.currentTime;
  }

  get running() {
    return this._timer !== null;
  }

  start() {
    if (this._timer !== null) return;
    this._timer = setInterval(() => this._tick(), this.tickMs);
  }

  stop() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Schedule fn to be invoked (with the exact timestamp) once `when`
   * enters the lookahead window. fn should schedule audio AT `when`.
   */
  schedule(when, fn) {
    const event = { when, fn };
    // Insertion sort keeps the queue ordered (queues are short)
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].when > when) i--;
    this.queue.splice(i, 0, event);
    return event;
  }

  cancel(event) {
    const i = this.queue.indexOf(event);
    if (i >= 0) this.queue.splice(i, 1);
  }

  clear() {
    this.queue = [];
  }

  _tick() {
    const horizon = this.audioContext.currentTime + this.lookahead;
    while (this.queue.length && this.queue[0].when < horizon) {
      const { when, fn } = this.queue.shift();
      try {
        fn(when);
      } catch (e) {
        console.error('Transport callback failed:', e);
      }
    }
  }
}
