import {useEffect,useRef,useState,type FormEvent} from 'react';
import {X} from 'lucide-react';
import {animalRegistrationSchema,seoulDate,sexLabels,statusLabels,userMessage,type Animal,type Dashboard,type Profile} from '../lib/domain';
import {rpc} from '../lib/supabase';
import {cleanupSelfUploads,queuePhotoCleanup,uploadDraftPhotos,type PhotoDraft} from '../lib/photoDraft';
import {parentDraft,parentDraftKeys,uploadDraftParents,cleanupParentUploads,type ParentDraft,type ParentUpload} from '../lib/parentDraft';
import {animalParents} from '../lib/parents';
import {likeRequestExpired} from '../lib/likes';
import {useUnsavedChanges} from '../lib/useUnsavedChanges';
import {AnimalPhotoDraft} from './AnimalPhotoDraft';
import {ParentPhotoDraft} from './ParentPhotos';
import {PolicyRenewalLink} from './PolicyRenewalLink';

type Values={name:string;species:string;morph:string;sex:'unknown'|'male'|'female';birth_date:string|null;adoption_date:string|null;description:string;listing_status:'not_listed'|'available'|'reserved'|'rehomed';is_public:boolean};
const defaults:Values={name:'',species:'크레스티드 게코',morph:'',sex:'unknown',birth_date:null,adoption_date:null,description:'',listing_status:'not_listed',is_public:true};
type Command={data:Values;id:string;expected:number;started:number;wallStarted:number;createSent:boolean;createRejected?:boolean;created?:{id:string;revision:number};save?:Record<string,unknown>;saveSent?:boolean;saved?:{revision:number};publish?:Record<string,unknown>;publishSent?:boolean;published?:boolean};
const definite=(reason:unknown)=>/VERSION_CONFLICT|REQUEST_EXPIRED|REQUEST_CONFLICT|NOT_FOUND|VALIDATION_FAILED|QUOTA_EXCEEDED|CONSENT_REQUIRED|POLICY_NOT_READY|SERVICE_UNAVAILABLE|ACCOUNT_NOT_ACTIVE/.test(String((reason as{message?:string})?.message??reason));
const expired=(command:Command)=>likeRequestExpired(command.started,performance.now(),command.wallStarted,Date.now());

