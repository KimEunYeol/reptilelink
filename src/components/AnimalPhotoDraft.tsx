import { useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { PhotoDraft } from '../lib/photoDraft';

export function AnimalPhotoDraft({ photos, disabled, onChange, renderPhoto, rememberUrl,inputLabel='편집 사진 파일',multiple=false,sourcePlaceholder=false }: {
  photos: PhotoDraft[]; disabled: boolean; onChange: (photos: PhotoDraft[]) => void;
  renderPhoto: (id: string) => ReactNode; rememberUrl: (url: string) => void;
  inputLabel?:string;multiple?:boolean;sourcePlaceholder?:boolean;
}) {
  const [selected, setSelected] = useState(0), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), replacing = useRef(false);
  const index = Math.min(selected, Math.max(0, photos.length - 1)), current = photos[index];
  function choose(replace:boolean){replacing.current=replace;if(input.current){input.current.multiple=multiple&&!replace;input.current.click();}}
  return <fieldset className={`edit-photos ${sourcePlaceholder?'create-photo-draft':''}`} disabled={disabled}><legend className="sr-only">개체 사진 편집</legend>
    <div className="edit-photo">{current ? current.file ? <img src={current.url} alt="선택한 사진 미리보기"/> : renderPhoto(current.asset_id!)
      : <button type="button" className="edit-photo-add" aria-label="사진 추가" onClick={()=>choose(false)}>{sourcePlaceholder?<><img src="/brand/public/animal-placeholder.png" width="196" height="113" alt=""/><span>클릭하여 이미지를 추가하세요</span></>:<Plus size={32}/>}</button>}</div>
    {photos.length > 0 && <div className="edit-photo-pages" aria-label="사진 선택">{photos.map((photo, i) => <button type="button" key={photo.key} aria-label={`${i + 1}번 사진${i === 0 ? ' (대표)' : ''}`} aria-current={index === i ? 'true' : undefined} onClick={() => setSelected(i)}>{i + 1}</button>)}</div>}
    <div className="edit-photo-controls">
      {photos.length > 0 && <><button type="button" className="text-button" onClick={()=>choose(true)}>사진 교체</button>
        <button type="button" className="text-button" onClick={() => { onChange(photos.filter((_, i) => i !== index)); setSelected(Math.max(0, index - 1)); }}>사진 삭제</button></>}
      {photos.length > 0 && photos.length < 3 && <button type="button" className="text-button" onClick={()=>choose(false)}>사진 추가</button>}
      {index > 0 && <button type="button" className="text-button" onClick={() => { onChange([photos[index], ...photos.filter((_, i) => i !== index)]); setSelected(0); }}>대표로 지정</button>}
    </div>
    <input ref={input} type="file" className="sr-only" aria-label={inputLabel} multiple={multiple} accept="image/jpeg,image/png,image/webp" onChange={event => {
      const files=Array.from(event.target.files??[]);event.target.value='';if(!files.length)return;
      if(files.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)){setError('15MB 이하의 JPG, PNG, WebP 사진을 선택해주세요.');return;}
      if(!replacing.current&&photos.length+files.length>3){setError('사진은 최대 3장까지 선택해주세요.');return;}
      const drafts=files.map(file=>{const url=URL.createObjectURL(file);rememberUrl(url);return{key:crypto.randomUUID(),file,url};});
      if (replacing.current && current) onChange(photos.map((p, i) => i === index ? drafts[0] : p));
      else if (photos.length < 3) { onChange([...photos,...drafts]); setSelected(photos.length); }
      setError('');
    }}/>
    {error && <p className="notice" role="alert">{error}</p>}
    <p className="edit-photo-hint">최대 3장 · 첫 사진이 대표 사진입니다. 저장 전에는 변경되지 않습니다.</p>
  </fieldset>;
}
