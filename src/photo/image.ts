/** Browser-side photo handling: shrink camera photos before storing them. */
import { fitWithin } from './geometry';

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Decode, shrink to at most 2048 px on the long side, and re-encode as JPEG. */
export async function prepareImage(source: Blob): Promise<PreparedImage> {
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const nw = img.naturalWidth || 1600;
    const nh = img.naturalHeight || 1000;
    const { width, height } = fitWithin(nw, nh);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot process photos.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Could not save the photo.');
    return { blob, width, height };
  } catch (e) {
    throw e instanceof Error && e.message.startsWith('Could') ? e : new Error('That file could not be opened as a photo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBlob(base64: string, type: string): Blob {
  const bin = atob(base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}
