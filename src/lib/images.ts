async function encode(file: File, maxEdge: number, maxBytes: number) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('IMAGE_TYPE');
  if (file.size > 15 * 1024 * 1024) throw new Error('IMAGE_SIZE');
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    let scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('IMAGE_ENCODE');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.type === 'image/webp' && blob.size <= maxBytes) return blob;
      }
      scale *= 0.75;
    }
    throw new Error('IMAGE_SIZE');
  } finally { image.close(); }
}
export async function preparePhoto(file: File) {
  return { original_display: await encode(file, 1280, 220 * 1024), thumbnail: await encode(file, 480, 80 * 1024) };
}
