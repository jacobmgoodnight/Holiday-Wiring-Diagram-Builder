/**
 * End-to-end encryption for sync (WebCrypto, no libraries). From the sync code, HKDF-SHA-256
 * derives a lookup id (the only thing the server can see, besides scrambled data) and an
 * AES-GCM 256 key. Each blob: version, flags, a fresh 12-byte IV, then the ciphertext, bound
 * to what it is ("doc", "photo:<id>") so blobs cannot be swapped. Documents are gzipped first.
 */
import { parseSyncCode } from './code';

const enc = new TextEncoder();
const SALT = enc.encode('holiday-wiring-diagram/sync/v1');
const VERSION = 1;
const GZIP = 1;

export interface SyncKeys {
  /** 64 hex characters: where the cloud copy lives. */
  lookup: string;
  key: CryptoKey;
}

export async function deriveKeys(code: string): Promise<SyncKeys> {
  const bytes = parseSyncCode(code);
  if (!bytes) throw new Error('That is not a sync code');
  const base = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode('lookup') }, base, 256);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode('encrypt') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const lookup = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { lookup, key };
}

async function gzip(data: Uint8Array<ArrayBuffer>, direction: 'compress' | 'decompress'): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(direction === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Encrypt bytes for `context` ("doc", "photo:ph-1"); compress first when asked and possible. */
export async function seal(keys: SyncKeys, data: Uint8Array<ArrayBuffer>, context: string, compress = false): Promise<string> {
  const zip = compress && typeof CompressionStream !== 'undefined';
  const body = zip ? await gzip(data, 'compress') : data;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, keys.key, body));
  const out = new Uint8Array(2 + iv.length + ct.length);
  out.set([VERSION, zip ? GZIP : 0]);
  out.set(iv, 2);
  out.set(ct, 2 + iv.length);
  return toBase64(out);
}

/** Decrypt what `seal` made for the same context; throws if the code or context is wrong. */
export async function open(keys: SyncKeys, b64: string, context: string): Promise<Uint8Array<ArrayBuffer>> {
  const all = fromBase64(b64);
  if (all[0] !== VERSION) throw new Error('This cloud copy was made by a newer version of the app');
  const iv = all.subarray(2, 14);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, keys.key, all.subarray(14)));
  return all[1] & GZIP ? gzip(plain, 'decompress') : plain;
}

export const sealJson = (keys: SyncKeys, value: unknown, context: string) => seal(keys, enc.encode(JSON.stringify(value)), context, true);
export const openJson = async <T>(keys: SyncKeys, b64: string, context: string): Promise<T> => JSON.parse(new TextDecoder().decode(await open(keys, b64, context))) as T;
