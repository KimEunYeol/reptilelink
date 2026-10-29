import {useCallback,useEffect,useState} from 'react';
import {rpc} from './supabase';
export type PolicyStatus={version:string|null;digest:string|null;mode:'unconfigured'|'preview'|'published';accepted:boolean};
export type PolicyBundle=PolicyStatus&{terms?:string;privacy?:string};
export function policyAvailable(bundle:PolicyBundle|null):bundle is PolicyBundle&{version:string;digest:string;terms:string;privacy:string}{
 return Boolean(bundle&&bundle.mode!=='unconfigured'&&bundle.version&&bundle.digest&&bundle.terms&&bundle.privacy);
}
export function usePolicy(enabled=true){
 const[data,setData]=useState<PolicyBundle|null>(null),[loading,setLoading]=useState(enabled),[error,setError]=useState('');
 const load=useCallback(async()=>{setLoading(true);setError('');try{const bundle=await rpc<PolicyBundle>('policy_context');setData(bundle);return bundle;}catch{setError('안내를 불러오지 못했습니다. 다시 확인해주세요.');return null;}finally{setLoading(false);}},[]);
 useEffect(()=>{if(enabled)void load();},[enabled,load]);return{data,loading,error,load};
}
