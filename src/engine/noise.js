/**
 * One shared smooth-noise buffer per AudioContext. The buffer wiggles at
 * NOISE_BASE_RATE Hz so playbackRate maps 1:1 to the requested rate.
 */
export const NOISE_BASE_RATE = 1;

const buffers = new WeakMap();

export function getSharedNoiseBuffer(audioContext) {
  let buffer = buffers.get(audioContext);
  if (buffer) return buffer;

  const duration = 10;
  const sampleRate = audioContext.sampleRate;
  const size = duration * sampleRate;
  buffer = audioContext.createBuffer(1, size, sampleRate);
  const data = buffer.getChannelData(0);

  // Smooth random walk: interpolated control points, 4 per base-rate cycle
  const interval = Math.floor(sampleRate / (NOISE_BASE_RATE * 4));
  let last = Math.random() * 2 - 1;
  let next = Math.random() * 2 - 1;
  let cp = 0;
  for (let i = 0; i < size; i++) {
    if (i >= (cp + 1) * interval) {
      cp++;
      last = next;
      next = Math.random() * 2 - 1;
    }
    const t = (i - cp * interval) / interval;
    const smoothT = t * t * (3 - 2 * t);
    data[i] = last + (next - last) * smoothT;
  }

  buffers.set(audioContext, buffer);
  return buffer;
}
