/**
 * Claude panel — chat with the local Claude Code CLI about the live
 * document. Each send POSTs to the dev server's /api/claude/chat, which
 * runs `claude -p` headless over a sandboxed mirror of the document and
 * streams stream-json back as NDJSON; {type:'doc_update'} events carry
 * file edits into the editor mid-turn. Multi-turn context lives in the
 * CLI's own session store (session_id round-trips via --resume).
 *
 * TABS: every tab is its own CLI session with its own model and
 * transcript, and each streams independently — a turn keeps running in a
 * background tab while another is in use. A blinking swatch marks a
 * streaming tab; a still one marks a tab that finished off-screen.
 *
 * ⌘J toggles the panel from anywhere; ⌘⇧K starts a fresh conversation in
 * the current tab. Screenshots pasted into the panel ride along with the
 * next message from that tab.
 *
 * Dev-server only: probes /api/claude/ping and stays hidden without it.
 * Chats live in this browser's localStorage; pasted images live in the
 * OS temp dir — neither is ever inside the repo.
 */
import { syntaxMarkdown } from './cheatsheet.js';

const CHAT_KEY = 'clarity.claude-chats';
const CHAT_MODELS = [['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']];
const QUICK_PROMPTS = [
  ['explain', 'Explain how this instrument works, in a few lines.'],
  ['variation', 'Make a variation of this sound — change its character, keep its structure.'],
  ['surprise me', 'Surprise me: add one interesting new idea to this instrument.'],
];

// The Claude starburst mark (via Simple Icons), colored through currentColor
const CLAUDE_LOGO = '<svg class="claude-mark" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>';

function chatBlank(model) {
  return {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    model: model || 'sonnet', sessionId: null, messages: [], unread: false,
  };
}

let state = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_KEY));
    if (saved && Array.isArray(saved.chats) && saved.chats.length) return saved;
  } catch (e) { /* fresh state */ }
  try { // migrate the single-chat store so the running conversation survives
    const v1 = JSON.parse(localStorage.getItem('clarity.claude-chat'));
    if (v1 && Array.isArray(v1.messages)) {
      const first = Object.assign(chatBlank(v1.model), { sessionId: v1.sessionId, messages: v1.messages });
      return { open: !!v1.open, pos: v1.pos || null, size: v1.size || null, activeId: first.id, chats: [first] };
    }
  } catch (e) { /* fresh state */ }
  const first = chatBlank();
  return { open: false, pos: null, size: null, activeId: first.id, chats: [first] };
})();

const runs = new Map();     // chat id -> AbortController while streaming
const pendingMap = new Map(); // chat id -> [{url, path}] uploaded, unsent
let attachErr = null;
let hooks = { getDoc: () => '', setDoc: () => {} };

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function activeChat() {
  return state.chats.find(c => c.id === state.activeId) || state.chats[0];
}

function save() {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify({
      open: state.open, pos: state.pos, size: state.size, activeId: state.activeId,
      chats: state.chats.map(c => ({
        id: c.id, model: c.model, sessionId: c.sessionId, unread: c.unread,
        messages: c.messages.slice(-100),
      })),
    }));
    localStorage.removeItem('clarity.claude-chat');
  } catch (e) { /* best-effort */ }
}

// A tab names itself after its first message, so the strip reads as topics
function tabName(c) {
  const first = c.messages.find(m => m.role === 'user');
  const text = first && (first.parts.find(p => p.t === 'text') || {}).text;
  return text ? (text.length > 20 ? text.slice(0, 20) + '…' : text) : 'new chat';
}

// ── Movable + resizable ─────────────────────────────────────────────────
// Drag by the header; resize via the native CSS handle (bottom-right).
// Position/size persist. Double-click the header to snap back home.

function panelEl() {
  return document.getElementById('claude-panel');
}

