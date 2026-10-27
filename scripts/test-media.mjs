import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { fixturePassword, localStatus } from './local-utils.mjs';
const status=localStatus();
async function login(email) { const client=createClient(status.url,status.publishable,{auth:{persistSession:false,autoRefreshToken:false}}); const result=await client.auth.signInWithPassword({email,password:fixturePassword}); assert.ifError(result.error); return {client,token:result.data.session.access_token}; }
const a=await login('qa-owner@reptilelink.test'),b=await login('qa-other@reptilelink.test');
async function post(path,token,body={}) { return fetch(`http://127.0.0.1:8787${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}); }
const dash=await a.client.schema('api').rpc('my_dashboard'); assert.ifError(dash.error);
const animal=dash.data.animals[0]; assert.ok(animal);
assert.equal((await post('/api/uploads',null,{animal_id:animal.id})).status,401);
assert.equal((await post('/api/uploads',b.token,{animal_id:animal.id})).status,404);
const reserved=await post('/api/uploads',a.token,{animal_id:animal.id}); assert.equal(reserved.status,200);
const manifest=await reserved.json();
for(const object of manifest.objects) {
  const badFile=new Blob(['<svg onload="alert(1)"></svg>'],{type:'image/webp'});
  const uploaded=await a.client.storage.from('animal-media').uploadToSignedUrl(object.path,object.token,badFile,{contentType:'image/webp',upsert:false}); assert.ifError(uploaded.error);
  const overwritten=await a.client.storage.from('animal-media').uploadToSignedUrl(object.path,object.token,badFile,{contentType:'image/webp',upsert:true}); assert.ok(overwritten.error,'create-only signed uploads cannot overwrite an existing file');
}
assert.equal((await post(`/api/uploads/${manifest.asset_id}/complete`,b.token)).status,404);
const invalid=await post(`/api/uploads/${manifest.asset_id}/complete`,a.token); assert.equal(invalid.status,400); assert.equal((await invalid.json()).code,'INVALID_IMAGE');
const cancelled=await post(`/api/uploads/${manifest.asset_id}/cancel`,a.token); assert.equal(cancelled.status,200);
const cleaned=await a.client.schema('api').rpc('my_dashboard'); assert.equal(cleaned.data.usage.reserved_bytes,0);
console.log('Passed 8 upload API checks: authentication, owner isolation, create-only tokens, byte validation and cleanup.');
