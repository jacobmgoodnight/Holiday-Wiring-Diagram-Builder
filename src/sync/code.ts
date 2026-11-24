/**
 * Sync codes: 120 random bits written as 24 easy-to-read characters (Crockford base 32: no
 * I, L, O or U), in groups of four, e.g. "7KQM-2XRD-…". The code is the only secret: it
 * finds the cloud copy and unlocks it, and it never leaves your devices.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_BYTES = 15;

export function formatCode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

/** A fresh random sync code. */
export function newSyncCode(): string {
  return formatCode(crypto.getRandomValues(new Uint8Array(CODE_BYTES)));
}

/** The code's bytes, forgiving spaces, dashes, lower case and look-alikes (O→0, I/L→1). */
export function parseSyncCode(input: string): Uint8Array<ArrayBuffer> | undefined {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 24 || [...s].some((c) => !ALPHABET.includes(c))) return undefined;
  const out = new Uint8Array(CODE_BYTES);
  let bits = 0;
  let value = 0;
  let i = 0;
  for (const c of s) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}

/** The code tidied into its usual form (or undefined when it is not a valid code). */
export const normalizeCode = (input: string) => {
  const b = parseSyncCode(input);
  return b ? formatCode(b) : undefined;
};