function clampPos(x, y, panel) {
  const rect = panel.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(window.innerWidth - rect.width, x)),
    y: Math.max(0, Math.min(window.innerHeight - 40, y)), // header stays reachable
  };
}

function applyLayout() {
  const panel = panelEl();
  if (!panel) return;
  if (state.size) {
    panel.style.width = state.size.w + 'px';
    panel.style.height = state.size.h + 'px';
  }
  if (state.pos) {
    panel.style.left = state.pos.x + 'px';
    panel.style.top = state.pos.y + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }
}

// The panel is CSS-anchored bottom-right; pin it to explicit left/top once
// so dragging and the native resize handle both behave predictably
function pinToPixels() {
  const panel = panelEl();
  if (!panel || state.pos) return;
  const rect = panel.getBoundingClientRect();
  state.pos = { x: rect.left, y: rect.top };
  applyLayout();
}

function resetLayout() {
  state.pos = null;
  state.size = null;
  const panel = panelEl();
  if (panel) {
    panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
    panel.style.width = panel.style.height = '';
  }
  save();
}

function initMoveResize() {
  const panel = panelEl();
  const head = panel.querySelector('.claude-head');

  let drag = null; // { dx, dy }
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, select')) return;
    pinToPixels();
    const rect = panel.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    try { head.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    head.classList.add('dragging');
    e.preventDefault();
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.pos = clampPos(e.clientX - drag.dx, e.clientY - drag.dy, panel);
    applyLayout();
  });
  const endDrag = (e) => {
    if (!drag) return;
    drag = null;
    head.classList.remove('dragging');
    if (head.hasPointerCapture?.(e.pointerId)) head.releasePointerCapture(e.pointerId);
    save();
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);
  head.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, select')) return;
    resetLayout();
  });

  // Native CSS resize handle -> persist the chosen size
  let resizeTimer = null;
  new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (!state.open || width < 10 || height < 10) continue; // closed (display:none)
      if (state.size && Math.abs(state.size.w - width) < 2 && Math.abs(state.size.h - height) < 2) continue;
      pinToPixels(); // resizing while corner-anchored would fight the handle
      state.size = { w: Math.round(width), h: Math.round(height) };
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(save, 300);
    }
  }).observe(panel);

  // Keep the panel reachable when the window shrinks
  window.addEventListener('resize', () => {
    if (!state.pos) return;
    state.pos = clampPos(state.pos.x, state.pos.y, panel);
    applyLayout();
  });

  applyLayout();
}

// ── Tabs ────────────────────────────────────────────────────────────────

function renderTabs() {
  const strip = document.getElementById('claude-tabs');
  if (!strip) return;
  const closable = state.chats.length > 1;
  strip.innerHTML = state.chats.map(c => {
    const cls = ['claude-tab',
      c.id === state.activeId ? 'active' : '',
      runs.has(c.id) ? 'running' : '',
      c.unread ? 'unread' : ''].filter(Boolean).join(' ');
    return `<span class="${cls}" data-id="${c.id}" title="${esc(tabName(c))}">` +
      `<span class="claude-tab-dot"></span><span class="claude-tab-name">${esc(tabName(c))}</span>` +
      (closable ? `<button class="claude-tab-x" data-close="${c.id}" title="Close chat">×</button>` : '') +
      `</span>`;
  }).join('') +
    `<button class="claude-tab-add" title="New chat (runs in parallel)">+</button>`;
}

function activate(id) {
  if (!state.chats.some(c => c.id === id)) return;
  state.activeId = id;
  const c = activeChat();
  c.unread = false;
  const sel = document.getElementById('claude-model');
  if (sel) sel.value = c.model;
  attachErr = null;
  save();
  render();
  renderAttach();
}

function newTab() {
  const c = chatBlank(activeChat().model); // inherit the model in use
  state.chats.push(c);
  activate(c.id);
  document.getElementById('claude-input')?.focus();
  return c;
}

