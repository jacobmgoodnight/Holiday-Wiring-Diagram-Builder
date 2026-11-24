import { type Ties, tieHex, tiesText } from '../export/labels';

/** Zip ties as dots: their colour (or outlined when there is none), one per tie. */
/** `trailing`: a space after the dots (so text next to them reads the same with or without). */
export function TieDots({ ties, trailing }: { ties?: Ties; trailing?: boolean }) {
  if (!ties) return null;
  const hex = tieHex(ties.color);
  return (
    <span className="tie-dots" role="img" aria-label={tiesText(ties)} title={tiesText(ties)}>
      {Array.from({ length: Math.min(ties.count, 4) }, (_, i) => (
        <i key={i} style={hex ? { background: hex } : undefined} className={hex ? '' : 'none'} />
      ))}
      {trailing && ' '}
    </span>
  );
}
