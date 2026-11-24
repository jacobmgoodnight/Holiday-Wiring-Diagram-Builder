import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { clusterList, clusterMembers, clusterTitle } from '../diagram/layout';
import { toCsv } from '../export/csv';
import { type Label, type LabelOptions, TIE_COLORS, labelCandidates, labelPrep, labelsFor, storyName, tieHex, tieName, tiesText } from '../export/labels';
import { photoItems } from '../export/takeoff';
import type { NodePatch } from '../model/actions';
import type { Display, Marks } from '../model/types';
import { TieDots } from './TieDots';

/** Paper and label stock. Sizes in inches; sheet stocks place labels exactly on the page. */
interface Stock {
  name: string;
  w: number;
  h: number;
  /** Label sheets: columns, rows, page margins and gaps (US Letter). */
  sheet?: { cols: number; rows: number; top: number; left: number; gapX: number };
}
const STOCKS = {
  flag: { name: 'Plain paper: flag, folds around a cord (3.1 × 0.75 in)', w: 3.1, h: 0.75 },
  small: { name: 'Plain paper: small (2 × 0.75 in)', w: 2, h: 0.75 },
  large: { name: 'Plain paper: large (3.5 × 1.25 in)', w: 3.5, h: 1.25 },
  avery5160: { name: 'Avery 5160 / 8160 sheet: 30 labels, 2⅝ × 1 in', w: 2.625, h: 1, sheet: { cols: 3, rows: 10, top: 0.5, left: 0.1875, gapX: 0.125 } },
  avery5167: { name: 'Avery 5167 / 8167 sheet: 80 small labels, 1¾ × ½ in', w: 1.75, h: 0.5, sheet: { cols: 4, rows: 20, top: 0.5, left: 0.28125, gapX: 0.3125 } },
  custom: { name: 'Custom size', w: 2.5, h: 0.75 },
} satisfies Record<string, Stock>;
type StockId = keyof typeof STOCKS;
type Format = StockId | 'maker';

