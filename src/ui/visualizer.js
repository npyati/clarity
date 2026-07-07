/**
 * ============================================================================
 * REAL-TIME AUDIO VISUALIZER
 * ============================================================================
 *
 * Top half: trigger-synced oscilloscope (locks onto a rising zero-crossing
 * so periodic waveforms hold still). Bottom half: log-frequency spectrum —
 * the axis labels are placed by the same mapping that places the bars, so
 * they are correct by construction.
 */
import { visualizerPalette, onThemeChange } from './theme.js';

const SPECTRUM_MIN_HZ = 30;
const SPECTRUM_MAX_HZ = 12000;
const FREQ_MARKERS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

class WaveformVisualizer {
  constructor(canvasId, containerId, audioContextGetter) {
    this.canvas = document.getElementById(canvasId);
    this.container = document.getElementById(containerId);
    this.ctx = this.canvas.getContext('2d');
    this.getAudioContext = audioContextGetter;

    // Animation
    this.animationId = null;
    this.isAnimating = false;

    // Audio analysis
    this.analyser = null;
    this.dataArray = null;
    this.bufferLength = null;
    this.isConnected = false;

    // Colors come from the design tokens (single source of truth) and
    // refresh when the OS theme flips
    this.colors = visualizerPalette();
    onThemeChange(() => {
      this.colors = visualizerPalette();
    });

    // Initialize canvas size
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  /**
   * Resize canvas to match display size
   */
  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.canvasWidth = rect.width;
    this.canvasHeight = rect.height;
  }

  /**
   * Initialize audio analyzer connected to master output
   */
  initializeAnalyser() {
    if (this.analyser) return; // Already initialized

    const audioContext = this.getAudioContext();
    if (!audioContext) {
      console.warn('[Visualizer] No audio context available');
      return;
    }

    // Create analyser node
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3; // Reduced for faster response
    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
    this.frequencyData = new Uint8Array(this.bufferLength);
    this.sampleRate = audioContext.sampleRate;
  }

  /**
   * Log-frequency x position (0..1) for a frequency in Hz — the ONE
   * mapping used by both the spectrum bars and the axis labels
   */
  _freqToX(freq) {
    return Math.log(freq / SPECTRUM_MIN_HZ) / Math.log(this._maxFreq() / SPECTRUM_MIN_HZ);
  }

  _xToFreq(x) {
    return SPECTRUM_MIN_HZ * Math.pow(this._maxFreq() / SPECTRUM_MIN_HZ, x);
  }

  _maxFreq() {
    const nyquist = (this.sampleRate || 48000) / 2;
    return Math.min(SPECTRUM_MAX_HZ, nyquist);
  }

  /**
   * Connect analyser to a node (should be called from audio engine)
   */
  connectAnalyser(sourceNode) {
    if (!this.analyser) {
      this.initializeAnalyser();
    }

    if (this.analyser && sourceNode) {
      sourceNode.connect(this.analyser);
      console.log('[Visualizer] Analyser connected to audio output');
    }
  }

  /**
   * Show the visualizer and start animation
   */
  show() {
    this.container.classList.remove('hidden');
    this.resizeCanvas();
    this.start();
  }

  /**
   * Hide the visualizer and stop animation
   */
  hide() {
    this.container.classList.add('hidden');
    this.stop();
  }

  /**
   * Ensure analyser is connected to audio engine (safe to call multiple times)
   */
  ensureConnected() {
    if (!this.analyser) {
      this.initializeAnalyser();
    }

    // Only connect if we have an analyser, audio engine is ready, and context is running
    if (this.analyser && window.audioEngine && window.audioEngine.masterGain) {
      const audioContext = window.audioEngine.audioContext;

      // Only connect when context is running (not suspended)
      if (audioContext.state === 'running') {
        // Check if already connected by testing if analyser has any connections
        // We'll use a flag to track connection state
        if (!this.isConnected) {
          const masterGain = window.audioEngine.masterGain;
          masterGain.connect(this.analyser);
          this.isConnected = true;
          console.log('[Visualizer] Connected to audio engine');
        }
      }
    }
  }

  /**
   * Start real-time visualization
   */
  start() {
    if (this.isAnimating) return;

    // Initialize analyser (but don't connect yet - wait for audio context to be running)
    if (!this.analyser) {
      this.initializeAnalyser();
    }

    if (!this.analyser) {
      console.warn('[Visualizer] Cannot start - no analyser available');
      return;
    }

    this.isAnimating = true;
    this.animate();
  }

  /**
   * Stop visualization
   */
  stop() {
    this.isAnimating = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Animation loop - draws real-time waveform and spectrum
   */
  animate() {
    if (!this.isAnimating) return;

    this.animationId = requestAnimationFrame(() => this.animate());

    // Get both waveform and frequency data
    this.analyser.getByteTimeDomainData(this.dataArray);
    this.analyser.getByteFrequencyData(this.frequencyData);

    // Clear canvas
    this.ctx.fillStyle = this.colors.background;
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Draw grid
    this.drawGrid();

    // Draw section labels
    this.drawLabels();

    // Draw waveform on top half
    this.drawWaveform();

    // Draw frequency spectrum on bottom half
    this.drawSpectrum();
  }

  /**
   * Draw background grid
   */
  drawGrid() {
    const { ctx, canvasWidth, canvasHeight, colors } = this;

    // Divider between waveform and spectrum
    ctx.strokeStyle = colors.centerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, canvasHeight / 2);
    ctx.lineTo(canvasWidth, canvasHeight / 2);
    ctx.stroke();

    // Waveform half: time divisions
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5;
    const verticalDivisions = 8;
    for (let i = 1; i < verticalDivisions; i++) {
      const x = (canvasWidth / verticalDivisions) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight / 2);
      ctx.stroke();
    }

