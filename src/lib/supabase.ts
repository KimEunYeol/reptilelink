import{assertCommandFresh}from'./commandWindow';
import {authIssue} from './authReturn';
import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key);
export const initialAuthIssue=typeof window==='undefined'?null:authIssue(window.location.search,window.location.hash);
export const supabase = createClient(url || 'http://127.0.0.1:56321', key || 'configuration-required');
export const localAuth = import.meta.env.DEV && import.meta.env.VITE_LOCAL_AUTH === 'true'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && ['localhost', '127.0.0.1'].includes(new URL(url || 'http://127.0.0.1').hostname);
export const googleAuth = import.meta.env.VITE_GOOGLE_AUTH === 'true';
export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.schema('api').rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function serverRequest<T>(path: string, body?: unknown, check?:()=>void): Promise<T> {
  const { data } = await supabase.auth.getSession();
  check?.();
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.code || 'REQUEST_FAILED');
  return result as T;
}

export async function rpcCommand<T>(name:string,args:Record<string,unknown>,command:object=args):Promise<T>{assertCommandFresh(command);return rpc<T>(name,args);}
export async function serverCommand<T>(path:string,body:unknown,command:object):Promise<T>{assertCommandFresh(command);return serverRequest<T>(path,body,()=>assertCommandFresh(command));}