export function AnimalCreate({profile,reconcile,onClose}:{profile:Profile;reconcile:()=>Promise<Dashboard>;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),urls=useRef<string[]>([]),sending=useRef(false),command=useRef<Command|null>(null);
  const [values,setValues]=useState<Values>(defaults),[photos,setPhotos]=useState<PhotoDraft[]>([]),[parents,setParents]=useState<ParentDraft>(()=>parentDraft({father:null,mother:null}));
  const [busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[photosEditable,setPhotosEditable]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(''),[inspection,setInspection]=useState<Dashboard|null>(null);
  const [invalid,setInvalid]=useState<Record<string,string>>({});
  const uploaded=useRef(new Map<string,string>()),allocated=useRef(new Set<string>()),parentUploads=useRef(new Map<string,ParentUpload>());
  const dirty=attempted||photos.length>0||parentDraftKeys(parents).some(Boolean)||JSON.stringify(values)!==JSON.stringify(defaults);
  const navigation=useUnsavedChanges(dirty,busy);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null,d=dialog.current;d?.showModal();return()=>{d?.close();previous?.focus();for(const url of urls.current)URL.revokeObjectURL(url);};},[]);
  const field=<K extends keyof Values>(key:K,value:Values[K])=>{setValues(old=>({...old,[key]:value}));setInvalid(old=>({...old,[key]:''}));};
  const inputProps=(key:keyof Values)=>({'aria-invalid':Boolean(invalid[key]),'aria-describedby':invalid[key]?`create-error-${key}`:undefined});
  const problem=(key:keyof Values)=>invalid[key]&&<small className="edit-field-error" id={`create-error-${key}`}>{invalid[key]}</small>;
  const createArgs=(c:Command)=>({p_data:{...c.data,is_public:false},p_expected:c.expected,p_request_id:c.id});
  function matches(animal:Animal,c:Command){
    const {is_public,...data}=c.data;void is_public;
    return Object.entries(data).every(([key,value])=>(animal as unknown as Record<string,unknown>)[key]===value)
      &&JSON.stringify(animal.photos.map(p=>p.asset_id))===JSON.stringify(c.save?.p_assets??[])
      &&JSON.stringify(animalParents(animal))===JSON.stringify(c.save?.p_parents??{father:null,mother:null});
  }
  async function settle(){
    const c=command.current;if(!c||expired(c))return;
    try{
      if(c.createSent&&!c.created)c.created=await rpc<{id:string;revision:number}>('create_animal',createArgs(c));
      if(c.saveSent&&!c.saved&&c.save)c.saved=await rpc<{revision:number}>('save_animal_details',c.save);
      if(c.publishSent&&!c.published&&c.publish){await rpc('set_animal_public',c.publish);c.published=true;}
    }catch(reason){if(!definite(reason))throw reason;if(!c.created)c.createRejected=true;}
  }
  async function inspect(){
    if(sending.current)return;sending.current=true;setBusy(true);setError('');
    try{await settle();const latest=await reconcile();setInspection(latest);setError('현재 저장 목록을 확인했습니다. 등록된 개체는 삭제하지 않고 목록에서 이어서 확인할 수 있습니다.');}
    catch(reason){setError(userMessage(reason));}finally{sending.current=false;setBusy(false);}
  }
  async function preparePhotosAgain(){
    const c=command.current;
    if(sending.current||!c?.created||c.saveSent||c.save||c.publishSent)return;
    sending.current=true;setBusy(true);setError('');
    try{
      if(expired(c))throw Error('REQUEST_EXPIRED');
      const latest=await reconcile(),found=latest.animals.find(a=>a.id===c.created!.id);
      if(latest.account_status!=='active'||!latest.profile||!found)throw Error('NOT_FOUND');
      // Only rebase an unchanged, still-private creation with no bound photos.
      // A different editor's changes must be reviewed in its existing editor.
      if(found.is_public||!matches(found,c))throw Error('VERSION_CONFLICT');
      await cleanupSelfUploads(uploaded.current,new Set());
      c.created.revision=latest.profile.revision;
      setPhotosEditable(true);setInspection(null);
      setError('사진 입력을 유지했습니다. 사진을 확인·수정한 뒤 같은 개체에서 저장해주세요.');
    }catch(reason){setError(userMessage(reason));}finally{sending.current=false;setBusy(false);}
  }
  async function discard(leaving=false){
    if(sending.current)return;sending.current=true;setBusy(true);setError('');
    try{
      let retained=new Set<string>();
      if(command.current){await settle();const latest=await reconcile();const found=latest.animals.find(a=>a.id===command.current?.created?.id);if(found)retained=new Set([...found.photos.map(p=>p.asset_id),...Object.values(animalParents(found)).filter((id):id is string=>Boolean(id))]);}
      await cleanupSelfUploads(uploaded.current,retained);await queuePhotoCleanup([...allocated.current].filter(id=>!retained.has(id)));await cleanupParentUploads(parentUploads.current,retained);
      if(leaving)navigation.leave();else onClose();
    }catch(reason){setError(userMessage(reason));}finally{sending.current=false;setBusy(false);}
  }
  async function submit(event:FormEvent){
    event.preventDefault();if(sending.current)return;
    if(!command.current){const parsed=animalRegistrationSchema.safeParse(values);if(!parsed.success){setInvalid(Object.fromEntries(parsed.error.issues.map(issue=>[String(issue.path[0]),issue.message])));setError(parsed.error.issues[0].message);return;}setInvalid({});command.current={data:parsed.data,id:crypto.randomUUID(),expected:profile.revision,started:performance.now(),wallStarted:Date.now(),createSent:false};setAttempted(true);}
    const c=command.current;setPhotosEditable(false);sending.current=true;setBusy(true);setError('');setInspection(null);
    try{
      if(expired(c))throw Error('REQUEST_EXPIRED');
      if(!c.created){setProgress('개체 정보를 비공개로 저장하고 있어요.');c.createSent=true;c.created=await rpc<{id:string;revision:number}>('create_animal',createArgs(c));}
      const created=c.created;if(!created)throw Error('NOT_FOUND');
      if(!c.save){const assets=await uploadDraftPhotos(created.id,photos,uploaded.current,allocated.current,setProgress),parentAssets=await uploadDraftParents(created.id,parents,parentUploads.current,setProgress);const {is_public,...data}=c.data;void is_public;c.save={p_animal_id:created.id,p_data:data,p_assets:assets,p_parents:parentAssets,p_expected:created.revision,p_request_id:crypto.randomUUID()};}
      if(!c.saved){setProgress('사진과 개체 정보를 연결하고 있어요.');c.saveSent=true;c.saved=await rpc<{revision:number}>('save_animal_details',c.save);}
      const saved=c.saved;if(!saved)throw Error('NOT_FOUND');
      if(c.data.is_public&&!c.published){
        if(c.publishSent){await settle();const latest=await reconcile(),found=latest.animals.find(a=>a.id===created.id);if(found?.is_public&&matches(found,c)){onClose();return;}throw Error('VERSION_CONFLICT');}
        c.publish={p_animal_id:created.id,p_public:true,p_expected:saved.revision};c.publishSent=true;setProgress('공개 상태를 확인하고 있어요.');await rpc('set_animal_public',c.publish);c.published=true;
      }
      const latest=await reconcile(),found=latest.animals.find(a=>a.id===created.id);if(!found||found.is_public!==c.data.is_public||!matches(found,c))throw Error('VERSION_CONFLICT');
      onClose();
    }catch(reason){
      if(!c.created&&!expired(c)&&definite(reason))c.createRejected=true;
      // Keep incomplete self reservations; retry/cancel settles their original UUID.

      setError(`${userMessage(reason)} 저장된 개체가 있을 수 있습니다. 같은 요청을 확인하거나 현재 목록을 확인해주세요.`);
    }finally{sending.current=false;setBusy(false);}
  }
  return <dialog ref={dialog} className="animal-edit animal-create" aria-labelledby="animal-create-title" onCancel={event=>{event.preventDefault();if(!busy)void discard();}}>
    <header className="animal-edit-heading"><h2 id="animal-create-title">개체 추가</h2><button type="button" className="icon-button" aria-label="등록 닫기" disabled={busy} onClick={()=>void discard()}><X size={20}/></button></header>
    <form className="animal-edit-body" noValidate onSubmit={submit}>
      <AnimalPhotoDraft photos={photos} disabled={busy||(attempted&&!photosEditable)} onChange={setPhotos} renderPhoto={()=>null} rememberUrl={url=>urls.current.push(url)} inputLabel="개체 사진" multiple sourcePlaceholder/>
      <ParentPhotoDraft draft={parents} disabled={busy||(attempted&&!photosEditable)} onChange={(role,photo)=>setParents(old=>({...old,[role]:photo}))} renderPhoto={()=>null} rememberUrl={url=>urls.current.push(url)}/>
      <fieldset className="edit-sex" disabled={busy||attempted}><legend>성별</legend>{(['male','female','unknown']as const).map(sex=><label key={sex}><input type="radio" name="create-sex" checked={values.sex===sex} onChange={()=>field('sex',sex)}/>{sexLabels[sex]}</label>)}</fieldset>
      <fieldset className="edit-fields" disabled={busy||attempted}><legend className="sr-only">개체 일반 정보</legend>
        <label><span>이름</span><input aria-label="개체 이름" {...inputProps('name')} value={values.name} onChange={e=>field('name',e.target.value)}/>{problem('name')}</label>
        <label><span>종류</span><input aria-label="종류" {...inputProps('species')} list="create-species" value={values.species} onChange={e=>field('species',e.target.value)}/>{problem('species')}</label>
        <label><span>모프</span><input aria-label="모프" {...inputProps('morph')} value={values.morph} onChange={e=>field('morph',e.target.value)}/>{problem('morph')}</label>
        <label><span>해칭일</span><input aria-label="생일" {...inputProps('birth_date')} type="date" value={values.birth_date??''} max={seoulDate()} onChange={e=>field('birth_date',e.target.value||null)}/>{problem('birth_date')}</label>
        <label><span>입양일</span><input aria-label="입양일" {...inputProps('adoption_date')} type="date" value={values.adoption_date??''} min={values.birth_date??undefined} max={seoulDate()} onChange={e=>field('adoption_date',e.target.value||null)}/>{problem('adoption_date')}</label>
        <label><span>분양 상태</span><select aria-label="분양 상태" value={values.listing_status} onChange={e=>field('listing_status',e.target.value as Values['listing_status'])}>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="edit-description"><span>설명</span><textarea aria-label="개체 소개" {...inputProps('description')} rows={4} value={values.description} onChange={e=>field('description',e.target.value)}/>{problem('description')}</label>
        <label className="check-label"><input type="checkbox" checked={values.is_public} onChange={e=>field('is_public',e.target.checked)}/><span>공개 페이지에 보여주기</span></label>
      </fieldset><datalist id="create-species"><option>크레스티드 게코</option><option>볼파이톤</option><option>레오파드 게코</option></datalist>
      {busy&&<p className="edit-photo-hint" role="status">{progress}</p>}{error&&<p className="notice" role="alert">{error}<PolicyRenewalLink message={error}/></p>}
      {attempted&&error&&<button type="button" className="text-button" disabled={busy} onClick={()=>void inspect()}>저장 상태 확인</button>}
      {inspection&&<div className="edit-conflict" aria-label="현재 저장 목록"><p>현재 개체 {inspection.animals.length}개</p><ul>{inspection.animals.map(a=><li key={a.id}>{a.name} · {a.is_public?'공개':'비공개'}</li>)}</ul></div>}
      {inspection&&command.current?.created&&!command.current.saveSent&&!command.current.save&&!command.current.publishSent&&!expired(command.current)&&<button type="button" className="text-button" disabled={busy} onClick={()=>void preparePhotosAgain()}>사진 입력 유지·다시 준비</button>}
      {inspection&&command.current?.createRejected&&!command.current.created&&<button type="button" className="text-button" disabled={busy} onClick={()=>{command.current=null;setAttempted(false);setInspection(null);setError('입력을 유지했습니다. 현재 목록을 검토한 뒤 저장해주세요.');}}>입력 유지·새 요청 준비</button>}
      {navigation.blocked&&<div data-navigation-prompt><p className="notice" role="alert">입력과 저장 상태를 확인한 뒤 이동해주세요.</p><button ref={navigation.stayButton} type="button" className="text-button" onClick={navigation.stay}>계속 확인</button><button type="button" className="text-button" disabled={busy} onClick={()=>void discard(true)}>저장 상태 확인 후 이동</button></div>}
      <footer className="edit-actions"><button className="button" aria-label="개체 등록하기" disabled={busy}>{busy?'저장 중':attempted&&!photosEditable?'등록 확인':'저장'}</button><button type="button" className="button ghost" disabled={busy} onClick={()=>void discard()}>취소</button></footer>
    </form>
  </dialog>;
}
