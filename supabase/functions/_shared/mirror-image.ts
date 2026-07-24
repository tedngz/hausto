// Normalises an image for storage: caps the longest edge and re-encodes as
// JPEG, but only keeps the result when it's actually smaller than the source.
// Oversized listing photos were the bulk of our egress - a 2.4 MB hero shrinks
// to ~250-470 KB here, and every repeat view after that is that much lighter.
//
// Undecodable inputs (webp, the occasional progressive/CMYK JPEG imagescript
// can't read) and already-small images pass straight through unchanged, so this
// never breaks a mirror and never inflates a file.
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

const MAX_STORE_EDGE = 1600;
const STORE_JPEG_QUALITY = 78;

export interface PreparedImage {
  bytes: Uint8Array;
  contentType: string;
  ext: string;
}

function passthrough(bytes: Uint8Array, sourceContentType: string): PreparedImage {
  const ct = (sourceContentType || 'image/jpeg').toLowerCase();
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
  return { bytes, contentType: ct, ext };
}

export async function prepareForStorage(
  bytes: Uint8Array,
  sourceContentType: string,
): Promise<PreparedImage> {
  try {
    const img = await Image.decode(bytes);
    const longest = Math.max(img.width, img.height);
    if (longest > MAX_STORE_EDGE) {
      const scale = MAX_STORE_EDGE / longest;
      img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
    }
    const jpeg = await img.encodeJPEG(STORE_JPEG_QUALITY);
    if (jpeg.length < bytes.length) {
      return { bytes: jpeg, contentType: 'image/jpeg', ext: 'jpg' };
    }
    return passthrough(bytes, sourceContentType);
  } catch {
    return passthrough(bytes, sourceContentType);
  }
}
