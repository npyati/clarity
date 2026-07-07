/**
 * Vite dev-server middleware: the Claude panel's backend.
 *
 * POST /api/claude/chat writes the current document into a sandboxed
 * workspace (.claude-live/instrument.clarity + SYNTAX.md), spawns the
 * local `claude` CLI headless with file tools confined to that folder,
 * and streams its stream-json output back as NDJSON. While the turn
 * runs, the workspace is watched: every change to instrument.clarity is
 * pushed into the stream as a {type:'doc_update', text} event so the
 * editor updates live mid-turn.
 *
 * Dev-only by construction — the production build has no server. The
 * panel probes GET /api/claude/ping and hides itself when absent.
 * (Pattern adapted from npyati/becoming's serve.py chat endpoint.)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const WORKSPACE = path.resolve('.claude-live');
const DOC_FILE = path.join(WORKSPACE, 'instrument.clarity');
const SYNTAX_FILE = path.join(WORKSPACE, 'SYNTAX.md');
const MODELS = new Set(['haiku', 'sonnet', 'opus']);

// File tools only, confined to the workspace folder by cwd
const ALLOWED_TOOLS = 'Read,Write,Edit';

const SYSTEM_NOTE = `You are the assistant embedded in Clarity, a text-based synthesizer, replying inside a small chat panel in its web UI.
Your working directory holds exactly two files:
- instrument.clarity — the user's live instrument document. This is the ONLY file you should change. The UI applies your edits to the running synth immediately after every Write/Edit, so prefer small targeted edits over full rewrites.
- SYNTAX.md — the complete language reference, generated from the app's schemas. Read it before your first edit; only syntax it documents will parse.
Ground rules: keep the document parseable at every step (2-space indent for attributes, 4-space for modulation lines); component names must be unique; be conservative with volumes (keep master volume <= 80). After editing, confirm what changed in one short sentence — long answers do not fit the panel.`;

function findClaudeBin() {
  const candidates = [
    ...(process.env.PATH || '').split(path.delimiter).map(d => path.join(d, 'claude')),
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (e) { /* keep looking */ }
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function claudeLivePlugin() {
  return {
    name: 'clarity-claude-live',
    configureServer(server) {
      server.middlewares.use('/api/claude/ping', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: !!findClaudeBin() }));
      });

      server.middlewares.use('/api/claude/chat', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }

        let payload;
        try {
          payload = JSON.parse(await readBody(req));
        } catch (e) {
          res.statusCode = 400;
          res.end('invalid JSON');
          return;
        }

        const message = (payload.message || '').trim();
        if (!message) {
          res.statusCode = 400;
          res.end('message is required');
          return;
        }
        const model = payload.model || 'sonnet';
        if (!MODELS.has(model)) {
          res.statusCode = 400;
          res.end(`model must be one of: ${[...MODELS].join(', ')}`);
          return;
        }
        const bin = findClaudeBin();
        if (!bin) {
          res.statusCode = 500;
          res.end('claude CLI not found — install Claude Code first');
          return;
        }

        // Fresh workspace state for this turn
        fs.mkdirSync(WORKSPACE, { recursive: true });
        fs.writeFileSync(DOC_FILE, typeof payload.doc === 'string' ? payload.doc : '');
        if (typeof payload.syntax === 'string' && payload.syntax) {
          fs.writeFileSync(SYNTAX_FILE, payload.syntax);
        }

        const args = [
          '-p',
          '--output-format', 'stream-json', '--verbose',
          '--include-partial-messages',
          '--model', model,
          '--permission-mode', 'acceptEdits',
          '--allowedTools', ALLOWED_TOOLS,
          '--append-system-prompt', SYSTEM_NOTE,
        ];
        if (payload.session_id) args.push('--resume', payload.session_id);

        let proc;
        try {
          proc = spawn(bin, args, {
            cwd: WORKSPACE,
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: true, // own process group -> clean kill
          });
        } catch (e) {
          res.statusCode = 500;
          res.end(`could not start claude: ${e.message}`);
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache',
        });

        // Live document mirror: any change to instrument.clarity flows
        // into the stream immediately
        let lastSent = payload.doc || '';
        const pushDoc = () => {
          try {
            const text = fs.readFileSync(DOC_FILE, 'utf8');
            if (text !== lastSent) {
              lastSent = text;
              res.write(JSON.stringify({ type: 'doc_update', text }) + '\n');
            }
          } catch (e) { /* mid-write race — the next event catches up */ }
        };
        let watcher = null;
        try {
          watcher = fs.watch(WORKSPACE, pushDoc); // dir watch survives atomic renames
        } catch (e) { /* fall back to per-event checks */ }

        const kill = () => {
          try { process.kill(-proc.pid, 'SIGTERM'); } catch (e) { /* already gone */ }
        };
        req.on('close', kill); // client hit stop / closed the tab

        let stderrBuf = '';
        proc.stderr.on('data', d => { stderrBuf += d; });

        const rl = readline.createInterface({ input: proc.stdout });
        rl.on('line', line => {
          res.write(line + '\n');
          pushDoc(); // belt-and-braces alongside the watcher
        });

        proc.on('close', (code) => {
          if (watcher) watcher.close();
          pushDoc();
          if (code !== 0) {
            res.write(JSON.stringify({
              type: 'server_error',
              error: stderrBuf.trim() || `claude exited with code ${code}`,
            }) + '\n');
          }
          res.end();
        });

        proc.stdin.end(message);
      });
    },
  };
}
