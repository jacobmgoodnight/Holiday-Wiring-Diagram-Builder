import { TONE_COLORS } from '../diagram/svg';
import { Sheet } from './Sheet';

const KEYS: [string, string][] = [
  ['Tab', 'Plug something into the selected item'],
  ['Enter', 'Add another item next to it (same parent)'],
  ['Ctrl/⌘ + D', 'Duplicate it'],
  ['F2 or double-click', 'Rename it on the diagram'],
  ['← → ↑ ↓', 'Move to what it plugs into, its first item, or the item above/below'],
  ['Space', 'Fold or unfold what is plugged into it'],
  ['Delete', 'Delete it (what was plugged in stays, unplugged)'],
  ['/', 'Find an item'],
  ['Ctrl/⌘ + Z, Shift + Z', 'Undo, redo'],
  ['Esc', 'Deselect or cancel'],
];

const TONES: [keyof typeof TONE_COLORS, string][] = [
  ['power', 'Outlets, plugs, cords, splitters'],
  ['load', 'Lights and props'],
  ['media', 'Controllers, projectors, media, totes'],
  ['new', 'New this year'],
  ['unused', 'Unused socket (tap to fill)'],
];

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Shortcuts and colours" onClose={onClose}>
      <h3>Colours</h3>
      <ul className="legend">
        {TONES.map(([t, text]) => (
          <li key={t}>
            <span className="swatch" style={{ background: TONE_COLORS[t].fill, borderColor: TONE_COLORS[t].stroke, borderStyle: t === 'unused' ? 'dashed' : 'solid' }} />
            {text}
          </li>
        ))}
        <li>
          <span className="swatch line" />
          Dashed purple line: signal (HDMI, BLE, Wi-Fi), not power
        </li>
      </ul>
      <h3>Keyboard (select an item first)</h3>
      <table className="keys">
        <tbody>
          {KEYS.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">
                <kbd>{k}</kbd>
              </th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">On a phone: tap an item for its actions, tap an unused socket to fill it, pinch to zoom.</p>
    </Sheet>
  );
}
