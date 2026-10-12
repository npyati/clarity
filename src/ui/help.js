/**
 * Help / readme — what Clarity is and how to drive it. Opened from the
 * command palette ("Help") or by clicking the clarity.instrument header.
 * Syntax details live in the schema-generated cheatsheet; this links to it
 * rather than duplicating it.
 */
import { toggleCheatsheet } from './cheatsheet.js';

const REPO_URL = 'https://github.com/npyati/clarity';

// Shared with the Claude panel's hosted-site explainer
export const LOCAL_SETUP_HTML = `
  <ol class="help-steps">
    <li>Install <a href="https://claude.com/claude-code" target="_blank" rel="noopener">Claude Code</a> and sign in once by running <code>claude</code> in a terminal.</li>
    <li>Get Clarity and start it:
      <pre>git clone ${REPO_URL}
cd clarity
npm install
npm run dev</pre>
    </li>
    <li>Open the address it prints (usually <code>localhost:5173</code>). The Claude button is live there.</li>
  </ol>`;

const SHORTCUTS = [
  ['/', 'command palette, on an empty line'],
  ['⌘P', 'command palette, anywhere'],
  ['⌘↑ ⌘↓', 'nudge the number under the cursor (add ⇧ for ×10)'],
  ['⌘K', 'focus the playing keyboard'],
  ['⌘= ⌘−', 'text size'],
  ['⌘] ⌘[', 'line spacing'],
  ['⌘/', 'comment out a line'],
  ['⌘J', 'Claude panel (when running locally)'],
  ['Esc', 'close this'],
];

function content() {
  return `
    <p class="help-lede">Clarity is a synthesizer you write. The document on the left <em>is</em> the instrument:
    every line becomes sound, and the panel in the middle is generated from the text.</p>

    <h3>how it works</h3>
    <p>Declare components (<code>oscillator</code>, <code>lfo</code>, <code>filter</code>, <code>envelope</code>, effects…)
    and indent their attributes under them. Edits are heard immediately. The middle panel shows sliders for whatever
    your cursor is on; moving a slider rewrites the number in the text, so the document stays the single source of truth.</p>
    <p>Wire things together by name: <code>modulation vibrato</code> under an attribute modulates it,
    <code>variable</code>s can be shared and given ranges, and attributes accept math like <code>vibrato_rate * 2</code>.</p>
    <p><button class="help-link" data-action="syntax">Open the syntax reference →</button></p>

    <h3>playing</h3>
    <p>Click the keyboard on the right (or press ⌘K), then play your computer keyboard: four rows,
    chromatic from C3, from <kbd>Z</kbd> up to <kbd>0</kbd>. Keys can carry their own settings with a <code>key</code> scope.
    A MIDI keyboard works too, and MIDI CC can drive any variable that has a range.</p>

    <h3>shortcuts</h3>
    <div class="help-keys">
      ${SHORTCUTS.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}
    </div>

    <h3>keeping & sharing</h3>
    <p>Your document saves in this browser automatically. From the palette: <em>Copy Share Link</em> puts the whole
    instrument in a URL, <em>Start Recording</em> captures the output as audio, and <em>Reset to Seed Document</em>
    brings back the example.</p>

    <h3>claude</h3>
    <p>When Clarity runs on your own computer, the Claude button opens a chat with Claude Code that edits the
    instrument live: ask for "a warmer pad" or "add a slow filter sweep" and watch the text and sound change.
    Each tab is its own conversation. On the web version the button explains this instead, because the hosted
    site has no way to reach Claude Code on your machine.</p>
    ${LOCAL_SETUP_HTML}

    <p class="help-foot">Built in 2026 by Nick Pyati · <a href="${REPO_URL}" target="_blank" rel="noopener">source</a></p>`;
}

let dialog = null;

function onKey(e) {
  if (e.key === 'Escape') closeHelp();
}

export function closeHelp() {
  if (!dialog) return;
  dialog.remove();
  dialog = null;
  document.removeEventListener('keydown', onKey);
}

export function toggleHelp() {
  if (dialog) {
    closeHelp();
    return;
  }

  dialog = document.createElement('div');
  dialog.id = 'help';
  dialog.className = 'overlay-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'About Clarity');
  dialog.innerHTML = `
    <div class="cheat-header">clarity<button class="cheat-close" aria-label="Close help">✕</button></div>
    <div class="cheat-body help-body">${content()}</div>`;

  dialog.querySelector('.cheat-close').addEventListener('click', closeHelp);
  dialog.querySelector('[data-action="syntax"]').addEventListener('click', () => {
    closeHelp();
    toggleCheatsheet();
  });

  document.body.appendChild(dialog);
  document.addEventListener('keydown', onKey);
}
