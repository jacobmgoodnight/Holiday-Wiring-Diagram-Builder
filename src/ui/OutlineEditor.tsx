import { useEffect, useMemo, useRef, useState } from 'react';
import type { Diagnostic, Severity } from '../model/types';
import { splitLine } from '../presets/custom';

export interface Suggestion {
  id: string;
  icon: string;
  /** Text that replaces what was typed on the line. */
  text: string;
}

/** Must match --outline-lh in styles.css. */
const LH = 22;

interface Props {
  value: string;
  onChange: (text: string) => void;
  diagnostics: Diagnostic[];
  /** 0-based line to highlight (the selected item). */
  highlightLine?: number;
  /** Changes when the outline should scroll to `highlightLine`. */
  scrollRequest?: number;
  onCursorLine: (line: number) => void;
  readOnly?: boolean;
  /** Library matches for what is typed on a line (autocomplete). */
  suggestFor?: (line: string) => Suggestion[];
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

export function OutlineEditor({ value, onChange, diagnostics, highlightLine, scrollRequest, onCursorLine, readOnly, suggestFor }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutterInner = useRef<HTMLDivElement>(null);
  const backdropInner = useRef<HTMLDivElement>(null);
  const [cursorLine, setCursorLine] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const lines = useMemo(() => value.split('\n'), [value]);
  const worst = useMemo(() => {
    const m = new Map<number, Severity>();
    for (const d of diagnostics) {
      const i = d.line - 1;
      const cur = m.get(i);
      if (!cur || RANK[d.severity] > RANK[cur]) m.set(i, d.severity);
    }
    return m;
  }, [diagnostics]);
  const problems = diagnostics.filter((d) => d.severity !== 'info');
  const [focused, setFocused] = useState(false);
  const suggestions = focused && suggestFor && !readOnly ? suggestFor(lines[cursorLine] ?? '') : [];

  const accept = (sug: Suggestion) => {
    const t = area.current;
    if (!t) return;
    const { head } = splitLine(lines[cursorLine] ?? '');
    const next = [...lines];
    next[cursorLine] = head + sug.text;
    const text = next.join('\n');
    let caret = 0;
    for (let i = 0; i < cursorLine; i++) caret += next[i].length + 1;
    caret += next[cursorLine].length;
    onChange(text);
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(caret, caret);
    });
  };
  const here = diagnostics.filter((d) => d.line - 1 === cursorLine);

  const syncScroll = () => {
    const t = area.current;
    if (!t) return;
    if (gutterInner.current) gutterInner.current.style.transform = `translateY(${-t.scrollTop}px)`;
    if (backdropInner.current) backdropInner.current.style.transform = `translate(${-t.scrollLeft}px, ${-t.scrollTop}px)`;
  };

  const reportCursor = () => {
    const t = area.current;
    if (!t) return;
    const line = t.value.slice(0, t.selectionStart).split('\n').length - 1;
    if (line !== cursorLine) setCursorLine(line);
    onCursorLine(line);
  };

  const scrollToLine = (line: number) => {
    const t = area.current;
    if (!t) return;
    const top = line * LH;
    if (top < t.scrollTop || top > t.scrollTop + t.clientHeight - LH * 2) {
      t.scrollTop = Math.max(0, top - t.clientHeight / 3);
      syncScroll();
    }
  };

  useEffect(() => {
    if (scrollRequest !== undefined && highlightLine !== undefined) scrollToLine(highlightLine);
  }, [scrollRequest]);

  useEffect(syncScroll, [value]);

  const jumpTo = (line: number) => {
    const t = area.current;
    if (!t) return;
    let start = 0;
    for (let i = 0; i < line; i++) start += lines[i].length + 1;
    t.focus();
    t.setSelectionRange(start + lines[line].length, start + lines[line].length);
    setCursorLine(line);
    onCursorLine(line);
    scrollToLine(line);
  };

  return (
    <div className="outline">
      <div className="editor">
        <div className="gutter" aria-hidden="true">
          <div ref={gutterInner}>
            {lines.map((_, i) => {
              const sev = worst.get(i);
              return (
                <div key={i} className={`gl${sev ? ` g-${sev}` : ''}${i === highlightLine ? ' g-sel' : ''}`}>
                  {sev && sev !== 'info' && <span className="dot" />}
                  {i + 1}
                </div>
              );
            })}
          </div>
        </div>
        <div className="code">
          <div className="backdrop" aria-hidden="true">
            <div ref={backdropInner}>
              {lines.map((line, i) => {
                const sev = worst.get(i);
                const cls = [i === highlightLine && 'b-sel', sev === 'error' && 'b-error', sev === 'warning' && 'b-warning'].filter(Boolean).join(' ');
                return (
                  <div key={i} className={cls || undefined}>
                    {line || ' '}
                  </div>
                );
              })}
            </div>
          </div>
          <textarea
            ref={area}
            aria-label="Outline"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            wrap="off"
            readOnly={readOnly}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              requestAnimationFrame(reportCursor);
            }}
            onScroll={syncScroll}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onSelect={reportCursor}
            onKeyUp={reportCursor}
            onClick={reportCursor}
            onKeyDown={(e) => {
              // Tab indents by two spaces instead of leaving the editor (Shift+Tab outdents).
              if (e.key !== 'Tab' || e.altKey || e.metaKey || e.ctrlKey) return;
              const t = e.currentTarget;
              e.preventDefault();
              const start = t.value.lastIndexOf('\n', t.selectionStart - 1) + 1;
              const pos = t.selectionStart;
              if (e.shiftKey) {
                const remove = t.value.startsWith('  ', start) ? 2 : t.value.startsWith(' ', start) ? 1 : 0;
                if (!remove) return;
                t.setRangeText('', start, start + remove, 'preserve');
                t.setSelectionRange(Math.max(start, pos - remove), Math.max(start, pos - remove));
              } else {
                t.setRangeText('  ', start, start, 'preserve');
                t.setSelectionRange(pos + 2, pos + 2);
              }
              onChange(t.value);
            }}
          />
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="suggest" aria-label="Suggestions from your presets">
          {suggestions.map((sug) => (
            <button
              key={sug.id}
              type="button"
              // Keep focus in the outline so the keyboard stays up on phones.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => accept(sug)}
            >
              <span aria-hidden="true">{sug.icon}</span> {sug.text}
            </button>
          ))}
        </div>
      )}
      <div className="diag-strip" role="status">
        {here.length > 0 ? (
          here.map((d, i) => (
            <div key={i} className={d.severity}>
              <strong>Line {d.line}:</strong> {d.message}
            </div>
          ))
        ) : problems.length === 0 ? (
          <div className="muted">No problems found.</div>
        ) : (
          <button type="button" className="link" onClick={() => setShowAll((s) => !s)}>
            {problems.length} line{problems.length === 1 ? '' : 's'} to check {showAll ? '▴' : '▾'}
          </button>
        )}
        {showAll && here.length === 0 && problems.length > 0 && (
          <ul className="diag-list">
            {problems.map((d, i) => (
              <li key={i} className={d.severity}>
                <button type="button" className="link" onClick={() => jumpTo(d.line - 1)}>
                  Line {d.line}
                </button>{' '}
                {d.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
