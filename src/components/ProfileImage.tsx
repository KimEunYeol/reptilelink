import {useEffect,useState} from 'react';
import {serverRequest} from '../lib/supabase';
export function ProfileImage({asset,purpose,preview,settings=false}:{asset?:string|null;purpose:'avatar'|'cover';preview?:string;settings?:boolean}){
 const [url,setUrl]=useState('');
 useEffect(()=>{let active=true;setUrl('');if(asset&&!preview)serverRequest<{url:string}>(`/api/media/${asset}/original_display`).then(v=>{if(active)setUrl(v.url);}).catch(()=>{});return()=>{active=false;};},[asset,preview]);
 const image=preview||url;
 if(image)return <img src={image} alt={purpose==='avatar'?'프로필 이미지':'배경 이미지'}/>;
 return purpose==='avatar'?<img src={`/brand/profile/avatar-${settings?'settings':'public'}.png`} alt="기본 프로필 이미지"/>:<div className="source-cover"><img src="/brand/reptilelink-source.png" alt=""/></div>;
}
