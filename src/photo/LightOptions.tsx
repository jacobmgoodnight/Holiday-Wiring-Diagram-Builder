import { useEffect, useRef } from 'react';
import { PALETTES, WARM, WIRE_COLORS, paletteOf } from './geometry';
import { SPACINGS } from './lightOpts';
import type { LightOpts } from './lightOpts';

export { type LightOpts, SPACINGS, lightOptsOf, lightPatch } from './lightOpts';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const asHex = (c: string | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : WARM);

interface Props {
  value: LightOpts;
  onChange: (patch: Partial<LightOpts>) => void;
  /** Lit bushes are always rounded: no smooth-curve switch. */
  area?: boolean;
}

export function LightOptions({ value, onChange, area }: Props) {
  const pal = paletteOf(value.bulbColors) ?? 'custom';
  // The colour picker fires on every drag step: only take its final choice.
  const picker = useRef<HTMLInputElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const on = () => change.current({ bulbColors: [el.value] });
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, []);
  return (
    <div className="light-opts" role="group" aria-label="Light options">
      <label className="lo">
        <span className="lo-name">Bulbs</span>
        <span className="swatches" aria-hidden="true">
          {value.bulbColors.slice(0, 5).map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
        <select
          aria-label="Bulb colors"
          value={pal}
          onChange={(e) => {
            const p = PALETTES.find((x) => x.id === e.target.value);
            if (p) onChange({ bulbColors: p.colors });
          }}
        >
          {PALETTES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {pal === 'custom' && <option value="custom">Custom</option>}
        </select>
      </label>
      <input ref={picker} className="lo-picker" type="color" aria-label="Custom bulb color" title="Any colour" key={value.bulbColors[0]} defaultValue={asHex(value.bulbColors[0])} />
      <label className="lo">
        <span className="lo-name">Spacing</span>
        <select aria-label="Bulb spacing" value={value.spacingIn} onChange={(e) => onChange({ spacingIn: Number(e.target.value) })}>
          {[...new Set([...SPACINGS, value.spacingIn])]
            .sort((a, b) => a - b)
            .map((s) => (
              <option key={s} value={s}>
                {s}″
              </option>
            ))}
        </select>
      </label>
      <label className="lo">
        <span className="lo-name">Wire</span>
        <select aria-label="Wire color" value={value.wireColor} onChange={(e) => onChange({ wireColor: e.target.value })}>
          {WIRE_COLORS.map((w) => (
            <option key={w} value={w}>
              {cap(w)}
            </option>
          ))}
        </select>
      </label>
      {!area && (
        <label className="check">
          <input type="checkbox" checked={value.smooth} onChange={(e) => onChange({ smooth: e.target.checked })} />
          Smooth curves
        </label>
      )}
    </div>
  );
}
