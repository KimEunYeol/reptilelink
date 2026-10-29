import {useCallback,useEffect,useRef,useState} from 'react';
import {rpc,supabase} from './supabase';
export type UnreadSummary={count:number|null;failed:boolean};
/** Route-entry reads only; no timer, persistent cache or dashboard reload. */
export function useNotificationSummary(owner:string,entry:string){
 const [state,setState]=useState<UnreadSummary>({count:null,failed:false});
 const generation=useRef(0),identity=useRef<string|null>(owner),active=useRef(true);
 const accept=useCallback((count:number)=>{if(active.current&&identity.current===owner&&Number.isSafeInteger(count)&&count>=0){generation.current++;setState({count,failed:false});}},[owner]);
 useEffect(()=>{active.current=true;identity.current=owner;setState({count:null,failed:false});const listener=supabase.auth.onAuthStateChange((_event,session)=>{const next=session?.user.id??null;if(identity.current!==next){identity.current=next;generation.current++;setState({count:null,failed:false});}});return()=>{active.current=false;generation.current++;listener.data.subscription.unsubscribe();};},[owner]);
 useEffect(()=>{const attempt=++generation.current;let mounted=true;void(async()=>{try{const auth=await supabase.auth.getSession();if(!mounted||auth.data.session?.user.id!==owner||identity.current!==owner)return;const data=await rpc<{unread:number}>('my_notification_summary');if(!Number.isSafeInteger(data.unread)||data.unread<0)throw Error('INVALID_SUMMARY');if(mounted&&active.current&&attempt===generation.current&&identity.current===owner)setState({count:data.unread,failed:false});}catch{if(mounted&&active.current&&attempt===generation.current&&identity.current===owner)setState({count:null,failed:true});}})();return()=>{mounted=false;};},[owner,entry]);
 return {state,accept};
}