interface Saved extends Omit<LabelOptions, 'only' | 'ids'> {
  format: Format;
  /** Text on both halves with a strip to wrap around the cord (wide labels). */
  flag: boolean;
  customW: number;
  customH: number;
  bigText: boolean;
}
const OPTS_KEY = 'wiring-sketchpad.labels';
const DEFAULTS: Saved = { format: 'flag', flag: true, customW: 2.5, customH: 0.75, bigText: false, includeLoads: true, bothEnds: true, route: false, storage: false, cordLine: 'length', lightLine: 'where' };
function readSaved(): Saved {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

interface Props {
  display: Display;
  /** Start with: '' everything, 'outlet:O01', 'view:<photo id>' or 'item:C05'. */
  initialScope?: string;
  /** Change an item (story, location, length, label text, leave out, an outlet's tie colour). */
  onPatch: (id: string, patch: NodePatch) => void;
  /** The same change to several items, as one step you can undo ("Mark as printed"). */
  onPatchMany: (ids: string[], patch: NodePatch) => void;
  /** Turn zip-tie colours or story counts on or off (colours get handed out when turned on). */
  onMarks: (marks: Marks) => void;
  onDownloadCsv: (csv: string) => void;
  onClose: () => void;
}

function LabelFace({ l, tall }: { l: Label; tall: boolean }) {
  return (
    <div className="label-face">
      <div className="label-top">
        <span className="label-id">{l.heading}</span>
        <TieDots ties={l.ties} />
      </div>
      <div className="label-sub">{l.sub}</div>
      {tall && l.route && <div className="label-route">{l.route}</div>}
      {tall && l.storage && <div className="label-name">{l.storage}</div>}
    </div>
  );
}

function LabelBox({ l, flag, tall }: { l: Label; flag: boolean; tall: boolean }) {
  return (
    <div className={`label${flag ? ' flag' : ''}`} aria-label={`Label ${l.text}`}>
      <LabelFace l={l} tall={tall} />
      {flag && (
        <>
          <div className="label-wrap" aria-hidden="true" />
          <LabelFace l={l} tall={tall} />
        </>
      )}
    </div>
  );
}

/** A text box that saves when you leave it or press Enter. */
function Inline({ value, label, placeholder, type = 'text', onCommit }: { value: string; label: string; placeholder?: string; type?: string; onCommit: (v: string) => void }) {
  return (
    <input
      key={value}
      className="ls-input"
      type={type}
      inputMode={type === 'number' ? 'decimal' : undefined}
      aria-label={label}
      placeholder={placeholder}
      defaultValue={value}
      onBlur={(e) => e.target.value.trim() !== value && onCommit(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * Labels for cords, gear, lights and props: the ID big and one useful line. Choose which
 * (one outlet or photo, new this year, not printed yet, untick any), the stock (plain paper,
 * Avery sheets, any size, a label maker) and what they say. Optional zip-tie marks: a colour
 * per outlet and one tie per story.
 */
export function LabelSheet({ display, initialScope = '', onPatch, onPatchMany, onMarks, onDownloadCsv, onClose }: Props) {
  const [saved, setSaved] = useState(readSaved);
  const set = (patch: Partial<Saved>) =>
    setSaved((o) => {
      const next = { ...o, ...patch };
      try {
        localStorage.setItem(OPTS_KEY, JSON.stringify(next));
      } catch {
        // private mode: this visit only
      }
      return next;
    });
  const { format, flag, customW, customH, bigText, ...content } = saved;
  const [scope, setScope] = useState(initialScope);
  const [only, setOnly] = useState<'all' | 'new' | 'unprinted'>('all');
  const [startAt, setStartAt] = useState(1);
  const [copied, setCopied] = useState(false);
  const marks = display.marks ?? {};

  const ids = useMemo(() => {
    const [kind, id] = scope.split(':');
    if (kind === 'item') return new Set([id]);
    if (kind === 'view') return photoItems(display, id);
    if (kind === 'outlet') return new Set(clusterMembers(display).find((g) => g.root === id)?.members ?? []);
    return undefined;
  }, [display, scope]);
  const opts: LabelOptions = { ...content, only, ids };
  const labels = useMemo(() => labelsFor(display, opts), [display, content.includeLoads, content.bothEnds, content.route, content.storage, content.cordLine, content.lightLine, only, ids]);
  const candidates = useMemo(() => labelCandidates(display, opts), [display, content.includeLoads, only, ids]);
  const prep = labelPrep(labels);
  const printedIds = [...new Set(labels.map((l) => l.id))];
  const plain = labels.map((l) => l.text).join('\n');

  const stock: Stock | undefined = format === 'maker' ? undefined : format === 'custom' ? { ...STOCKS.custom, w: customW, h: customH } : STOCKS[format];
  const canFlag = !!stock && stock.w >= 2.2 && format !== 'flag';
  const isFlag = format === 'flag' || (canFlag && flag);
  const tall = !!stock && stock.h >= 0.7;
  // Text scales with the label height.
  const idPt = stock ? Math.min(20, stock.h * 72 * 0.25) * (bigText ? 1.2 : 1) : 13;
  const style = stock
    ? ({ '--lw': `${stock.w}in`, '--lh': `${stock.h}in`, '--id-pt': `${idPt}pt`, '--sub-pt': `${idPt * 0.76}pt`, '--wrap': `${Math.min(0.5, stock.w * 0.16)}in` } as CSSProperties)
    : undefined;
  const sheet = stock?.sheet;
  const perSheet = sheet ? sheet.cols * sheet.rows : 0;
  const skip = sheet ? Math.min(Math.max(1, startAt), perSheet) - 1 : 0;
  const pages: (Label | null)[][] = [];
  if (sheet) {
    const cells: (Label | null)[] = [...Array<null>(skip).fill(null), ...labels];
    for (let i = 0; i < cells.length; i += perSheet) pages.push(cells.slice(i, i + perSheet));
  }

  // Label sheets print edge to edge, so the labels land where the sheet has them.
  useEffect(() => {
    if (!sheet) return;
    const el = document.createElement('style');
    el.textContent = '@media print { @page { size: letter; margin: 0; } }';
    document.head.appendChild(el);
    return () => el.remove();
  }, [!!sheet]);

  const views = display.views ?? [];
  const outlets = clusterList(display).filter((c) => c.id !== 'unplugged');
  const groups = clusterMembers(display)
    .map((g) => ({ root: display.nodes[g.root], members: g.members.filter((id) => candidates.includes(id)) }))
    .filter((g) => g.members.length);
  const scopeItem = scope.startsWith('item:') ? scope.slice(5) : undefined;

  return (
    <div className="labels-page" role="dialog" aria-modal="true" aria-label="Labels">
      <div className="labels-controls no-print">
        <div className="labels-head">
          <strong>Labels · {display.title}</strong>
          <button type="button" onClick={onClose} aria-label="Close labels">
            ✕
          </button>
        </div>

        <fieldset className="sheet-parts">
          <legend>Which labels</legend>
          <label className="field">
            <span>For</span>
            <select aria-label="Labels for" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">Everything</option>
              {scopeItem && display.nodes[scopeItem] && <option value={scope}>Just {scopeItem} {display.nodes[scopeItem].label}</option>}
              {outlets.map((c) => (
                <option key={c.id} value={`outlet:${c.id}`}>
                  {c.title}
                </option>
              ))}
              {views.map((v) => (
                <option key={v.id} value={`view:${v.id}`}>
                  Photo: {v.name}
                </option>
              ))}
            </select>
          </label>
          <div className="seg" role="group" aria-label="Only">
            {(
              [
                ['all', 'All'],
                ['new', 'New this year'],
                ['unprinted', 'Not printed yet'],
              ] as const
            ).map(([k, name]) => (
              <button key={k} type="button" aria-pressed={only === k} className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>
                {name}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={content.includeLoads !== false} onChange={(e) => set({ includeLoads: e.target.checked })} />
            Lights and props too
          </label>
          <label className="check">
            <input type="checkbox" checked={content.bothEnds !== false} onChange={(e) => set({ bothEnds: e.target.checked })} />
            Both ends of each cord
          </label>
        </fieldset>

        <fieldset className="sheet-parts">
          <legend>Paper</legend>
          <label className="field wide-field">
            <span>Format</span>
            <select aria-label="Format" value={format} onChange={(e) => set({ format: e.target.value as Format })}>
              {(Object.keys(STOCKS) as StockId[]).map((s) => (
                <option key={s} value={s}>
                  {STOCKS[s].name}
                </option>
              ))}
              <option value="maker">Label maker (one line each)</option>
            </select>
          </label>
          {format === 'custom' && (
            <>
              <label className="field">
                <span>Width in</span>
                <input type="number" min={0.5} max={8} step={0.125} value={customW} onChange={(e) => set({ customW: Math.min(8, Math.max(0.5, Number(e.target.value) || 2.5)) })} />
              </label>
              <label className="field">
                <span>Height in</span>
                <input type="number" min={0.3} max={4} step={0.125} value={customH} onChange={(e) => set({ customH: Math.min(4, Math.max(0.3, Number(e.target.value) || 0.75)) })} />
              </label>
            </>
          )}
          {sheet && (
            <label className="field">
              <span>Start at label #</span>
              <input type="number" min={1} max={perSheet} value={startAt} onChange={(e) => setStartAt(Number(e.target.value) || 1)} aria-label="Start at label number" />
            </label>
          )}
          {canFlag && (
            <label className="check">
              <input type="checkbox" checked={flag} onChange={(e) => set({ flag: e.target.checked })} />
              Flag: text on both halves, folds around the cord
            </label>
          )}
          {stock && (
            <label className="check">
              <input type="checkbox" checked={bigText} onChange={(e) => set({ bigText: e.target.checked })} />
              Bigger text
            </label>
          )}
        </fieldset>

        <fieldset className="sheet-parts">
          <legend>What they say</legend>
          <label className="field">
            <span>Cords</span>
            <select aria-label="Cord labels show" value={content.cordLine} onChange={(e) => set({ cordLine: e.target.value as Saved['cordLine'] })}>
              <option value="length">Length (25 ft)</option>
              <option value="name">Name (green cord)</option>
            </select>
          </label>
          <label className="field">
            <span>Lights and props</span>
            <select aria-label="Light labels show" value={content.lightLine} onChange={(e) => set({ lightLine: e.target.value as Saved['lightLine'] })}>
              <option value="where">Where they go</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={!!content.route} onChange={(e) => set({ route: e.target.checked })} />
            Where it plugs in
          </label>
          <label className="check">
            <input type="checkbox" checked={!!content.storage} onChange={(e) => set({ storage: e.target.checked })} />
            Storage spot
          </label>
        </fieldset>

        <fieldset className="sheet-parts ties-opts">
          <legend>Zip ties (optional)</legend>
          <label className="check">
            <input type="checkbox" checked={!!marks.colors} onChange={(e) => onMarks({ ...marks, colors: e.target.checked })} />
            A colour for each outlet
          </label>
          <label className="check">
            <input type="checkbox" checked={!!marks.stories} onChange={(e) => onMarks({ ...marks, stories: e.target.checked })} />
            One tie per story (1 = first floor, 2 = second story)
          </label>
        </fieldset>

        <p className="ls-prep" role="status">
          <b>
            {prep.labels} label{prep.labels === 1 ? '' : 's'}
          </b>
          {sheet && labels.length > 0 && ` on ${pages.length} sheet${pages.length === 1 ? '' : 's'}`}
          {prep.ties.length > 0 && (
            <>
              {' · zip ties: '}
              {prep.ties.map((t, i) => (
                <span key={t.color || 'plain'}>
                  {i ? ', ' : ''}
                  {t.count} {t.color ? tieName(t.color).toLowerCase() : 'plain'}
                </span>
              ))}
            </>
          )}
        </p>

        <details className="ls-setup" open={!!scopeItem}>
          <summary>Set up: which items, where things go, label text{marks.stories ? ', stories' : ''}{marks.colors ? ', outlet colours' : ''}</summary>
          <p className="muted small">Untick an item to leave it out. Lights and props show where they go, cords their length; "Label text" replaces either. Changes save to the plan.</p>
          {groups.map((g) => (
            <section key={g.root.id} className="ls-group" aria-label={g.root.kind === 'outlet' ? clusterTitle(display, g.root.id) : 'Not plugged in yet'}>
              <h3>
                <span>{g.root.kind === 'outlet' ? clusterTitle(display, g.root.id) : 'Not plugged in yet'}</span>
                {marks.colors && g.root.kind === 'outlet' && (
                  <label className="ls-color">
                    <span className="tie-swatch" style={{ background: tieHex(g.root.tieColor) ?? 'transparent' }} aria-hidden="true" />
                    <select aria-label={`Zip-tie colour for ${g.root.id}`} value={g.root.tieColor ?? ''} onChange={(e) => onPatch(g.root.id, { tieColor: e.target.value || undefined })}>
                      <option value="">No colour</option>
                      {TIE_COLORS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </h3>
              <ul>
                {g.members.map((id) => {
                  const n = display.nodes[id];
                  return (
                    <li key={id} className={`ls-row${n.labelSkip ? ' skipped' : ''}`}>
                      <label className="ls-name">
                        <input type="checkbox" checked={!n.labelSkip} onChange={(e) => onPatch(id, { labelSkip: e.target.checked ? undefined : true })} aria-label={`Label ${id}`} />
                        <b className="dn-id">{id}</b> {n.label}
                        {n.labelPrinted && <span className="pill">printed</span>}
                      </label>
                      {n.kind === 'cord' ? (
                        <Inline
                          type="number"
                          label={`Length of ${id} in feet`}
                          placeholder="ft"
                          value={n.lengthFt !== undefined ? String(Math.round(n.lengthFt)) : ''}
                          onCommit={(v) => onPatch(id, { lengthFt: v && Number(v) > 0 ? Number(v) : undefined, lengthApprox: undefined })}
                        />
                      ) : (
                        <Inline label={`Where ${id} goes`} placeholder="Where: garage peak, left bush…" value={n.location ?? ''} onCommit={(v) => onPatch(id, { location: v || undefined })} />
                      )}
                      <Inline label={`Label text for ${id}`} placeholder="Label text (optional)" value={n.labelText ?? ''} onCommit={(v) => onPatch(id, { labelText: v || undefined })} />
                      {marks.stories && (
                        <span className="seg ls-story" role="group" aria-label={`Story for ${id}`}>
                          {[1, 2, 3].map((k) => (
                            <button key={k} type="button" aria-pressed={(n.story ?? 1) === k} className={(n.story ?? 1) === k ? 'on' : ''} onClick={() => onPatch(id, { story: k === 1 ? undefined : k })} title={`${storyName(k)} story`}>
                              {k}
                            </button>
                          ))}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {!groups.length && <p className="muted">Nothing here: try “All” or “Everything”.</p>}
        </details>

        <div className="labels-actions">
          {format === 'maker' ? (
            <>
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void navigator.clipboard?.writeText(plain).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }
              >
                {copied ? 'Copied' : 'Copy all as text'}
              </button>
              <button
                type="button"
                onClick={() =>
                  onDownloadCsv(
                    toCsv([['label', 'id', 'line2', 'zip ties', 'where', 'storage'], ...labels.map((l) => [l.text, l.id, l.sub, tiesText(l.ties), l.route ?? '', l.storage ?? ''])]),
                  )
                }
              >
                Download CSV for label software
              </button>
            </>
          ) : (
            <button type="button" className="primary" onClick={() => window.print()} disabled={!labels.length}>
              🖨 Print
            </button>
          )}
          <button type="button" disabled={!printedIds.length} onClick={() => onPatchMany(printedIds, { labelPrinted: true })}>
            ✓ Mark these as printed
          </button>
          <span className="muted small">
            {sheet
              ? 'Print at 100% (actual size), margins: default. Try a plain sheet first and hold it over the labels.'
              : isFlag
                ? 'Cut out, fold around the cord so the two halves meet, and tape.'
                : format === 'maker'
                  ? ''
                  : 'Cut along the lines.'}
          </span>
        </div>
      </div>

      {format === 'maker' ? (
        <pre className="labels-maker" aria-label="Label maker text">
          {labels.length ? labels.map((l) => `${l.text}${l.ties ? `   (${tiesText(l.ties)})` : ''}`).join('\n') : 'Nothing to label yet.'}
        </pre>
      ) : sheet ? (
        <div className="label-sheets print-area" style={style} aria-label="Labels to print">
          {pages.map((cells, p) => (
            <div
              key={p}
              className="label-sheet"
              style={{ padding: `${sheet.top}in 0 0 ${sheet.left}in`, gridTemplateColumns: `repeat(${sheet.cols}, var(--lw))`, gridAutoRows: 'var(--lh)', columnGap: `${sheet.gapX}in` }}
            >
              {cells.map((l, i) => (l ? <LabelBox key={`${l.key}-${p}-${i}`} l={l} flag={isFlag} tall={tall} /> : <div key={`blank-${i}`} className="label blank" aria-hidden="true" />))}
            </div>
          ))}
        </div>
      ) : (
        <div className="labels-grid sized print-area" style={style} aria-label="Labels to print">
          {labels.map((l) => (
            <LabelBox key={l.key} l={l} flag={isFlag} tall={tall} />
          ))}
        </div>
      )}
    </div>
  );
}
