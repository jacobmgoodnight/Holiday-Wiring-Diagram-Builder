import { useEffect, useRef, useState } from 'react';
import { iconFor } from '../presets/custom';
import { findNodes } from '../model/navigate';
import type { Display } from '../model/types';

interface Props {
  display: Display;
  /** Outlet (or "Not plugged in yet") each item belongs to, for the result line. */
  whereOf: (id: string) => string;
  onPick: (id: string) => void;
  onClose: () => void;
}

/** Jump to any item by ID, name, tag or storage spot. */
export function FindBox({ display, whereOf, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = findNodes(display, q);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActive(0), [q]);
  return (
    <div className="find" role="dialog" aria-label="Find">
      <input
        ref={input}
        type="search"
        placeholder="Find: S02, spotlight, porch…"
        aria-label="Search the plan"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) onPick(results[active].id);
        }}
      />
      {q.trim() && (
        <ul className="find-results" role="listbox" aria-label="Matches">
          {results.length === 0 && <li className="muted small">Nothing matches.</li>}
          {results.map((n, i) => (
            <li key={n.id} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? 'on' : ''} onClick={() => onPick(n.id)}>
                <span aria-hidden="true">{iconFor(n)}</span> <b className="dn-id">{n.id}</b> {n.label}
                <span className="muted small"> · {whereOf(n.id)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="find-close" onClick={onClose} aria-label="Close find">
        ✕
      </button>
    </div>
  );
}
