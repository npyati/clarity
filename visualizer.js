/**
 * ============================================================================
 * REAL-TIME AUDIO VISUALIZER
 * ============================================================================
 *
 * Displays real-time audio output waveform from the synthesizer
 */

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

    // Colors (matching UI theme)
    this.colors = {
      background: '#282a2e',
      grid: '#373b41',
      waveform: '#5fd3bc',
      spectrum: '#81a2be',
      centerLine: '#969896',
      label: '#c5c8c6'
    };

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

    // Horizontal center line
    ctx.strokeStyle = colors.centerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, canvasHeight / 2);
    ctx.lineTo(canvasWidth, canvasHeight / 2);
    ctx.stroke();

    // Vertical grid lines
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5;
    const verticalDivisions = 8;
    for (let i = 1; i < verticalDivisions; i++) {
      const x = (canvasWidth / verticalDivisions) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }
  }

  /**
   * Draw section labels
   */
  drawLabels() {
    const { ctx, canvasWidth, canvasHeight, colors } = this;

    ctx.fillStyle = colors.label;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';

    // Waveform label
    ctx.fillText('WAVEFORM', 8, 15);

    // Spectrum label
    ctx.fillText('SPECTRUM', 8, canvasHeight / 2 + 15);

    // Frequency markers for spectrum
    const spectrumTop = canvasHeight / 2;
    const markerY = canvasHeight - 5;

    ctx.textAlign = 'center';
    ctx.fillText('20Hz', canvasWidth * 0.02, markerY);
    ctx.fillText('100Hz', canvasWidth * 0.15, markerY);
    ctx.fillText('500Hz', canvasWidth * 0.4, markerY);
    ctx.fillText('1kHz', canvasWidth * 0.6, markerY);
    ctx.fillText('5kHz', canvasWidth * 0.85, markerY);
  }

  /**
   * Draw real-time waveform from audio data (top half)
   */
  drawWaveform() {
    const { ctx, canvasWidth, canvasHeight, colors, dataArray, bufferLength } = this;

    const waveformHeight = canvasHeight / 2;
    const centerY = waveformHeight / 2;

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colors.waveform;
    ctx.beginPath();

    const sliceWidth = canvasWidth / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0; // Normalize to 0-2
      const y = (v * waveformHeight) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(canvasWidth, centerY);
    ctx.stroke();
  }

  /**
   * Draw frequency spectrum (bottom half)
   */
  drawSpectrum() {
    const { ctx, canvasWidth, canvasHeight, colors, frequencyData, bufferLength } = this;

    const spectrumHeight = canvasHeight / 2;
    const spectrumTop = canvasHeight / 2;

    // Only show lower frequencies (more musically relevant)
    const maxFreqBin = Math.floor(bufferLength / 4);
    const barWidth = canvasWidth / maxFreqBin;

    for (let i = 0; i < maxFreqBin; i++) {
      const barHeight = (frequencyData[i] / 255.0) * spectrumHeight;

      // Brighter color gradient from cyan to blue based on frequency
      const hue = 180 + (i / maxFreqBin) * 30; // 180 (cyan) to 210 (blue)
      const saturation = 70;
      const lightness = 55 + (barHeight / spectrumHeight) * 20; // Brighter when louder
      ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

      const x = i * barWidth;
      const y = spectrumTop + (spectrumHeight - barHeight);

      // Draw bars with minimal gap for better visibility
      ctx.fillRect(x, y, barWidth - 0.5, barHeight);
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
