import {useEffect,useState} from 'react';
import {serverRequest} from '../lib/supabase';
export function ProfileImage({asset,purpose,preview,settings=false,publicOnly=false}:{asset?:string|null;purpose:'avatar'|'cover';preview?:string;settings?:boolean;publicOnly?:boolean}){
 const [url,setUrl]=useState(''),[failed,setFailed]=useState<string|null>(null);
 useEffect(()=>{let active=true;setUrl('');if(asset&&!preview&&!publicOnly)serverRequest<{url:string}>(`/api/media/${asset}/original_display`).then(v=>{if(active)setUrl(v.url);}).catch(()=>{});return()=>{active=false;};},[asset,preview,publicOnly]);
 const image=preview||(publicOnly?(asset&&failed!==asset?`/api/image/${asset}/original_display`:''):url);
 if(image)return <img src={image} alt={purpose==='avatar'?'프로필 이미지':'배경 이미지'} onError={publicOnly?()=>setFailed(asset??null):undefined}/>;
 return purpose==='avatar'?<img src={`/brand/profile/avatar-${settings?'settings':'public'}.png`} alt="기본 프로필 이미지"/>:<div className="source-cover"><img src="/brand/reptilelink-source.png" alt=""/></div>;
}
