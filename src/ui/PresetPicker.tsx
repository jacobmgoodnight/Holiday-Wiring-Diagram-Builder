import { useEffect, useMemo, useRef, useState } from 'react';
import { PRESETS, type Preset, presetById, searchPresets } from '../presets/presets';
import { getFavorites, getRecent, toggleFavorite } from '../presets/prefs';

interface Props {
  /** e.g. "Plug into S01 · socket 4" */
  title: string;
  /** Your own presets ("Save as preset"). */
  custom: Preset[];
  onDeleteCustom: (p: Preset) => void;
  /** What usually goes here (shown first). */
  suggested?: Preset[];
  onPick: (preset: Preset) => void;
  onClose: () => void;
}

const finePointer = () => window.matchMedia('(pointer: fine)').matches;

export function PresetPicker({ title, custom, onDeleteCustom, suggested = [], onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState(getFavorites);
  const recent = useMemo(() => getRecent().map((id) => presetById(id, custom)).filter((p): p is Preset => !!p), [custom]);
  const sheet = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Keyboard users start typing straight away; phones keep the keyboard closed. Only on open.
    if (finePointer()) search.current?.focus();
    else sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = searchPresets(query, [...custom, ...PRESETS]);
  const favorites = favs.map((id) => presetById(id, custom)).filter((p): p is Preset => !!p);

  const tile = (p: Preset, key: string) => (
    <div className="tile" key={key}>
      <button type="button" className="tile-main" onClick={() => onPick(p)} aria-label={`Add ${p.name}`}>
        <span className="tile-icon" aria-hidden="true">
          {p.icon}
        </span>
        <span className="tile-name">{p.name}</span>
      </button>
      {p.custom && key.startsWith('m-') && (
        <button type="button" className="tile-del" aria-label={`Remove my preset ${p.name}`} onClick={() => onDeleteCustom(p)}>
          ✕
        </button>
      )}
      {!p.id.startsWith('like:') && <button
        type="button"
        className={`tile-star${favs.includes(p.id) ? ' on' : ''}`}
        aria-label={favs.includes(p.id) ? `Unstar ${p.name}` : `Star ${p.name} as a favourite`}
        onClick={() => setFavs(toggleFavorite(p.id))}
      >
        {favs.includes(p.id) ? '★' : '☆'}
      </button>}
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
          {!query && suggested.length > 0 && (
            <section>
              <h3>Suggested here</h3>
              <div className="tiles row">{suggested.map((p) => tile(p, `s-${p.id}`))}</div>
            </section>
          )}
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
              {custom.length > 0 && (
                <section>
                  <h3>My presets</h3>
                  <div className="tiles">{custom.map((p) => tile(p, `m-${p.id}`))}</div>
                </section>
              )}
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
