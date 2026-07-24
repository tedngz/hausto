// Perceptual (difference) hash for listing photos, used by the dedupe pass to
// match the same unit across agents regardless of listing text.
// dHash: resize to 9x8 grayscale, compare adjacent pixels -> 64-bit hex.
// Robust to recompression/resizing; no LLM cost.
//
// Takes bytes rather than a URL on purpose: every caller already holds the
// image in memory from the mirroring fetch, and re-downloading it from our own
// public storage URL is metered egress for no gain.
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

export async function dHashFromBytes(bytes: Uint8Array): Promise<string | null> {
  try {
    if (!bytes?.byteLength) return null;
    const img = await Image.decode(bytes);
    const small = img.resize(9, 8);
    // Grayscale luma per pixel
    const gray: number[] = [];
    for (let y = 1; y <= 8; y++) {
      for (let x = 1; x <= 9; x++) {
        const [r, g, b] = Image.colorToRGB(small.getPixelAt(x, y));
        gray.push(0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
    let bits = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const i = row * 9 + col;
        bits += gray[i] < gray[i + 1] ? '1' : '0';
      }
    }
    return BigInt('0b' + bits).toString(16).padStart(16, '0');
  } catch {
    return null;
  }
}