// Closing a tab kills its stream — the × is the stop for a runaway turn
function closeTab(id) {
  runs.get(id)?.abort();
  const idx = state.chats.findIndex(c => c.id === id);
  if (idx < 0) return;
  state.chats.splice(idx, 1);
  pendingMap.delete(id);
  if (!state.chats.length) state.chats.push(chatBlank());
  if (state.activeId === id) activate(state.chats[Math.max(0, idx - 1)].id);
  else { save(); renderTabs(); }
}

// ── Pasted images ───────────────────────────────────────────────────────
// Uploaded immediately to /api/claude/upload (stored in the OS temp dir);
// the saved path rides along with the next message from THIS tab.

function pending() {
  const id = activeChat().id;
  if (!pendingMap.has(id)) pendingMap.set(id, []);
  return pendingMap.get(id);
}

async function onPaste(e) {
  const items = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/'));
  if (!items.length) return;
  e.preventDefault();
  attachErr = null;
  const list = pending();
  for (const blob of items.map(i => i.getAsFile()).filter(Boolean)) {
    try {
      const resp = await fetch('/api/claude/upload', {
        method: 'POST', headers: { 'Content-Type': blob.type }, body: blob,
      });
      if (!resp.ok) throw new Error(await resp.text());
      list.push(await resp.json());
    } catch (err) {
      attachErr = 'upload failed: ' + err.message;
    }
    renderAttach();
  }
}

function renderAttach() {
  const box = document.getElementById('claude-attach');
  if (!box) return;
  const list = pending();
  box.innerHTML = list.map((a, i) =>
    `<span class="claude-att"><img src="${esc(a.url)}" alt=""><button data-remove="${i}" title="Remove">×</button></span>`
  ).join('') + (attachErr ? `<span class="claude-att-err">${esc(attachErr)}</span>` : '');
  box.classList.toggle('has-items', !!(list.length || attachErr));
}

// ── Transcript ──────────────────────────────────────────────────────────

// Minimal markdown: code fences, inline code, bold, italics
function md(text) {
  let h = esc(text);
  h = h.replace(/```([\s\S]*?)```/g, (_, c) => `<pre>${c.replace(/^\w*\n/, '')}</pre>`);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?]|$)/g, '$1<em>$2</em>');
  return h.replace(/\n/g, '<br>');
}

function toolLabel(name, input) {
  const file = input && input.file_path ? String(input.file_path).split('/').pop() : '';
  const icons = { Read: '→', Write: '✎', Edit: '✎' };
  return `${icons[name] || '·'} ${name}${file ? ' · ' + esc(file) : ''}`;
}

// Renders the ACTIVE tab's transcript (background tabs only repaint the strip)
function render() {
  renderTabs();
  const box = document.getElementById('claude-messages');
  if (!box) return;
  const c = activeChat();
  const running = runs.has(c.id);
  let html = c.messages.map(m => {
    if (m.role === 'user') {
      const inner = m.parts.map(p =>
        p.t === 'img' ? `<img class="claude-att-img" src="${esc(p.url)}" alt="pasted image">` : md(p.text)
      ).join('');
      return `<div class="claude-msg user">${inner}</div>`;
    }
    const inner = m.parts.map(p =>
      p.t === 'tool' ? `<div class="claude-tool">${p.label}</div>`
                     : `<div class="claude-text">${md(p.text)}</div>`
    ).join('');
    return `<div class="claude-msg assistant">${inner || (running ? '' : '<span class="claude-empty">(no reply)</span>')}</div>`;
  }).join('');
  if (!c.messages.length) {
    html = `<div class="claude-hello">Talks to Claude Code on this machine, editing your instrument live.<br><br>Try: "add a delay to the master", "make the lead brighter", "build me an evolving pad". Paste a screenshot to show it something.<br><br>+ opens another chat; each tab is its own Claude and they run at the same time.</div>`;
  }
  if (running) html += `<div class="claude-typing"><span></span></div>`;
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
  setRunning(running);
}

