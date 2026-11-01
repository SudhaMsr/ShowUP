// @ts-check
/**
 * Image intake: validation and downscaling before OCR or vision extraction.
 */

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 1600;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Throws a user-facing Error when the file cannot be used.
 * @param {File|Blob} file
 */
export function checkImage(file) {
  if (!ACCEPTED.includes(file.type)) throw new Error('Please choose a PNG, JPEG or WebP image.');
  if (file.size === 0) throw new Error('That image is empty.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('That image is larger than 15 MB.');
}

/** @param {Blob} blob @returns {Promise<string>} base64 without the data: prefix */
async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/**
 * Scale the longest edge to at most 1600px and re-encode as JPEG, so uploads
 * stay small and OCR stays fast.
 * @param {Blob} blob
 * @returns {Promise<{ blob: Blob, mediaType: 'image/jpeg', base64: string, width: number, height: number }>}
 */
export async function downscale(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('I could not read that image. Try a PNG or JPEG screenshot.');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Image processing is unavailable in this browser.');
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!out) throw new Error('Image processing failed.');
  const jpeg = /** @type {Blob} */ (out);
  return { blob: jpeg, mediaType: 'image/jpeg', base64: await toBase64(jpeg), width, height };
}
