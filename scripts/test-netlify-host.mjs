import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {createAccount,finishAccount,call,status} from './account-qa.mjs';
import {localQuery} from './local-utils.mjs';

// Same host adapter and real loopback Auth/DB/Storage, with only Netlify's static continuation replaced.
const origin='https://reptilelink.example',template=await readFile('dist/index.html','utf8');
const before=Number(localQuery("select count(*)from storage.objects where bucket_id='animal-media'").trim());
const vars={SUPABASE_URL:status.url,SUPABASE_PUBLISHABLE_KEY:status.publishable,SUPABASE_SECRET_KEY:status.secret,APP_ORIGIN:origin};
const previous=globalThis.Netlify;globalThis.Netlify={env:{get:name=>vars[name]}};
const vite=await createServer({configFile:false,server:{middlewareMode:true,watch:null},appType:'custom'});
let owner,other,browser,checks=0,signed;
const equal=(a,b)=>{assert.equal(a,b);checks++;};
const truth=value=>{assert.ok(value);checks++;};
const matches=(value,pattern)=>{assert.match(value,pattern);checks++;};
try{
 const {default:handler}=await vite.ssrLoadModule('/netlify/edge-functions/reptilelink.ts');
 const context={async next(request){equal(new URL(request.url).origin,origin);return new Response(template,{headers:{'Content-Type':'text/html','Cache-Control':'public, max-age=3600'}});}};
 const run=(path,{method='GET',token,body,requestOrigin}={})=>handler(new Request(origin+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{}),...(requestOrigin?{Origin:requestOrigin}:{})},...(body?{body:JSON.stringify(body)}:{})}),context);
 equal((await run('/api/health')).status,200);
 for(const path of ['/auth/callback','/onboarding','/dashboard/animals']){const r=await run(path);equal(r.status,200);equal(r.headers.get('cache-control'),'no-store');equal(r.headers.get('referrer-policy'),'no-referrer');}
 equal((await run('/api/uploads',{method:'POST',body:{}})).status,401);
 equal((await run('/api/uploads',{method:'POST',body:{},requestOrigin:'https://other.example'})).status,403);
 const saved=vars.SUPABASE_SECRET_KEY;delete vars.SUPABASE_SECRET_KEY;
 const unconfigured=await run('/u/missing-profile');equal(unconfigured.status,503);equal(unconfigured.headers.get('cache-control'),'no-store');vars.SUPABASE_SECRET_KEY=saved;
 owner=await createAccount();other=await createAccount();const dash=()=>call(owner.c,'my_dashboard');
 const animal=(await call(owner.c,'create_animal',{p_data:{name:'Netlify 호스트 QA',species:'게코',is_public:true},p_expected:(await dash()).profile.revision,p_request_id:crypto.randomUUID()})).id;
 equal((await run(`/u/${owner.slug}`)).status,404);
 equal((await run('/api/uploads',{method:'POST',token:other.token,body:{animal_id:animal}})).status,404);
 const reserved=await run('/api/uploads',{method:'POST',token:owner.token,body:{animal_id:animal,request_id:crypto.randomUUID()}});equal(reserved.status,200);const manifest=await reserved.json();
 const photo=process.argv[2]??'public/brand/profile/avatar-public.png',input=await readFile(photo);browser=await chromium.launch();const page=await browser.newPage();await page.goto('http://localhost:5173/');
 const parts=await page.evaluate(async({base64,type})=>{const {preparePhoto}=await import('/src/lib/images.ts');const file=new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'qa-image',{type});const blobs=await preparePhoto(file);return Object.fromEntries(await Promise.all(Object.entries(blobs).map(async([name,blob])=>[name,await (async()=>{const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);})()])));},{base64:input.toString('base64'),type:photo.endsWith('.jpg')?'image/jpeg':'image/png'});
 for(const object of manifest.objects){const bytes=Buffer.from(parts[object.variant],'base64');const uploaded=await owner.c.storage.from('animal-media').uploadToSignedUrl(object.path,object.token,new Blob([bytes],{type:'image/webp'}),{contentType:'image/webp',upsert:false});assert.ifError(uploaded.error);checks++;}
 equal((await run(`/api/uploads/${manifest.asset_id}/complete`,{method:'POST',token:other.token,body:{}})).status,404);
 equal((await run(`/api/uploads/${manifest.asset_id}/complete`,{method:'POST',token:owner.token,body:{}})).status,200);
 const current=await dash(),a=current.animals.find(item=>item.id===animal),fields=Object.fromEntries(['name','species','morph','sex','birth_date','adoption_date','description','listing_status'].map(key=>[key,a[key]]));
 await call(owner.c,'save_animal_details',{p_animal_id:animal,p_data:fields,p_assets:[manifest.asset_id],p_parents:{father:null,mother:null},p_expected:current.profile.revision,p_request_id:crypto.randomUUID()});
 equal((await run(`/api/image/${manifest.asset_id}/original_display`)).status,404);
 equal((await run(`/api/image/${manifest.asset_id}/original_display`,{token:other.token})).status,404);
 const owned=await run(`/api/image/${manifest.asset_id}/original_display`,{token:owner.token});equal(owned.status,302);signed=owned.headers.get('location');truth(['127.0.0.1','localhost'].includes(new URL(signed).hostname));const actual=await fetch(signed);equal(actual.status,200);const bytes=Buffer.from(await actual.arrayBuffer());equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(Buffer.from(parts.original_display,'base64')).digest('hex'));
 await call(owner.c,'set_profile_public',{p_public:true,p_expected:(await dash()).profile.revision});
 const published=await run(`/u/${owner.slug}`);equal(published.status,200);equal(published.headers.get('cache-control'),'no-store');const html=await published.text();truth(html.includes(`property="og:url" content="${origin}/u/${owner.slug}"`));truth(html.includes(`${origin}/api/image/${manifest.asset_id}/original_display`));truth(!html.includes('pages.dev')&&!html.includes('workers.dev'));truth(!html.includes(status.secret));matches(html,/id="public-bootstrap"/);
 equal((await run(`/api/image/${manifest.asset_id}/original_display`)).status,302);
 await call(owner.c,'set_profile_public',{p_public:false,p_expected:(await dash()).profile.revision});equal((await run(`/u/${owner.slug}`)).status,404);equal((await run(`/api/image/${manifest.asset_id}/original_display`)).status,404);
 let response=await run('/api/account/delete',{method:'POST',token:owner.token,body:{expected:(await dash()).profile.revision,request_id:crypto.randomUUID(),confirm:'탈퇴'}});equal(response.status,200);let result=await response.json();
 // Only this disposable owner's outstanding signed-upload lease is simulated as expired.
 if(!result.deleted)localQuery(`update private.media_assets set cleanup_after=now()-interval '1 second' where profile_id='${owner.id}'`);
 for(let attempt=0;!result.deleted&&attempt<10;attempt++){response=await run('/api/account/cleanup',{method:'POST',token:owner.token,body:{}});equal(response.status,200);result=await response.json();}
 truth(result.deleted);equal((await run('/api/uploads',{method:'POST',token:owner.token,body:{animal_id:animal}})).status,401);truth(!(await fetch(signed)).ok);
 equal(Number(localQuery(`select count(*)from storage.objects where bucket_id='animal-media'and name like '${owner.id}/%'`).trim()),0);
}finally{
 await browser?.close();if(owner)await finishAccount(owner);if(other)await finishAccount(other);await vite.close();if(previous===undefined)delete globalThis.Netlify;else globalThis.Netlify=previous;
}
equal(Number(localQuery("select count(*)from storage.objects where bucket_id='animal-media'").trim()),before);
console.log(`Passed ${checks} Netlify-host adapter checks with real local Auth/DB/Storage: routing/cache, missing configuration, origin/owner denial, sanitized real files, same-host public HTML, privacy and actual withdrawal/file removal. Netlify's deployed runtime is checked separately.`);
