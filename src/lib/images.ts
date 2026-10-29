async function encode(file: File, maxEdge: number, maxBytes: number, aspect?: number) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('IMAGE_TYPE');
  if (file.size > 15 * 1024 * 1024) throw new Error('IMAGE_SIZE');
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const w=aspect?Math.min(image.width,image.height*aspect):image.width, h=aspect?w/aspect:image.height;
    let scale = Math.min(1, maxEdge / Math.max(w, h));
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('IMAGE_ENCODE');
      ctx.drawImage(image, (image.width-w)/2, (image.height-h)/2, w, h, 0, 0, canvas.width, canvas.height);
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

export async function prepareProfileImage(file:File,purpose:"avatar"|"cover") {
 const aspect=purpose==="avatar"?1:450/276,originalLimit=(purpose==="avatar"?72:150)*1024,thumbnailLimit=(purpose==="avatar"?28:50)*1024;
 return {original_display:await encode(file,1280,originalLimit,aspect),thumbnail:await encode(file,480,thumbnailLimit,aspect)};
}