    // Spectrum half: gridlines at the frequency markers (log axis)
    for (const freq of FREQ_MARKERS) {
      const fx = this._freqToX(freq);
      if (fx <= 0 || fx >= 1) continue;
      const x = fx * canvasWidth;
      ctx.beginPath();
      ctx.moveTo(x, canvasHeight / 2);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }
  }

  /**
   * Draw section labels + frequency axis
   */
  drawLabels() {
    const { ctx, canvasWidth, canvasHeight, colors } = this;

    ctx.fillStyle = colors.label;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';

    ctx.fillText('WAVEFORM', 8, 15);
    ctx.fillText('SPECTRUM', 8, canvasHeight / 2 + 15);

    // Frequency labels sit exactly on the log-axis gridlines
    const markerY = canvasHeight - 5;
    ctx.textAlign = 'center';
    for (const freq of FREQ_MARKERS) {
      const fx = this._freqToX(freq);
      if (fx <= 0.02 || fx >= 0.98) continue;
      const text = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      ctx.fillText(text, fx * canvasWidth, markerY);
    }
  }

  /**
   * Find a stable start index: first rising crossing of the midpoint in
   * the first half of the buffer. Locks periodic waveforms in place.
   */
  _triggerIndex() {
    const { dataArray, bufferLength } = this;
    const half = Math.floor(bufferLength / 2);
    for (let i = 1; i < half; i++) {
      if (dataArray[i - 1] < 128 && dataArray[i] >= 128) {
        return i;
      }
    }
    return 0; // no crossing (silence/DC) — draw from the start
  }

  /**
   * Draw trigger-synced waveform (top half)
   */
  drawWaveform() {
    const { ctx, canvasWidth, canvasHeight, colors, dataArray, bufferLength } = this;

    const waveformHeight = canvasHeight / 2;
    const start = this._triggerIndex();
    const windowLength = Math.floor(bufferLength / 2);

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colors.waveform;
    ctx.shadowColor = colors.waveform;
    ctx.shadowBlur = 6;
    ctx.beginPath();

    const sliceWidth = canvasWidth / windowLength;
    for (let i = 0; i < windowLength; i++) {
      const v = dataArray[start + i] / 128.0; // Normalize to 0-2
      const y = (v * waveformHeight) / 2;
      if (i === 0) {
        ctx.moveTo(0, y);
      } else {
        ctx.lineTo(i * sliceWidth, y);
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw log-frequency spectrum (bottom half)
   */
  drawSpectrum() {
    const { ctx, canvasWidth, canvasHeight, colors, frequencyData, bufferLength } = this;

    const spectrumHeight = canvasHeight / 2;
    const spectrumTop = canvasHeight / 2;
    const nyquist = (this.sampleRate || 48000) / 2;
    const binWidthHz = nyquist / bufferLength;

    // One vertical gradient for all bars: accent fading down
    const gradient = ctx.createLinearGradient(0, spectrumTop, 0, canvasHeight);
    gradient.addColorStop(0, colors.spectrum);
    gradient.addColorStop(1, colors.grid);
    ctx.fillStyle = gradient;

    // Walk pixel columns; each column covers a log-frequency span and
    // shows the loudest bin inside it
    const step = 2;
    for (let px = 0; px < canvasWidth; px += step) {
      const f0 = this._xToFreq(px / canvasWidth);
      const f1 = this._xToFreq(Math.min(1, (px + step) / canvasWidth));
      const bin0 = Math.max(0, Math.floor(f0 / binWidthHz));
      const bin1 = Math.min(bufferLength - 1, Math.max(bin0, Math.ceil(f1 / binWidthHz)));

      let peak = 0;
      for (let b = bin0; b <= bin1; b++) {
        if (frequencyData[b] > peak) peak = frequencyData[b];
      }

      const barHeight = (peak / 255) * (spectrumHeight - 18);
      if (barHeight > 0.5) {
        ctx.fillRect(px, spectrumTop + (spectrumHeight - barHeight), step - 0.5, barHeight);
      }
    }
  }
}

// Global visualizer instance (will be initialized after page load)
let waveformVisualizer = null;

function initializeVisualizer() {
  // Pass a function to get the audio context from the audio engine
  const getAudioContext = () => {
    return window.audioEngine ? window.audioEngine.audioContext : null;
  };

  waveformVisualizer = new WaveformVisualizer('waveform-canvas', 'waveform-container', getAudioContext);

  // Show it immediately and start visualizing
  waveformVisualizer.show();

  console.log('Waveform visualizer initialized');
}

export { WaveformVisualizer, waveformVisualizer, initializeVisualizer };