function setRunning(on) {
  const btn = document.getElementById('claude-send');
  if (btn) {
    btn.textContent = on ? '■' : '↑';
    btn.title = on ? 'Stop this chat' : 'Send';
  }
}

function toggle() {
  state.open = !state.open;
  panelEl().classList.toggle('open', state.open);
  const ta = document.getElementById('claude-input');
  if (state.open) {
    render();
    ta.focus();
  } else if (document.activeElement === ta) {
    ta.blur(); // typing goes back to the page
  }
  save();
}

// ⟳ / ⌘⇧K — fresh conversation in the CURRENT tab (other tabs keep running)
function reset() {
  const c = activeChat();
  runs.get(c.id)?.abort();
  c.sessionId = null;
  c.messages = [];
  save();
  render();
}

function start(c, text, prompt) {
  const parts = typeof text === 'string' ? [{ t: 'text', text }] : text;
  c.messages.push({ role: 'user', parts });
  const asst = { role: 'assistant', parts: [] };
  c.messages.push(asst);
  render();
  run(c, prompt, asst, true);
}

function send() {
  const c = activeChat();
  const ta = document.getElementById('claude-input');
  const text = ta.value.trim();
  const list = pending();
  if ((!text && !list.length) || runs.has(c.id)) return;
  ta.value = '';
  ta.style.height = 'auto';
  const atts = list.splice(0);
  attachErr = null;
  renderAttach();
  const parts = atts.map(a => ({ t: 'img', url: a.url }));
  if (text) parts.push({ t: 'text', text });
  const prompt = (text + atts.map(a => `\n\n[Attached image: ${a.path}]`).join('')).trim();
  start(c, parts, prompt);
}

// A preset fired while this tab is mid-stream opens a NEW tab and runs
// there — nothing has to wait
function quick(prompt) {
  let c = activeChat();
  if (runs.has(c.id)) c = newTab();
  start(c, prompt, prompt);
}

// One streamed turn for ONE chat. Each call owns its process server-side,
// so several chats stream at once; only the active tab repaints the
// transcript. `allowRetry` lets a stale --resume id fall back to a fresh
// session once, transparently.
async function run(c, text, asst, allowRetry) {
  const ctrl = new AbortController();
  runs.set(c.id, ctrl);
  render();
  const sentSession = c.sessionId;
  let errText = null;
  const seenTools = new Set();
  const paint = () => { if (state.activeId === c.id) render(); };

  const handle = (ev) => {
    if (ev.type === 'doc_update' && typeof ev.text === 'string') {
      hooks.setDoc(ev.text); // live edit lands in the editor mid-turn
    } else if (ev.type === 'system' && ev.subtype === 'init') {
      c.sessionId = ev.session_id;
    } else if (ev.type === 'stream_event' && ev.event) {
      const e = ev.event;
      if (e.type === 'content_block_start' && e.content_block?.type === 'text') {
        asst.parts.push({ t: 'text', text: '' });
        paint();
      } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        const last = asst.parts[asst.parts.length - 1];
        if (last && last.t === 'text') {
          last.text += e.delta.text;
          paint();
        }
      }
    } else if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_use' && !seenTools.has(block.id)) {
          seenTools.add(block.id);
          asst.parts.push({ t: 'tool', label: toolLabel(block.name, block.input) });
          paint();
        }
      }
    } else if (ev.type === 'result') {
      if (ev.session_id) c.sessionId = ev.session_id;
      if (ev.is_error) errText = ev.result || ev.subtype || 'Claude returned an error';
    } else if (ev.type === 'server_error') {
      errText = ev.error;
    }
  };

  try {
    const resp = await fetch('/api/claude/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: c.id,
        message: text,
        model: c.model,
        session_id: c.sessionId,
        doc: hooks.getDoc(),
        syntax: syntaxMarkdown(),
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(await resp.text());
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { handle(JSON.parse(line)); } catch (e) { /* skip malformed line */ }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') errText = e.message;
  }

  runs.delete(c.id);

  // A dead --resume id (cleaned-up session) -> retry once on a fresh session
  if (errText && sentSession && allowRetry && /no conversation found/i.test(errText)) {
    c.sessionId = null;
    asst.parts = [];
    await run(c, text, asst, false);
    return;
  }
  if (errText) asst.parts.push({ t: 'text', text: '⚠ ' + errText });
  if (state.activeId !== c.id) c.unread = true; // finished off-screen
  save();
  render();
}

