import { preparePhoto } from './images';
import { serverRequest, supabase } from './supabase';

export type PhotoDraft = { key: string; asset_id?: string; file?: File; url?: string };
export type UploadedPhotos = Map<string, string>;

export async function uploadDraftPhotos(animalId: string, photos: PhotoDraft[], uploaded: UploadedPhotos, allocated: Set<string>, progress: (text: string) => void) {
  const selectedKeys = new Set(photos.map(photo => photo.key));
  const selectedAssets = new Set(photos.flatMap(photo => photo.asset_id ? [photo.asset_id] : []));
  const obsolete = [...uploaded].filter(([key]) => !selectedKeys.has(key));
  // Completed uploads from a failed earlier attempt can outlive their local file draft.
  // Queue them before reserving replacements; their bytes remain charged until safe cleanup.
  await queuePhotoCleanup(obsolete.map(([, id]) => id).filter(id => !selectedAssets.has(id)));
  for (const [key] of obsolete) uploaded.delete(key);
  const assets: string[] = [];
  for (const [index, photo] of photos.entries()) {
    if (photo.asset_id) { assets.push(photo.asset_id); continue; }
    const cached = uploaded.get(photo.key);
    if (cached) { assets.push(cached); continue; }
    if (!photo.file) throw new Error('VALIDATION_FAILED');
    progress(`사진 ${index + 1}/${photos.length} 준비 중`);
    const encoded = await preparePhoto(photo.file);
    const reservation = await serverRequest<{ asset_id: string; objects: { path: string; variant: keyof typeof encoded; token: string }[] }>('/api/uploads', { animal_id: animalId, editing: true });
    allocated.add(reservation.asset_id);
    for (const object of reservation.objects) {
      const { error } = await supabase.storage.from('animal-media').uploadToSignedUrl(object.path, object.token, encoded[object.variant], { contentType: 'image/webp', upsert: false });
      if (error) throw error;
    }
    await serverRequest(`/api/uploads/${reservation.asset_id}/complete`, {});
    uploaded.set(photo.key, reservation.asset_id);
    assets.push(reservation.asset_id);
  }
  return assets;
}

export async function queuePhotoCleanup(assets: Iterable<string>) {
  for (const id of assets) {
    try { await serverRequest(`/api/uploads/${id}/cancel`, {}); }
    catch (error) { if (!String(error).includes('NOT_FOUND')) throw error; }
  }
}
