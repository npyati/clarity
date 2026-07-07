/**
 * Slash command palette.
 *
 * "New <component>" / "New <trigger>" insert-commands are generated from
 * the schemas (header + one line per attribute with a default), so a new
 * schema entry gets a palette command for free. Editor commands (text
 * size, reset, ...) are passed in by the app.
 *
 * The modal reuses the #command-modal DOM and styles from the block-editor
 * era; positioning is via view.coordsAtPos.
 */
import { COMPONENT_SCHEMAS, TRIGGER_SCHEMAS } from '../dsl/schemas.js';
import { instanceStore } from '../dsl/instance-store.js';
import { variable_names } from '../dsl/name-pool.js';

const TRIGGER_DEFAULT_NAMES = { note: 'c4', key: 'f' };

function pickUnusedName() {
  const used = new Set(Object.keys(instanceStore.nameRegistry || {}));
  const available = variable_names.filter(n => !used.has(n));
  if (available.length === 0) {
    let i = 1;
    while (used.has(`voice_${i}`)) i++;
    return `voice_${i}`;
  }
  return available[Math.floor(Math.random() * available.length)];
}

function templateLines(header, attributes) {
  const lines = [header];
  for (const [attrName, schema] of Object.entries(attributes || {})) {
    if (schema.default !== undefined && schema.default !== null) {
      lines.push(`  ${attrName} ${schema.default}`);
    }
  }
  return lines;
}

function insertLines(view, lines) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  // Insert below the current line, separated by a blank line unless the
  // current line is already empty
  const insert = (line.text.trim() === '' ? '\n' : '\n\n') + lines.join('\n');
  const from = line.to;
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.indexOf(lines[0]) + lines[0].length },
    userEvent: 'input.complete',
  });
  view.focus();
}

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Build the full command list: schema-generated inserts + app commands.
 * Command shape: { name, description, run(view) }
 */
export function buildCommands(appCommands = []) {
  const commands = [];

  for (const [type, schema] of Object.entries(COMPONENT_SCHEMAS)) {
    commands.push({
      name: `New ${titleCase(type)}`,
      description: schema.description || `Create a new ${type}`,
      run: (view) => insertLines(view, templateLines(`${type} ${pickUnusedName()}`, schema.attributes)),
    });
  }

  for (const [type, schema] of Object.entries(TRIGGER_SCHEMAS)) {
    const name = TRIGGER_DEFAULT_NAMES[type];
    const header = name ? `${type} ${name}` : type;
    commands.push({
      name: `New ${titleCase(type)}`,
      description: schema.description || `Create a ${type} section`,
      run: (view) => insertLines(view, templateLines(header, schema.attributes)),
    });
  }

  commands.push({
    name: 'New Variable',
    description: 'Create a reusable variable',
    run: (view) => insertLines(view, [`variable ${pickUnusedName()} = 50`]),
  });

  return [...commands, ...appCommands];
}

/**
 * Wire the palette to a view. Returns the keymap entries to install.
 */
export function setupPalette(getView, commands) {
  const modal = document.getElementById('command-modal');
  const search = document.getElementById('command-search');
  const list = document.getElementById('command-list');
  if (!modal || !search || !list) {
    console.error('Command modal elements not found');
    return [];
  }

  let open = false;
  let filtered = commands;
  let selectedIndex = 0;

  function render() {
    list.innerHTML = '';
    if (filtered.length === 0) {
      list.innerHTML = '<div class="command-item no-results">No commands found</div>';
      return;
    }
    filtered.forEach((command, index) => {
      const item = document.createElement('div');
      item.className = `command-item ${index === selectedIndex ? 'selected' : ''}`;

      const name = document.createElement('div');
      name.className = 'command-name';
      name.textContent = command.name;

      const desc = document.createElement('div');
      desc.className = 'command-description';
      desc.textContent = command.description;

      item.appendChild(name);
      item.appendChild(desc);
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        execute(command);
      });
      list.appendChild(item);
    });
  }

  function filter(term) {
    const t = term.toLowerCase();
    filtered = commands.filter(c =>
      c.name.toLowerCase().includes(t) || c.description.toLowerCase().includes(t)
    );
    selectedIndex = 0;
    render();
  }

  function show(view) {
    open = true;
    modal.classList.remove('hidden');
    search.value = '';
    filter('');

    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (coords) {
      const modalWidth = 350;
      const modalHeight = modal.offsetHeight || 200;
      let left = coords.left;
      let top = coords.bottom + 5;
      if (left + modalWidth > window.innerWidth) left = window.innerWidth - modalWidth - 10;
      if (top + modalHeight > window.innerHeight) top = coords.top - modalHeight - 5;
      modal.style.left = `${Math.max(10, left)}px`;
      modal.style.top = `${Math.max(10, top)}px`;
    }
    search.focus();
  }

  function hide({ refocus = true } = {}) {
    if (!open) return;
    open = false;
    modal.classList.add('hidden');
    const view = getView();
    if (refocus && view) view.focus();
  }

  function execute(command) {
    hide();
    const view = getView();
    if (view) command.run(view);
  }

  search.addEventListener('input', () => filter(search.value));

  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (filtered[selectedIndex]) execute(filtered[selectedIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    } else if (event.key === 'Backspace' && search.value === '') {
      event.preventDefault();
      hide();
    }
  });

  document.addEventListener('click', (event) => {
    if (open && !modal.contains(event.target)) hide({ refocus: false });
  });

  // Keymap: '/' opens the palette only at the start of a(n empty) line, so
  // expressions like `depth d / 2` still type a literal slash.
  // Mod-P always opens it.
  return [
    {
      key: '/',
      run: (view) => {
        const { state } = view;
        const head = state.selection.main.head;
        const line = state.doc.lineAt(head);
        const before = line.text.slice(0, head - line.from);
        if (before.trim() !== '') return false; // literal slash
        show(view);
        return true;
      },
    },
    {
      key: 'Mod-p',
      run: (view) => {
        show(view);
        return true;
      },
    },
  ];
}
