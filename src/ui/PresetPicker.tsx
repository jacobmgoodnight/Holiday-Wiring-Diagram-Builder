import { useEffect, useMemo, useRef, useState } from 'react';
import { PRESETS, type Preset, presetById, searchPresets } from '../presets/presets';
import { getFavorites, getRecent, toggleFavorite } from '../presets/prefs';

interface Props {
  /** e.g. "Plug into S01 · socket 4" */
  title: string;
  onPick: (preset: Preset) => void;
  onClose: () => void;
}

const finePointer = () => window.matchMedia('(pointer: fine)').matches;

export function PresetPicker({ title, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState(getFavorites);
  const recent = useMemo(() => getRecent().map(presetById).filter((p): p is Preset => !!p), []);
  const sheet = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Keyboard users start typing straight away; phones keep the keyboard closed.
    if (finePointer()) search.current?.focus();
    else sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = searchPresets(query);
  const favorites = favs.map(presetById).filter((p): p is Preset => !!p);

  const tile = (p: Preset, key: string) => (
    <div className="tile" key={key}>
      <button type="button" className="tile-main" onClick={() => onPick(p)} aria-label={`Add ${p.name}`}>
        <span className="tile-icon" aria-hidden="true">
          {p.icon}
        </span>
        <span className="tile-name">{p.name}</span>
      </button>
      <button
        type="button"
        className={`tile-star${favs.includes(p.id) ? ' on' : ''}`}
        aria-label={favs.includes(p.id) ? `Unstar ${p.name}` : `Star ${p.name} as a favourite`}
        onClick={() => setFavs(toggleFavorite(p.id))}
      >
        {favs.includes(p.id) ? '★' : '☆'}
      </button>
    </div>
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={sheet}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <input
          ref={search}
          className="sheet-search"
          type="search"
          placeholder="Search: cord, spotlight, inflatable…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length) onPick(results[0]);
          }}
          aria-label="Search presets"
        />
        <div className="sheet-body">
          {!query && recent.length > 0 && (
            <section>
              <h3>Recent</h3>
              <div className="tiles row">{recent.map((p) => tile(p, `r-${p.id}`))}</div>
            </section>
          )}
          {!query && favorites.length > 0 && (
            <section>
              <h3>Favourites</h3>
              <div className="tiles row">{favorites.map((p) => tile(p, `f-${p.id}`))}</div>
            </section>
          )}
          {query ? (
            <section>
              <div className="tiles">{results.map((p) => tile(p, p.id))}</div>
              {!results.length && <p className="muted">No preset matches. Pick “Other” and rename it.</p>}
            </section>
          ) : (
            <>
              <section>
                <h3>Power</h3>
                <div className="tiles">{PRESETS.filter((p) => p.group === 'power').map((p) => tile(p, p.id))}</div>
              </section>
              <section>
                <h3>Things that use power</h3>
                <div className="tiles">{PRESETS.filter((p) => p.group === 'load').map((p) => tile(p, p.id))}</div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
