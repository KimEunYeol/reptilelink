import { preparePhoto } from './images';
import { serverRequest, supabase } from './supabase';
import {likeRequestExpired} from './likes';
export type PhotoDraft = { key: string; asset_id?: string; file?: File; url?: string };
export type UploadedPhotos = Map<string, string>;
type SelfUpload={animal:string;request:string;file:File;attempted:boolean;asset?:string;started:number;wallStarted:number;uploaded:Set<string>;encoded?:Awaited<ReturnType<typeof preparePhoto>>};
// One weakly owned state per live editor's photo map; no persistent/global UUID cache.
const states=new WeakMap<UploadedPhotos,Map<string,SelfUpload>>();
function uploadsFor(uploaded:UploadedPhotos){let rows=states.get(uploaded);if(!rows){rows=new Map();states.set(uploaded,rows);}return rows;}
export function hasSelfUploadAttempts(uploaded:UploadedPhotos){return [...(states.get(uploaded)?.values()??[])].some(value=>value.attempted);}
async function cancelUpload(v:SelfUpload){if(v.attempted){await serverRequest('/api/uploads/cancel-request',{animal_id:v.animal,request_id:v.request});if(v.asset)await queuePhotoCleanup([v.asset]);}}
export async function cleanupSelfUploads(uploaded:UploadedPhotos,retained:Set<string>){
 const rows=uploadsFor(uploaded);
 for(const [key,v]of rows)if(!v.asset||!retained.has(v.asset)){await cancelUpload(v);rows.delete(key);uploaded.delete(key);}
}
export async function uploadDraftPhotos(animalId: string, photos: PhotoDraft[], uploaded: UploadedPhotos, allocated: Set<string>, progress: (text: string) => void) {
 const rows=uploadsFor(uploaded),selectedKeys=new Set(photos.map(p=>p.key)),selectedAssets=new Set(photos.flatMap(p=>p.asset_id?[p.asset_id]:[]));
 for(const [key,v]of rows)if(!selectedKeys.has(key)){if(!v.asset||!selectedAssets.has(v.asset))await cancelUpload(v);rows.delete(key);uploaded.delete(key);}
 const obsolete=[...uploaded].filter(([key])=>!selectedKeys.has(key));
 await queuePhotoCleanup(obsolete.map(([,id])=>id).filter(id=>!selectedAssets.has(id)));for(const [key]of obsolete)uploaded.delete(key);
 const assets:string[]=[];
 for(const [index,photo]of photos.entries()){
  if(photo.asset_id){assets.push(photo.asset_id);continue;}
  if(!photo.file)throw Error('VALIDATION_FAILED');
  let v=rows.get(photo.key);
  if(!v){v={animal:animalId,request:crypto.randomUUID(),file:photo.file,attempted:false,started:performance.now(),wallStarted:Date.now(),uploaded:new Set()};rows.set(photo.key,v);}
  if(v.animal!==animalId)throw Error('NOT_FOUND');
  if(likeRequestExpired(v.started,performance.now(),v.wallStarted,Date.now()))throw Error('REQUEST_EXPIRED');
  progress(`사진 ${index+1}/${photos.length} 준비 중`);v.encoded??=await preparePhoto(v.file);v.attempted=true;
  const manifest=await serverRequest<{asset_id:string;ready:boolean;objects:{path:string;variant:keyof NonNullable<SelfUpload['encoded']>;token?:string;stored?:boolean}[]}>('/api/uploads',{animal_id:animalId,editing:true,request_id:v.request});
  v.asset=manifest.asset_id;allocated.add(v.asset);
  if(!manifest.ready){
   for(const object of manifest.objects){
    if(v.uploaded.has(object.variant))continue;
    if(object.stored){v.uploaded.add(object.variant);continue;}
    if(!object.token)throw Error('UPLOAD_INCOMPLETE');
    const {error}=await supabase.storage.from('animal-media').uploadToSignedUrl(object.path,object.token,v.encoded[object.variant],{contentType:'image/webp',upsert:false});
    if(error&&!/already exists|duplicate|409/i.test(error.message))throw error;
    v.uploaded.add(object.variant);
   }
   await serverRequest(`/api/uploads/${v.asset}/complete`,{});
  }
  uploaded.set(photo.key,v.asset);assets.push(v.asset);
 }
 return assets;
}
export async function queuePhotoCleanup(assets: Iterable<string>) {
 for (const id of assets) {
  try { await serverRequest(`/api/uploads/${id}/cancel`, {}); }
  catch (error) { if (!String(error).includes('NOT_FOUND')) throw error; }
 }
}
