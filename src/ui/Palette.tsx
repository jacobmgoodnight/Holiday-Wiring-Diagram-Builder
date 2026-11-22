import { PRESET_MIME } from '../diagram/Diagram';
import { PRESETS, type Preset, presetById } from '../presets/presets';
import { getFavorites, getRecent } from '../presets/prefs';

interface Props {
  selectedId?: string;
  custom: Preset[];
  onPick: (preset: Preset) => void;
}

/** Desktop palette: drag a preset onto a socket or item, or click to plug it into the selected item. */
export function Palette({ selectedId, custom, onPick }: Props) {
  const first = [...new Set([...getFavorites(), ...getRecent()])].map((id) => presetById(id, custom)).filter((p): p is Preset => !!p);
  const list = [...first, ...[...custom, ...PRESETS].filter((p) => !first.includes(p))];
  return (
    <div className="palette" aria-label="Palette">
      <span className="palette-hint">{selectedId ? `Click to plug into ${selectedId}, or drag onto a socket` : 'Drag onto a socket'}</span>
      {list.map((p) => (
        <button
          key={p.id}
          type="button"
          className="pal"
          draggable
          title={p.name}
          aria-label={selectedId ? `Plug ${p.name} into ${selectedId}` : `${p.name} (drag onto a socket)`}
          onDragStart={(e) => {
            e.dataTransfer.setData(PRESET_MIME, p.id);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => selectedId && onPick(p)}
        >
          <span aria-hidden="true">{p.icon}</span>
          {p.name}
        </button>
      ))}
    </div>
  );
}
