/**
 * Live AudioParam updates without zipper noise.
 */
import { cancelAndHold } from './envelopes.js';

export function smoothSet(audioContext, param, value, timeConstant = 0.02) {
  const now = audioContext.currentTime;
  cancelAndHold(param, now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, timeConstant);
}
