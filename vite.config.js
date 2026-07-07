import { defineConfig } from 'vite';
import { claudeLivePlugin } from './claude-live-plugin.js';

export default defineConfig({
  // Relative base so the build works on GitHub Pages project sites
  // and when opened from any subpath
  base: './',
  plugins: [claudeLivePlugin()],
});
