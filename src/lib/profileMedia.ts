import {prepareProfileImage} from './images';
import {rpc,serverRequest,supabase} from './supabase';
export type ImagePurpose='avatar'|'cover';
export type ProfileUpload={purpose:ImagePurpose;request_id:string;file:File;asset_id?:string;ready?:boolean;attempted?:boolean;encoded?:Awaited<ReturnType<typeof prepareProfileImage>>;uploaded:Set<string>};
export function newProfileUpload(purpose:ImagePurpose,file:File):ProfileUpload{return {purpose,file,request_id:crypto.randomUUID(),uploaded:new Set()};}
export async function cancelProfileUpload(v:ProfileUpload){if(!v.attempted)return;await serverRequest('/api/profile/uploads/cancel-request',{purpose:v.purpose,request_id:v.request_id});}
export async function uploadProfileImage(v:ProfileUpload,retryExpired=true):Promise<string>{
 if(v.ready&&v.asset_id){const rows=await rpc<{id:string;valid:boolean}[]>('profile_upload_state',{p_assets:[v.asset_id]});if(rows[0]?.valid)return v.asset_id;await cancelProfileUpload(v);v.request_id=crypto.randomUUID();v.asset_id=undefined;v.ready=false;v.uploaded.clear();}
 v.encoded??=await prepareProfileImage(v.file,v.purpose);
 v.attempted=true;
 let m:{asset_id:string;ready:boolean;objects:{path:string;variant:keyof NonNullable<ProfileUpload['encoded']>;token?:string;stored?:boolean}[]};
 try{m=await serverRequest<{asset_id:string;ready:boolean;objects:{path:string;variant:keyof NonNullable<ProfileUpload['encoded']>;token?:string;stored?:boolean}[]}>('/api/profile/uploads',{purpose:v.purpose,request_id:v.request_id});}catch(error){if(!retryExpired||!String(error).includes('REQUEST_EXPIRED'))throw error;await cancelProfileUpload(v);v.request_id=crypto.randomUUID();v.asset_id=undefined;v.ready=false;v.uploaded.clear();v.attempted=false;return uploadProfileImage(v,false);}
 v.asset_id=m.asset_id;
 if(!m.ready){
  for(const o of m.objects){if(v.uploaded.has(o.variant))continue;if(o.stored){v.uploaded.add(o.variant);continue;}if(!o.token)throw Error('UPLOAD_INCOMPLETE');const {error}=await supabase.storage.from('animal-media').uploadToSignedUrl(o.path,o.token,v.encoded[o.variant],{contentType:'image/webp',upsert:false});
   // A lost upload response can leave a create-only object present. A duplicate is
   // reconciled by the server's complete byte/dimension/hash inspection below.
   if(error&&!/already exists|duplicate|409/i.test(error.message))throw error;
   v.uploaded.add(o.variant);
  }
  await serverRequest(`/api/uploads/${m.asset_id}/complete`,{});
 }
 v.ready=true;return m.asset_id;
}
export async function retryProfileCleanup(){const ids=await rpc<string[]>('pending_profile_uploads');for(const id of ids)await serverRequest(`/api/uploads/${id}/cancel`,{});}
