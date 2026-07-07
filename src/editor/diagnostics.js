/**
 * Inline diagnostics: parse errors and warnings become squiggles + gutter
 * markers. The lint pass reads the session's latest parse result (the
 * sync pipeline re-parses within 60ms of any edit, well inside CM's lint
 * delay, so results are fresh by lint time).
 */
import { linter, lintGutter } from '@codemirror/lint';

function toDiagnostics(view, result) {
  if (!result) return [];
  const doc = view.state.doc;
  const out = [];

  const add = (items, severity) => {
    for (const item of items || []) {
      const lineNumber = Math.min(Math.max(1, item.line || 1), doc.lines);
      const line = doc.line(lineNumber);
      out.push({
        from: line.from,
        to: line.to,
        severity,
        message: item.message,
      });
    }
  };

  add(result.errors, 'error');
  add(result.warnings, 'warning');
  return out;
}

export function clarityDiagnostics(getParseResult) {
  return [
    linter((view) => toDiagnostics(view, getParseResult()), { delay: 300 }),
    lintGutter(),
  ];
}
