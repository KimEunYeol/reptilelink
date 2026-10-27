export function inspectWebp(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  if (bytes.length < 30 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) throw new Error('INVALID_IMAGE');
  let dimensions: { width: number; height: number } | null = null;
  let codecDimensions: { width: number; height: number } | null = null;
  for (let pos = 12; pos + 8 <= bytes.length;) {
    const kind = tag(pos), size = view.getUint32(pos + 4, true), p = pos + 8;
    if (p + size > bytes.length || !['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP'].includes(kind)) throw new Error('INVALID_IMAGE');
    // Chromium emits a standard color profile on canvas re-encoding. It is not EXIF/XMP.
    if (kind === 'ICCP' && (size === 0 || size > 4096)) throw new Error('INVALID_IMAGE');
    if (kind === 'VP8X' && size >= 10) { if (bytes[p] & 0x02) throw new Error('INVALID_IMAGE'); dimensions = { width: 1 + bytes[p + 4] + (bytes[p + 5] << 8) + (bytes[p + 6] << 16), height: 1 + bytes[p + 7] + (bytes[p + 8] << 8) + (bytes[p + 9] << 16) }; }
    if (kind === 'VP8 ' && size >= 10 && bytes[p + 3] === 0x9d && bytes[p + 4] === 1 && bytes[p + 5] === 0x2a) codecDimensions = { width: view.getUint16(p + 6, true) & 0x3fff, height: view.getUint16(p + 8, true) & 0x3fff };
    if (kind === 'VP8L' && size >= 5 && bytes[p] === 0x2f) {
      const bits = view.getUint32(p + 1, true);
      codecDimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    pos = p + size + (size % 2);
  }
  if (!codecDimensions?.width || !codecDimensions.height) throw new Error('INVALID_IMAGE');
  if (dimensions && (dimensions.width !== codecDimensions.width || dimensions.height !== codecDimensions.height)) throw new Error('INVALID_IMAGE');
  return codecDimensions;
}
