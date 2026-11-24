import { describe, expect, it } from 'vitest';
import { formatCode, newSyncCode, normalizeCode, parseSyncCode } from './code';
import { deriveKeys, open, openJson, seal, sealJson } from './crypto';

describe('sync codes', () => {
  it('are 24 readable characters in groups of four, and read back forgivingly', () => {
    const code = newSyncCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
    expect(formatCode(parseSyncCode(code)!)).toBe(code);
    expect(normalizeCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
    expect(normalizeCode('0000-0000-0000-0000-0000-000O')).toBe('0000-0000-0000-0000-0000-0000');
    expect(normalizeCode('too short')).toBeUndefined();
    expect(newSyncCode()).not.toBe(code);
  });
});

describe('end-to-end encryption', () => {
  const code = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01';
  it('derives the same lookup and key from the same code, and a different one from another', async () => {
    const a = await deriveKeys(code);
    const b = await deriveKeys(code.toLowerCase());
    expect(a.lookup).toMatch(/^[0-9a-f]{64}$/);
    expect(b.lookup).toBe(a.lookup);
    expect((await deriveKeys('ABCD-EFGH-JKMN-PQRS-TVWX-YZ02')).lookup).not.toBe(a.lookup);
    await expect(deriveKeys('nope')).rejects.toThrow(/not a sync code/);
  });

  it('round-trips documents (compressed) and photos, and refuses the wrong code or context', async () => {
    const keys = await deriveKeys(code);
    const doc = { displays: { d1: { title: 'Christmas 2026', text: 'O01 Porch\n'.repeat(200) } } };
    const sealed = await sealJson(keys, doc, 'doc');
    expect(sealed).not.toContain('Christmas'); // nothing readable on the server
    expect(sealed.length).toBeLessThan(JSON.stringify(doc).length); // compressed
    expect(await openJson(keys, sealed, 'doc')).toEqual(doc);
    const photo = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
    const sp = await seal(keys, photo, 'photo:ph-1');
    expect(await open(keys, sp, 'photo:ph-1')).toEqual(photo);
    await expect(open(keys, sp, 'photo:ph-2')).rejects.toThrow(); // bound to its photo
    await expect(openJson(await deriveKeys('ABCD-EFGH-JKMN-PQRS-TVWX-YZ02'), sealed, 'doc')).rejects.toThrow();
  });
});
