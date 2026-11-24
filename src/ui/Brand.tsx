import { BRAND } from '../brand';

/** Logo and name for the top bar (just the logo on phones). */
export function Brand() {
  return (
    <span className="brand" title={`${BRAND.name}: ${BRAND.tagline}`}>
      <img className="brand-logo" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
      <span className="brand-name">
        Plug &amp; <span className="brand-glow">Glow</span>
      </span>
    </span>
  );
}