export async function initClaudePanel(opts) {
  hooks = opts;

  // Dev-server only: no endpoint, no panel
  try {
    const ping = await fetch('/api/claude/ping');
    if (!ping.ok || !(await ping.json()).ok) return;
  } catch (e) {
    return;
  }

  const root = document.createElement('div');
  root.id = 'claude-root';
  root.innerHTML = `
    <button id="claude-fab" title="Ask Claude (⌘J)">${CLAUDE_LOGO}</button>
    <div id="claude-panel">
      <div class="claude-head">
        <span class="claude-title">${CLAUDE_LOGO} claude</span>
        <select id="claude-model" title="Model for this chat">
          ${CHAT_MODELS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <button class="claude-icon-btn" id="claude-close" title="Close (⌘J)">×</button>
      </div>
      <div id="claude-tabs"></div>
      <div class="claude-quick">
        ${QUICK_PROMPTS.map(([label], i) => `<button data-quick="${i}">${label}</button>`).join('')}
      </div>
      <div id="claude-messages"></div>
      <div id="claude-attach"></div>
      <div class="claude-input-row">
        <textarea id="claude-input" rows="1" placeholder="Change the instrument…"></textarea>
        <button class="claude-icon-btn" id="claude-reset" title="New conversation in this tab (⌘⇧K)">⟳</button>
        <button id="claude-send" title="Send">↑</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const panel = panelEl();
  document.getElementById('claude-fab').addEventListener('click', toggle);
  document.getElementById('claude-close').addEventListener('click', toggle);
  document.getElementById('claude-reset').addEventListener('click', reset);
  document.getElementById('claude-send').addEventListener('click', () => {
    const run = runs.get(activeChat().id);
    if (run) run.abort();
    else send();
  });

  document.getElementById('claude-tabs').addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) { closeTab(close.dataset.close); return; }
    if (e.target.closest('.claude-tab-add')) { newTab(); return; }
    const tab = e.target.closest('.claude-tab');
    if (tab) activate(tab.dataset.id);
  });
  panel.querySelector('.claude-quick').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quick]');
    if (btn) quick(QUICK_PROMPTS[+btn.dataset.quick][1]);
  });
  document.getElementById('claude-attach').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    pending().splice(+btn.dataset.remove, 1);
    renderAttach();
  });
  document.getElementById('claude-messages').addEventListener('click', (e) => {
    if (e.target.matches('.claude-att-img')) window.open(e.target.src);
  });
  panel.addEventListener('paste', onPaste);

  const sel = document.getElementById('claude-model');
  sel.value = activeChat().model;
  sel.addEventListener('change', () => {
    activeChat().model = sel.value;
    save();
  });

  const ta = document.getElementById('claude-input');
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      send();
    }
  });
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });

  // ⌘J toggles from anywhere (capture: beats the editor's keymap);
  // ⌘⇧K resets the current tab while the panel is open
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || !e.key) return;
    const k = e.key.toLowerCase();
    if (k === 'j' && !e.shiftKey) {
      e.preventDefault();
      toggle();
    } else if (k === 'k' && e.shiftKey && state.open) {
      e.preventDefault();
      reset();
    }
  }, true);

  initMoveResize();

  if (state.open) panel.classList.add('open');
  render();
}
