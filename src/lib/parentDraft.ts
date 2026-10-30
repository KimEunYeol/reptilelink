import {preparePhoto} from './images';
import {serverRequest,supabase} from './supabase';
import {likeRequestExpired} from './likes';
import {parentRoles,parentLabels,type ParentAssets,type ParentRole} from './parents';
import {queuePhotoCleanup,type PhotoDraft} from './photoDraft';

export type ParentDraft = Record<ParentRole,PhotoDraft|null>;
export type ParentUpload = {
  animal_id:string;role:ParentRole;request_id:string;file:File;asset_id?:string;attempted:boolean;
  started:number;wallStarted:number;uploaded:Set<string>;encoded?:Awaited<ReturnType<typeof preparePhoto>>;
};
export function parentDraft(assets:ParentAssets):ParentDraft {
  return {father:assets.father?{key:assets.father,asset_id:assets.father}:null,mother:assets.mother?{key:assets.mother,asset_id:assets.mother}:null};
}
export function parentDraftKeys(draft:ParentDraft){return parentRoles.map(role=>draft[role]?.key??null);}
export async function cancelParentUpload(upload:ParentUpload) {
  if(upload.attempted){await serverRequest('/api/parent/uploads/cancel-request',{animal_id:upload.animal_id,role:upload.role,request_id:upload.request_id});if(upload.asset_id)await queuePhotoCleanup([upload.asset_id]);}
}
export async function cleanupParentUploads(uploads:Map<string,ParentUpload>,retained:Set<string>) {
  for(const upload of uploads.values())if(!upload.asset_id||!retained.has(upload.asset_id))await cancelParentUpload(upload);
}
async function uploadParent(upload:ParentUpload,retryExpired=true):Promise<string> {
  if(likeRequestExpired(upload.started,performance.now(),upload.wallStarted,Date.now()))throw Error('REQUEST_EXPIRED');
  upload.encoded??=await preparePhoto(upload.file);
  upload.attempted=true;
  let manifest:{asset_id:string;ready:boolean;objects:{path:string;variant:keyof NonNullable<ParentUpload['encoded']>;token?:string;stored?:boolean}[]};
  try{manifest=await serverRequest('/api/parent/uploads',{animal_id:upload.animal_id,role:upload.role,request_id:upload.request_id});}
  catch(error){
    if(!retryExpired||!String(error).includes('REQUEST_EXPIRED'))throw error;
    // Only an explicit retry before a save can replace an expired staging set.
    // A concurrent committed binding makes cancellation fail instead of deleting that photo.
    await cancelParentUpload(upload);upload.request_id=crypto.randomUUID();upload.asset_id=undefined;upload.uploaded.clear();upload.attempted=false;
    return uploadParent(upload,false);
  }
  upload.asset_id=manifest.asset_id;
  if(!manifest.ready){
    for(const object of manifest.objects){
      if(upload.uploaded.has(object.variant))continue;
      if(object.stored){upload.uploaded.add(object.variant);continue;}
      if(!object.token)throw Error('UPLOAD_INCOMPLETE');
      const {error}=await supabase.storage.from('animal-media').uploadToSignedUrl(object.path,object.token,upload.encoded[object.variant],{contentType:'image/webp',upsert:false});
      if(error&&!/already exists|duplicate|409/i.test(error.message))throw error;
      upload.uploaded.add(object.variant);
    }
    await serverRequest(`/api/uploads/${manifest.asset_id}/complete`,{});
  }
  return manifest.asset_id;
}
export async function uploadDraftParents(animalId:string,draft:ParentDraft,uploads:Map<string,ParentUpload>,progress:(message:string)=>void):Promise<ParentAssets> {
  const selected=new Set(parentDraftKeys(draft)),retained=new Set(parentRoles.flatMap(role=>draft[role]?.asset_id?[draft[role]!.asset_id!]:[]));
  for(const [key,upload] of uploads)if(!selected.has(key)){if(!upload.asset_id||!retained.has(upload.asset_id))await cancelParentUpload(upload);uploads.delete(key);}
  const result:ParentAssets={father:null,mother:null};
  for(const role of parentRoles){
    const photo=draft[role];if(!photo)continue;if(photo.asset_id){result[role]=photo.asset_id;continue;}
    if(!photo.file)throw Error('VALIDATION_FAILED');
    let upload=uploads.get(photo.key);
    if(!upload){upload={animal_id:animalId,role,file:photo.file,request_id:crypto.randomUUID(),attempted:false,uploaded:new Set(),started:performance.now(),wallStarted:Date.now()};uploads.set(photo.key,upload);}
    progress(`${parentLabels[role]} 사진을 준비하고 있어요.`);result[role]=await uploadParent(upload);
  }
  return result;
}
