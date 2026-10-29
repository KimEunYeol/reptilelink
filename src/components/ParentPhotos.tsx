import {useRef,useState,type ReactNode} from 'react';
import {Plus} from 'lucide-react';
import {parentRoles,parentLabels,type ParentAssets,type ParentRole} from '../lib/parents';
import type {ParentDraft} from '../lib/parentDraft';

export function ParentPhotoDraft({draft,disabled,onChange,renderPhoto,rememberUrl}:{
  draft:ParentDraft;disabled:boolean;onChange:(role:ParentRole,photo:ParentDraft[ParentRole])=>void;
  renderPhoto:(asset:string)=>ReactNode;rememberUrl:(url:string)=>void;
}){
  const inputs=useRef<Partial<Record<ParentRole,HTMLInputElement|null>>>({});
  const [error,setError]=useState('');
  return <fieldset className="parent-photo-fields" disabled={disabled}><legend className="sr-only">부·모 사진</legend><div className="parent-photos">
    {parentRoles.map(role=>{const photo=draft[role],label=parentLabels[role];return <div className="parent-photo-field" key={role}>
      <div className="parent-photo"><span className={`parent-photo-role ${role}`}>{label}</span>{photo?<div className="parent-photo-image">{photo.file?<img src={photo.url} alt={`${label} 사진 미리보기`}/>:renderPhoto(photo.asset_id!)}</div>:<button type="button" className="parent-photo-add" aria-label={`${label} 사진 선택`} onClick={()=>inputs.current[role]?.click()}><Plus size={28}/></button>}</div>
      {photo&&<div className="parent-photo-controls"><button type="button" className="text-button" aria-label={`${label} 사진 교체`} onClick={()=>inputs.current[role]?.click()}>교체</button><button type="button" className="text-button" aria-label={`${label} 사진 삭제`} onClick={()=>onChange(role,null)}>삭제</button></div>}
      <input type="file" className="sr-only" aria-label={`${label} 사진 파일`} accept="image/jpeg,image/png,image/webp" ref={element=>{inputs.current[role]=element;}} onChange={event=>{
        const file=event.target.files?.[0];event.target.value='';if(!file)return;
        if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024){setError('15MB 이하의 JPG, PNG, WebP 사진을 선택해주세요.');return;}
        const url=URL.createObjectURL(file);rememberUrl(url);onChange(role,{key:crypto.randomUUID(),file,url});setError('');
      }}/>
    </div>;})}
  </div>{error&&<p className="notice" role="alert">{error}</p>}<p className="edit-photo-hint">부·모 사진은 각각 1장입니다. 저장 전에는 변경되지 않습니다.</p></fieldset>;
}

function PublicParentPhoto({role,asset}:{role:ParentRole;asset:string|null}){
  const [failed,setFailed]=useState<string|null>(null),label=parentLabels[role];
  return <figure className="parent-photo"><figcaption className={`parent-photo-role ${role}`}>{label}</figcaption>{asset&&failed!==asset?<img src={`/api/image/${asset}/original_display`} alt={`${label} 사진`} onError={()=>setFailed(asset)}/>:<span className="parent-photo-empty">{asset?'사진을 불러오지 못했습니다.':'사진 없음'}</span>}</figure>;
}
export function PublicParentPhotos({assets}:{assets:ParentAssets}){
  return assets.father||assets.mother?<div className="parent-photos detail-parent-photos" aria-label="부·모 사진">{parentRoles.map(role=><PublicParentPhoto key={role} role={role} asset={assets[role]}/>)}</div>:null;
}
