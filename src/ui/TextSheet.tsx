import type { Diagnostic } from '../model/types';
import { OutlineEditor, type Suggestion } from './OutlineEditor';
import { Sheet } from './Sheet';

interface Props {
  value: string;
  onChange: (text: string) => void;
  diagnostics: Diagnostic[];
  highlightLine?: number;
  readOnly?: boolean;
  onCursorLine: (line: number) => void;
  suggestFor: (line: string) => Suggestion[];
  onClose: () => void;
}

/** The plan as an indented list, for pasting or bulk edits. Edits apply live, with undo. */
export function TextSheet(p: Props) {
  return (
    <Sheet title="Edit as text" onClose={p.onClose} className="tall">
      <p className="muted small text-help">
        One item per line. Indent two spaces to plug it into the line above; <code>2:</code> names the socket. Changes show on
        the diagram as you type.
      </p>
      <OutlineEditor
        value={p.value}
        onChange={p.onChange}
        diagnostics={p.diagnostics}
        highlightLine={p.highlightLine}
        scrollRequest={1}
        onCursorLine={p.onCursorLine}
        readOnly={p.readOnly}
        suggestFor={p.suggestFor}
      />
      <div className="row text-done">
        <button type="button" className="primary" onClick={p.onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
