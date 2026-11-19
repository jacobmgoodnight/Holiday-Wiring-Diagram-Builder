/** Browser-side downloads for the diagram. The SVG itself comes from the pure layoutToSvg. */

export function fileSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'display';
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadSvg(svg: string, title: string) {
  download(new Blob([svg], { type: 'image/svg+xml' }), `${fileSlug(title)}.svg`);
}

/** Safari refuses canvases above ~16.7 million pixels, so large diagrams get a lower scale. */
export function pngScale(width: number, height: number, preferred = 2, maxPixels = 16_000_000): number {
  return Math.max(0.25, Math.min(preferred, Math.sqrt(maxPixels / Math.max(1, width * height))));
}

export async function downloadPng(svg: string, title: string): Promise<void> {
  const size = /width="(\d+)" height="(\d+)"/.exec(svg);
  const w = Number(size?.[1] ?? 800);
  const h = Number(size?.[2] ?? 600);
  const scale = pngScale(w, h);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the diagram image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not create the PNG');
    download(blob, `${fileSlug(title)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
