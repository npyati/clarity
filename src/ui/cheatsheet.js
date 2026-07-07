/**
 * Syntax cheatsheet — generated from the schemas, so it can never drift
 * from what the parser actually accepts.
 */
import { COMPONENT_SCHEMAS, TRIGGER_SCHEMAS } from '../dsl/schemas.js';

const GENERAL = [
  ['variable name = 50', 'reusable value'],
  ['variable cutoff = 2000 [200, 8000]', 'variable with a range (slider + CC target)'],
  ['attribute value', 'set an attribute (2-space indent)'],
  ['attribute variable_name', 'bind an attribute to a variable'],
  ['rate vibrato_rate + 2', 'math expressions (+ - * / parentheses)'],
  ['    modulation vibrato', 'modulate the attribute above (4-space indent)'],
  ['    modulation vibrato * 0.5', 'modulation at half depth'],
  ['# comment', 'ignored by the parser'],
];

function exampleFor(type, schema, name) {
  const lines = [`${type}${name ? ' ' + name : ''}`];
  const attrs = Object.entries(schema.attributes || {}).slice(0, 3);
  for (const [attrName, attrSchema] of attrs) {
    if (attrSchema.default !== undefined && attrSchema.default !== null) {
      lines.push(`  ${attrName} ${attrSchema.default}`);
    }
  }
  return lines.join('\n');
}

function buildContent() {
  const root = document.createElement('div');

  const addGroup = (title, entries) => {
    const h = document.createElement('h3');
    h.textContent = title;
    root.appendChild(h);
    const dl = document.createElement('div');
    dl.className = 'cheat-group';
    for (const [code, desc] of entries) {
      const row = document.createElement('div');
      row.className = 'cheat-row';
      const pre = document.createElement('pre');
      pre.textContent = code;
      const span = document.createElement('span');
      span.textContent = desc;
      row.appendChild(pre);
      row.appendChild(span);
      dl.appendChild(row);
    }
    root.appendChild(dl);
  };

  addGroup('basics', GENERAL);

  addGroup('components', Object.entries(COMPONENT_SCHEMAS).map(([type, schema]) =>
    [exampleFor(type, schema, 'name'), schema.description || type]
  ));

  addGroup('scopes & triggers', Object.entries(TRIGGER_SCHEMAS).map(([type, schema]) => {
    const name = { note: 'c4', key: 'f', cc: '74' }[type];
    return [exampleFor(type, schema, name), schema.description || type];
  }));

  addGroup('playing', [
    ['Z-/ · A-; · Q-P · 1-0', 'chromatic keyboard from C3 (click the panel first)'],
    ['Cmd/Ctrl + ↑/↓', 'nudge the value under the cursor (Shift = ×10)'],
    ['/', 'command palette (empty line) · Cmd/Ctrl+P anywhere'],
    ['Cmd/Ctrl + K', 'focus the playing keyboard'],
  ]);

  return root;
}

let panel = null;

export function toggleCheatsheet() {
  if (panel) {
    panel.remove();
    panel = null;
    return;
  }

  panel = document.createElement('div');
  panel.id = 'cheatsheet';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Syntax cheatsheet');

  const header = document.createElement('div');
  header.className = 'cheat-header';
  header.textContent = 'clarity syntax';
  const close = document.createElement('button');
  close.className = 'cheat-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close cheatsheet');
  close.addEventListener('click', () => toggleCheatsheet());
  header.appendChild(close);

  const body = document.createElement('div');
  body.className = 'cheat-body';
  body.appendChild(buildContent());

  panel.appendChild(header);
  panel.appendChild(body);
  document.body.appendChild(panel);

  const onKey = (e) => {
    if (e.key === 'Escape' && panel) {
      toggleCheatsheet();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}
