import type { CallImage } from './generate';

/**
 * A pasted screenshot, decoded from the data URL the browser sends.
 *
 * The media type is taken from the file's own first bytes, not from the label
 * on the data URL: the label is whatever the client wrote, and the AI vendors
 * reject an image whose declared type does not match its contents.
 */
export interface DecodedImage {
  mediaType: CallImage['mediaType'];
  data: Buffer;
}

/** Per image, after decoding. The browser shrinks screenshots well below this. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Per question. */
export const MAX_IMAGES = 3;

/** Base64 is 4/3 the size of the bytes, plus the `data:...;base64,` prefix. */
export const MAX_IMAGE_DATA_URL_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64;

const DATA_URL = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/;

function sniff(b: Buffer): CallImage['mediaType'] | null {
  if (b.length >= 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** The image, or a message saying why it was refused. */
export function decodeImageDataUrl(value: string): DecodedImage | string {
  const m = DATA_URL.exec(value);
  if (!m) return 'An attachment is not an image';
  const data = Buffer.from(m[1], 'base64');
  if (data.length > MAX_IMAGE_BYTES) return 'A screenshot is too large (2 MB at most)';
  const mediaType = sniff(data);
  if (!mediaType) return 'Screenshots must be PNG, JPEG, WebP or GIF';
  return { mediaType, data };
}
