import {publicSchedulePeriod} from '../src/lib/schedules';
import {socialNames,socialPlatforms} from '../src/lib/socials';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { inspectWebp } from './images';
import { httpsUrl, linkColors, linkTextColor, linkTokens } from '../src/lib/links';
import type { PublicPage } from '../src/lib/domain';

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string; SUPABASE_SECRET_KEY: string; APP_ORIGIN: string;
};
const uuid = z.string().uuid();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function clients(env: Env, token?: string) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY) throw new Error('CONFIGURATION_REQUIRED');
  return {
    user: createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { ...options, global: { headers: token ? { Authorization: `Bearer ${token}` } : {} } }),
    admin: createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, options),
  };
}
async function call<T>(client: ReturnType<typeof clients>['user'], name: string, args?: Record<string, unknown>) {
  const { data, error } = await client.schema('api').rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function actor(request: Request, env: Env, required = true) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token && required) throw new Error('UNAUTHENTICATED');
  const c = clients(env, token);
  if (!token) return { ...c, id: null };
  const { data, error } = await c.user.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHENTICATED');
  return { ...c, id: data.user.id };
}
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('VALIDATION_FAILED');
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 8192) { await reader.cancel(); throw new Error('VALIDATION_FAILED'); } chunks.push(item.value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), path = url.pathname;
    try {
      if (path === '/api/health') return json({ status: 'ok', backend: 'supabase' });
      if (request.method === 'POST') {
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin && origin !== env.APP_ORIGIN) return json({ code: 'ORIGIN_REJECTED' }, 403);
      }
      const deletion = path.match(/^\/api\/animals\/([^/]+)\/(delete|cleanup)$/);
      if (deletion && request.method === 'POST') {
        const id = uuid.parse(deletion[1]), c = await actor(request, env);
        if (deletion[2] === 'delete') {
          const input = z.object({ expected: z.number().int().nonnegative(), request_id: uuid }).strict().parse(await body(request));
          await call(c.user, 'delete_animal', { p_animal_id: id, p_expected: input.expected, p_request_id: input.request_id });
        } else z.object({}).strict().parse(await body(request));
        const assets = await call<string[]>(c.admin, 'animal_deletion_assets', { p_animal_id: id, p_actor: c.id });
        for (const asset of assets) {
          try {
            const paths = await call<string[] | null>(c.admin, 'cleanup_manifest', { p_asset_id: asset, p_actor: c.id });
            if (!paths) continue;
            const removed = await c.admin.storage.from('animal-media').remove(paths);
            if (removed.error) continue;
            await call(c.admin, 'finish_cleanup', { p_asset_id: asset });
          } catch { /* The persistent deletion job retains failed assets for retry. */ }
        }
        const complete = await call<boolean>(c.admin, 'finish_animal_deletion', { p_animal_id: id, p_actor: c.id });
        return json({ deleted: true, cleanup_pending: !complete });
      }
      if (path === '/api/profile/uploads' && request.method === 'POST') {
        const c = await actor(request, env);
        const input = z.object({purpose:z.enum(['avatar','cover']),request_id:uuid}).strict().parse(await body(request));
        const manifest = await call<{asset_id:string;ready:boolean;objects:{path:string;variant:string}[]}>(c.user,'reserve_profile_upload',{p_purpose:input.purpose,p_request_id:input.request_id});
        if (manifest.ready) return json({asset_id:manifest.asset_id,ready:true,objects:[]});
        const objects=[];
        for (const object of manifest.objects) {
          const {data,error}=await c.admin.storage.from('animal-media').createSignedUploadUrl(object.path,{upsert:false});
          if(error) throw new Error('UPLOAD_FAILED');
          objects.push({...object,token:data.token});
        }
        await call(c.admin,'register_upload_lease',{p_asset_id:manifest.asset_id,p_actor:c.id});
        return json({asset_id:manifest.asset_id,ready:false,objects});
      }
      if (path === '/api/profile/uploads/cancel-request' && request.method === 'POST') {
        const c=await actor(request,env);
        const input=z.object({purpose:z.enum(['avatar','cover']),request_id:uuid}).strict().parse(await body(request));
        const id=await call<string|null>(c.user,'cancel_profile_upload_request',{p_purpose:input.purpose,p_request_id:input.request_id});
        if(!id) return json({ok:true});
        const paths=await call<string[]|null>(c.admin,'cleanup_manifest',{p_asset_id:id,p_actor:c.id});
        if(!paths) return json({ok:true,cleanup_pending:true});
        const removed=await c.admin.storage.from('animal-media').remove(paths);
        if(removed.error) throw new Error('CLEANUP_PENDING');
        await call(c.admin,'finish_cleanup',{p_asset_id:id});
        return json({ok:true});
      }
      if (path === '/api/uploads' && request.method === 'POST') {
        const c = await actor(request, env);
        const input = z.object({ animal_id: uuid, editing: z.boolean().optional() }).strict().parse(await body(request));
        const manifest = await call<{ asset_id: string; objects: { path: string; variant: string }[] }>(c.user, input.editing ? 'reserve_photo_edit' : 'reserve_upload', { p_animal_id: input.animal_id });
        const objects = [];
        for (const object of manifest.objects) {
          const { data, error } = await c.admin.storage.from('animal-media').createSignedUploadUrl(object.path, { upsert: false });
          if (error) throw new Error('UPLOAD_FAILED');
          objects.push({ ...object, token: data.token });
        }
        await call(c.admin, 'register_upload_lease', { p_asset_id: manifest.asset_id, p_actor: c.id });
        return json({ asset_id: manifest.asset_id, objects });
      }
      const finalize = path.match(/^\/api\/uploads\/([^/]+)\/(complete|cancel)$/);
      if (finalize && request.method === 'POST') {
        const asset = uuid.parse(finalize[1]), c = await actor(request, env);
        if (finalize[2] === 'cancel') {
          const paths = await call<string[]>(c.admin, 'cleanup_manifest', { p_asset_id: asset, p_actor: c.id });
          if (!paths) return json({ ok: true, cleanup_pending: true });
          const removed = await c.admin.storage.from('animal-media').remove(paths);
          if (removed.error) throw new Error('CLEANUP_PENDING');
          await call(c.admin, 'finish_cleanup', { p_asset_id: asset });
          return json({ ok: true });
        }
        const objects = await call<{ path: string; variant: string }[]>(c.user, 'upload_manifest', { p_asset_id: asset });
        const verified = [];
        for (const object of objects) {
          const file = await c.admin.storage.from('animal-media').download(object.path);
          if (file.error || !file.data) throw new Error('UPLOAD_INCOMPLETE');
          if (file.data.type !== 'image/webp' || file.data.size > (object.variant === 'thumbnail' ? 81920 : 225280)) throw new Error('INVALID_IMAGE');
          const bytes = new Uint8Array(await file.data.arrayBuffer()), dimensions = inspectWebp(bytes);
          if (Math.max(dimensions.width, dimensions.height) > (object.variant === 'thumbnail' ? 480 : 1280)) throw new Error('INVALID_IMAGE');
          const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
          verified.push({ variant: object.variant, bytes: bytes.length, ...dimensions, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') });
        }
        await call(c.admin, 'complete_upload', { p_asset_id: asset, p_actor: c.id, p_objects: verified });
        return json({ ok: true });
      }
      const media = path.match(/^\/api\/(media|image)\/([^/]+)\/(thumbnail|original_display)$/);
      if (media && request.method === 'GET') {
        const c = await actor(request, env, false);
        const objectPath = await call<string | null>(c.admin, 'media_access', { p_asset_id: uuid.parse(media[2]), p_variant: media[3], p_actor: c.id });
        if (!objectPath) return json({ code: 'NOT_FOUND' }, 404);
        const signed = await c.admin.storage.from('animal-media').createSignedUrl(objectPath, 300);
        if (signed.error) throw new Error('NOT_FOUND');
        if (media[1] === 'image') return new Response(null, { status: 302, headers: { Location: signed.data.signedUrl, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        return json({ url: signed.data.signedUrl });
      }
      const publicRoute = path.match(/^\/u\/([a-z0-9-]{3,30})(?:\/animals\/([^/]+))?\/?$/);
      if (publicRoute && request.method === 'GET') {
        const c = clients(env);
        const page = await call<PublicPage | null>(c.user, 'public_page', { p_slug: publicRoute[1] });
        if (!page || (publicRoute[2] && !page.animals.some(a => a.id === publicRoute[2]))) {
          return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><title>페이지를 찾을 수 없습니다</title><h1>페이지를 찾을 수 없습니다.</h1><p>공개된 주소인지 확인해주세요.</p><a href="/">렙타일링크로</a></html>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
        const assetResponse = await env.ASSETS.fetch(new Request(new URL('/index.html', url)));
        let html = await assetResponse.text();
        const title = `${page.profile.display_name} · 렙타일링크`, description = page.profile.bio || '우리 아이들의 기록을 만나보세요.';
        html = html.replace(/<title>.*?<\/title>/, `<title>${escape(title)}</title>`).replace(/<meta name="description"[^>]*>/, '');
        const representative = publicRoute[2] ? page.animals.find(a => a.id === publicRoute[2])?.photos[0]?.asset_id : page.profile.cover_asset_id || page.profile.avatar_asset_id || page.animals.flatMap(a => a.photos)[0]?.asset_id;
        const imageMeta = representative ? `<meta property="og:image" content="${escape(`${url.origin}/api/image/${representative}/original_display`)}">` : '';
        html = html.replace('</head>', `<meta name="description" content="${escape(description)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url.origin + path)}">${imageMeta}</head>`);
        const visibleLinks = (page.links ?? []).filter(l => httpsUrl(l.url) && linkTokens.includes(l.color_token));
        const linksHtml = visibleLinks.length ? `<section class="public-links" aria-label="공개 외부 링크">${visibleLinks.map(l => `<a class="public-link" target="_blank" rel="noopener noreferrer" href="${escape(httpsUrl(l.url)!)}" style="background-color:${linkColors[l.color_token].background};color:${linkTextColor(l.color_token)}">${escape(l.title)}</a>`).join('')}</section>` : '';
        const scheduleHtml=(page.schedules??[]).map(r=>`<details><summary><span class="schedule-status ${['SOON','OPEN','ALWAYS','CLOSE'].includes(r.status)?r.status:'CLOSE'}">${escape(r.status)}</span><span class="schedule-summary-title">${escape(r.title)}</span><span class="schedule-summary-date">${escape(publicSchedulePeriod(r))}</span></summary>${r.description?`<p>${escape(r.description)}</p>`:''}</details>`).join('');
        const scheduleSection=scheduleHtml?`<section class="public-schedules" aria-label="공개 일정">${scheduleHtml}</section>`:'';
        const socialsHtml=(page.socials??[]).filter(r=>socialPlatforms.includes(r.platform)&&httpsUrl(r.url)).map(r=>`<a href="${escape(httpsUrl(r.url)!)}" target="_blank" rel="noopener noreferrer" aria-label="${socialNames[r.platform]} 바로가기"><img src="/brand/social/${r.platform}.png" width="40" height="40" alt=""></a>`).join('');
        const socialSection=socialsHtml?`<section class="public-socials" aria-label="공개 SNS">${socialsHtml}</section>`:'';
        html = html.replace('<div id="root"></div>' , `<div id="root"><main class="public-page"><div class="public-cover theme-${page.profile.theme_token||'green'}">${page.profile.cover_asset_id?`<img src="/api/image/${page.profile.cover_asset_id}/original_display" alt="배경 이미지">`:'<div class="source-cover"><img src="/brand/reptilelink-source.png" alt=""></div>'}</div><div class="public-avatar"><img src="${page.profile.avatar_asset_id?`/api/image/${page.profile.avatar_asset_id}/original_display`:'/brand/profile/avatar-public.png'}" alt="프로필 이미지"></div>${page.profile.tagline?`<p class="public-tagline">${escape(page.profile.tagline)}</p>`:''}<h1>${escape(page.profile.display_name)}</h1>${page.profile.bio?`<p class="public-bio">${escape(page.profile.bio)}</p>`:''}${scheduleSection}${page.animals.map(a => `<article><h2>${escape(a.name)}</h2><p>${escape(a.species)} · ${escape(a.morph)}</p></article>`).join('')}${linksHtml}${socialSection}</main></div>`);
        html = html.replace('</body>', `<script type="application/json" id="public-bootstrap">${JSON.stringify(page).replace(/</g, '\\u003c')}</script></body>`);
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (path.startsWith('/api/')) return json({ code: 'NOT_FOUND' }, 404);
      if (path.startsWith('/u/')) return new Response('페이지를 찾을 수 없습니다.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const known = ['UNAUTHENTICATED', 'ACCOUNT_NOT_ACTIVE', 'QUOTA_EXCEEDED', 'NOT_FOUND', 'VERSION_CONFLICT', 'REQUEST_CONFLICT', 'REQUEST_EXPIRED', 'CONSENT_REQUIRED', 'UPLOAD_EXPIRED', 'INVALID_IMAGE', 'UPLOAD_INCOMPLETE', 'CLEANUP_PENDING', 'CONFIGURATION_REQUIRED', 'SERVICE_UNAVAILABLE'];
      const code = known.find(value => message.includes(value)) || 'VALIDATION_FAILED';
      return json({ code }, code === 'UNAUTHENTICATED' ? 401 : code === 'NOT_FOUND' ? 404 : code === 'ACCOUNT_NOT_ACTIVE' ? 403 : code === 'CONFIGURATION_REQUIRED' || code === 'SERVICE_UNAVAILABLE' ? 503 : 400);
    }
  },
};
