SET local check_function_bodies = off;

DROP TRIGGER "media_live_animal" ON "private"."media_assets";

ALTER TABLE "private"."media_assets"
  DROP CONSTRAINT "media_assets_purpose_check";

DROP FUNCTION "api"."save_design"(jsonb, jsonb, bigint, uuid);

ALTER TABLE "public"."profiles"
  ADD COLUMN "avatar_asset_id" uuid;

ALTER TABLE "public"."profiles"
  ADD COLUMN "cover_asset_id" uuid;

ALTER TABLE "private"."media_assets"
  ALTER COLUMN "animal_id" DROP NOT NULL;

CREATE OR REPLACE FUNCTION api.attach_photo (
  p_asset_id uuid,
  p_expected bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.lock_profile(p_expected); a private.media_assets;
begin
  perform private.check_writes();
  select * into a from private.media_assets where id=p_asset_id and profile_id=actor and purpose='animal' and state='ready' and expires_at>now() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.animal_photos where asset_id=a.id) then raise exception 'ALREADY_ATTACHED'; end if;
  insert into public.animal_photos(profile_id,animal_id,asset_id,sort_order) values(actor,a.animal_id,a.id,coalesce((select max(sort_order)+1 from public.animal_photos where animal_id=a.animal_id),0));
  update private.media_assets set expires_at=null where id=a.id;
  return jsonb_build_object('revision',private.bump(actor));
end $function$;

CREATE OR REPLACE FUNCTION api.cancel_profile_upload_request (
  p_purpose    text,
  p_request_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();receipt private.mutation_receipts;hash text;asset uuid;
begin
 if p_request_id is null or p_purpose is null or p_purpose not in('avatar','cover') then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 hash:=md5(p_purpose);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if not found then
  -- An unknown in-flight reservation must not be created after explicit cancellation wins the profile lock.
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'cancel_profile_upload_request',hash,'{}'::jsonb);return null;
 end if;
 if receipt.request_hash is distinct from hash or receipt.operation not in('reserve_profile_upload','cancel_profile_upload_request') then raise exception 'REQUEST_CONFLICT';end if;
 if receipt.operation='cancel_profile_upload_request' then return null;end if;
 asset:=(receipt.result_ref->>'id')::uuid;
 perform 1 from private.media_assets where id=asset and profile_id=actor and purpose=p_purpose for update;if not found then return null;end if;
 if exists(select 1 from public.profiles where avatar_asset_id=asset or cover_asset_id=asset) or exists(select 1 from public.animal_photos where asset_id=asset) then raise exception 'NOT_FOUND';end if;
 update private.media_assets set state='delete_pending' where id=asset;return asset;
end $function$;

CREATE OR REPLACE FUNCTION api.cleanup_manifest (
  p_asset_id uuid,
  p_actor    uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare a private.media_assets;
begin
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  select * into a from private.media_assets where id=p_asset_id and profile_id=p_actor for update;
  if not found or exists(select 1 from public.profiles where avatar_asset_id=p_asset_id or cover_asset_id=p_asset_id) or exists(select 1 from public.animal_photos where asset_id=p_asset_id) then raise exception 'NOT_FOUND'; end if;
  update private.media_assets set state='delete_pending' where id=p_asset_id;
  if a.cleanup_after>now() then return null; end if;
  return (select jsonb_agg(object_path) from private.media_objects where asset_id=p_asset_id);
end $function$;

CREATE OR REPLACE FUNCTION api.complete_upload (
  p_asset_id uuid,
  p_actor    uuid,
  p_objects  jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare a private.media_assets; o record; total bigint:=0;
begin
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  select * into a from private.media_assets where id=p_asset_id and profile_id=p_actor for update;
  if not found or not private.active(p_actor) then raise exception 'NOT_FOUND'; end if;
  if a.state='ready' then return; end if;
  if a.state<>'reserved' or a.expires_at<=now() then raise exception 'UPLOAD_EXPIRED'; end if;
  if jsonb_array_length(p_objects)<>2 then raise exception 'VALIDATION_FAILED'; end if;
  for o in select * from jsonb_to_recordset(p_objects) as x(variant text,bytes bigint,width integer,height integer,sha256 text) loop
    if o.variant is null or o.bytes is null or o.width is null or o.height is null or o.sha256 is null
       or o.variant not in ('original_display','thumbnail') or o.bytes<=0
       or o.bytes>(case when o.variant='thumbnail' then 81920 else 225280 end)
       or o.width<=0 or o.height<=0
       or greatest(o.width,o.height)>(case when o.variant='thumbnail' then 480 else 1280 end)
       or o.sha256 !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_FAILED'; end if;
    if (a.purpose='avatar' and o.width<>o.height) or (a.purpose='cover' and abs(o.height-o.width*276.0/450)>1) then raise exception 'INVALID_IMAGE'; end if;
    update private.media_objects set byte_size=o.bytes,width=o.width,height=o.height,sha256=o.sha256,state='stored' where asset_id=a.id and variant=o.variant and state='reserved';
    if not found then raise exception 'VALIDATION_FAILED'; end if;
    total:=total+o.bytes;
  end loop;
  update private.media_assets set state='ready',actual_bytes=total,verified_at=now() where id=a.id;
  update private.storage_usage set reserved_bytes=reserved_bytes-a.reservation_bytes,stored_bytes=stored_bytes+total where profile_id=p_actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes-a.reservation_bytes,media_stored_bytes=media_stored_bytes+total where id=1;
end $function$;

CREATE OR REPLACE FUNCTION api.finish_cleanup (
  p_asset_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare a private.media_assets;
begin
  perform 1 from private.project_budget where id=1 for update;
  select * into a from private.media_assets where id=p_asset_id and state='delete_pending';
  if not found then return; end if;
  if exists(select 1 from public.profiles where avatar_asset_id=p_asset_id or cover_asset_id=p_asset_id) then raise exception 'NOT_FOUND'; end if;
  if a.cleanup_after>now() then raise exception 'CLEANUP_PENDING'; end if;
  perform 1 from private.storage_usage where profile_id=a.profile_id for update;
  if exists(select 1 from storage.objects where bucket_id='animal-media' and name in (select object_path from private.media_objects where asset_id=a.id)) then raise exception 'FILES_REMAIN'; end if;
  if a.verified_at is null then
    update private.storage_usage set reserved_bytes=reserved_bytes-a.reservation_bytes where profile_id=a.profile_id;
    update private.project_budget set media_reserved_bytes=media_reserved_bytes-a.reservation_bytes where id=1;
  else
    update private.storage_usage set stored_bytes=stored_bytes-a.actual_bytes where profile_id=a.profile_id;
    update private.project_budget set media_stored_bytes=media_stored_bytes-a.actual_bytes where id=1;
  end if;
  delete from private.media_assets where id=a.id;
end $function$;

CREATE OR REPLACE FUNCTION api.media_access (
  p_asset_id uuid,
  p_variant  text,
  p_actor    uuid DEFAULT NULL::uuid
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select o.object_path from private.media_objects o join private.media_assets m on m.id=o.asset_id
 join public.animal_photos ph on ph.asset_id=m.id join public.animals a on a.id=ph.animal_id join public.profiles p on p.id=a.profile_id
 where m.id=p_asset_id and o.variant=p_variant and m.state='ready' and o.state='stored' and a.deleted_at is null and private.active(p.id)
 and (p.id=p_actor or (p.is_published and a.is_public))
 union all
 select o.object_path from private.media_objects o join private.media_assets m on m.id=o.asset_id
 join public.profiles p on p.id=m.profile_id and ((m.purpose='avatar' and p.avatar_asset_id=m.id) or (m.purpose='cover' and p.cover_asset_id=m.id))
 where m.id=p_asset_id and o.variant=p_variant and m.state='ready' and o.state='stored' and private.active(p.id) and (p.id=p_actor or p.is_published);
$function$;

CREATE OR REPLACE FUNCTION api.my_design()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();p public.profiles;begin
 select * into p from public.profiles where id=actor;if not found then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('revision',p.revision,'profile',jsonb_build_object('display_name',p.display_name,'tagline',p.tagline,'bio',p.bio),'links',(api.my_social_links()->'links'),'options',jsonb_build_object('avatar_asset_id',p.avatar_asset_id,'cover_asset_id',p.cover_asset_id,'theme_token',p.theme_token),'cleanup_count',(select count(*) from private.media_assets m where m.profile_id=actor and m.purpose in('avatar','cover') and (m.state='delete_pending' or m.expires_at<=now()) and m.id is distinct from p.avatar_asset_id and m.id is distinct from p.cover_asset_id));
end $function$;

CREATE OR REPLACE FUNCTION api.pending_profile_uploads()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$ declare actor uuid:=private.actor();begin return (select coalesce(jsonb_agg(m.id),'[]'::jsonb) from private.media_assets m where m.profile_id=actor and m.purpose in('avatar','cover') and (m.state='delete_pending' or m.expires_at<=now()) and not exists(select 1 from public.profiles p where p.avatar_asset_id=m.id or p.cover_asset_id=m.id));end $function$;

CREATE OR REPLACE FUNCTION api.profile_upload_state (
  p_assets uuid[]
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();begin
 if p_assets is null or cardinality(p_assets)>4 then raise exception 'VALIDATION_FAILED';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'purpose',m.purpose,'ready',m.state='ready','valid',m.state='ready' and (coalesce(m.expires_at>now(),false) or exists(select 1 from public.profiles p where p.id=actor and (p.avatar_asset_id=m.id or p.cover_asset_id=m.id)))) order by m.id) from private.media_assets m where m.id=any(p_assets) and m.profile_id=actor and m.purpose in('avatar','cover')),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION api.public_page (
  p_slug text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare p public.profiles;
begin
  select * into p from public.profiles where slug=p_slug and is_published;
  if not found then return null; end if;
  return jsonb_build_object('server_now',statement_timestamp(),'schedules',(api.public_schedules(p_slug)->'schedules'),'profile',jsonb_build_object('slug',p.slug,'display_name',p.display_name,'bio',p.bio,'tagline',p.tagline,'theme_token',p.theme_token,'avatar_asset_id',p.avatar_asset_id,'cover_asset_id',p.cover_asset_id),
    'socials',coalesce((select jsonb_agg(jsonb_build_object('platform',s.platform,'url',s.url) order by s.sort_order) from public.social_links s where s.profile_id=p.id and s.is_public),'[]'::jsonb),'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'url',l.url,'color_token',l.color_token) order by l.sort_order,l.id) from public.external_links l where l.profile_id=p.id and l.is_public),'[]'::jsonb),'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'species',a.species,'morph',a.morph,'sex',a.sex,'birth_date',a.birth_date,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.reserve_profile_upload (
  p_purpose    text,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();asset uuid;budget bigint:=450560;a private.media_assets;receipt private.mutation_receipts;hash text;manifest jsonb;
begin
 if p_request_id is null or p_purpose is null or p_purpose not in('avatar','cover') then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED';end if;
 hash:=md5(p_purpose);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'reserve_profile_upload' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;
  asset:=(receipt.result_ref->>'id')::uuid;
  select * into a from private.media_assets where id=asset and profile_id=actor and purpose=p_purpose for update;
  if not found or a.state not in('reserved','ready') or not(coalesce(a.expires_at>now(),false) or (a.state='ready' and exists(select 1 from public.profiles where id=actor and (avatar_asset_id=a.id or cover_asset_id=a.id)))) then raise exception 'REQUEST_EXPIRED';end if;
 else
  perform private.check_writes();
  if (select count(*) from private.media_assets where profile_id=actor and state='reserved')>=2 then raise exception 'QUOTA_EXCEEDED';end if;
  if (select count(*) from private.media_assets m where m.profile_id=actor and m.purpose=p_purpose and m.state<>'delete_pending' and not exists(select 1 from public.profiles p where p.id=actor and (p.avatar_asset_id=m.id or p.cover_asset_id=m.id)))>=2 then raise exception 'QUOTA_EXCEEDED';end if;
  if exists(select 1 from private.storage_usage where profile_id=actor and reserved_bytes+stored_bytes+budget>limit_bytes) or exists(select 1 from private.project_budget where id=1 and media_reserved_bytes+media_stored_bytes+budget>media_limit_bytes) then raise exception 'QUOTA_EXCEEDED';end if;
  asset:=gen_random_uuid();
  insert into private.media_assets(id,profile_id,animal_id,purpose,reservation_bytes,cleanup_after) values(asset,actor,null,p_purpose,budget,clock_timestamp()+interval '2 hours 5 minutes') returning * into a;
  insert into private.media_objects(asset_id,profile_id,variant,object_path,byte_size) values(asset,actor,'original_display',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',225280),(asset,actor,'thumbnail',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',81920);
  update private.storage_usage set reserved_bytes=reserved_bytes+budget where profile_id=actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes+budget where id=1;
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'reserve_profile_upload',hash,jsonb_build_object('id',asset));
 end if;
 if a.state='reserved' then perform private.check_writes();end if;
 select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) into manifest from private.media_objects where asset_id=asset;
 return jsonb_build_object('asset_id',asset,'objects',manifest,'ready',a.state='ready','expires_at',a.expires_at,'server_now',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION api.save_design (
  p_profile    jsonb,
  p_items      jsonb,
  p_expected   bigint,
  p_request_id uuid,
  p_options    jsonb  DEFAULT NULL::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();p public.profiles;receipt private.mutation_receipts;hash text;result jsonb;name_value text;tagline_value text;bio_value text;profile_changed boolean;social_changed boolean;revision bigint; options_changed boolean:=false; avatar uuid; cover uuid; theme text; asset private.media_assets;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED';end if;
 select * into p from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED';end if;
 hash:=md5((jsonb_build_object('profile',p_profile,'items',p_items)||case when p_options is null then '{}'::jsonb else jsonb_build_object('options',p_options) end)::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_design' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;return receipt.result_ref;
 end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_profile) is distinct from 'object' or not(p_profile?&array['display_name','tagline','bio']) or p_profile-array['display_name','tagline','bio']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED';end if;
 if jsonb_typeof(p_profile->'display_name') is distinct from 'string' or jsonb_typeof(p_profile->'tagline') is distinct from 'string' or jsonb_typeof(p_profile->'bio') is distinct from 'string' then raise exception 'VALIDATION_FAILED';end if;
 name_value:=private.trim_profile_text(p_profile->>'display_name');tagline_value:=private.trim_profile_text(p_profile->>'tagline');bio_value:=private.trim_profile_text(p_profile->>'bio');
 if length(name_value) not between 1 and 40 or length(tagline_value)>80 or length(bio_value)>300 or name_value~('[[:cntrl:]]|['||chr(8232)||chr(8233)||']') or tagline_value~('[[:cntrl:]]|['||chr(8232)||chr(8233)||']') then raise exception 'VALIDATION_FAILED';end if;
 profile_changed:=p.display_name is distinct from name_value or p.tagline is distinct from tagline_value or p.bio is distinct from bio_value;
 if profile_changed then perform private.check_writes();end if;
 if p_options is not null then
  if jsonb_typeof(p_options) is distinct from 'object' or not(p_options?&array['avatar_asset_id','cover_asset_id','theme_token']) or p_options-array['avatar_asset_id','cover_asset_id','theme_token']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED';end if;
  if jsonb_typeof(p_options->'theme_token') is distinct from 'string' or p_options->>'theme_token' not in('green','mint','forest') then raise exception 'VALIDATION_FAILED';end if;
  if jsonb_typeof(p_options->'avatar_asset_id') not in ('string','null') or jsonb_typeof(p_options->'cover_asset_id') not in ('string','null') then raise exception 'VALIDATION_FAILED';end if;
  begin avatar:=(p_options->>'avatar_asset_id')::uuid;cover:=(p_options->>'cover_asset_id')::uuid;exception when invalid_text_representation then raise exception 'VALIDATION_FAILED';end;
  theme:=p_options->>'theme_token';
  options_changed:=avatar is distinct from p.avatar_asset_id or cover is distinct from p.cover_asset_id or theme is distinct from p.theme_token;
  if (avatar is not null and avatar is distinct from p.avatar_asset_id) or (cover is not null and cover is distinct from p.cover_asset_id) or theme is distinct from p.theme_token then perform private.check_writes();end if;
  for asset in select * from private.media_assets where id in (avatar,cover,p.avatar_asset_id,p.cover_asset_id) order by id for update loop
   if asset.id in(avatar,cover) and (asset.profile_id<>actor or asset.state<>'ready' or (not coalesce(asset.expires_at>now(),false) and asset.id is distinct from p.avatar_asset_id and asset.id is distinct from p.cover_asset_id) or (asset.id=avatar and asset.purpose<>'avatar') or (asset.id=cover and asset.purpose<>'cover')) then raise exception 'NOT_FOUND';end if;
  end loop;
  if (avatar is not null and not exists(select 1 from private.media_assets where id=avatar and profile_id=actor and purpose='avatar' and state='ready')) or (cover is not null and not exists(select 1 from private.media_assets where id=cover and profile_id=actor and purpose='cover' and state='ready')) then raise exception 'NOT_FOUND';end if;
 end if;
 social_changed:=private.apply_social_values(actor,p_items);
 if options_changed then
  update public.profiles set avatar_asset_id=avatar,cover_asset_id=cover,theme_token=theme where id=actor;
  update private.media_assets set expires_at=null where id in(avatar,cover);
  update private.media_assets set state='delete_pending' where id in(p.avatar_asset_id,p.cover_asset_id) and id is distinct from avatar and id is distinct from cover;
 end if;
 if profile_changed then update public.profiles set display_name=name_value,tagline=tagline_value,bio=bio_value where id=actor;end if;
 if profile_changed or social_changed or options_changed then revision:=private.bump(actor);else revision:=p.revision;end if;
 result:=jsonb_build_object('revision',revision);insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_design',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION api.upload_manifest (
  p_asset_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();
begin
  if not exists(select 1 from private.media_assets where id=p_asset_id and profile_id=actor and state in ('reserved','ready') and (expires_at>now() or exists(select 1 from public.profiles p where p.avatar_asset_id=p_asset_id or p.cover_asset_id=p_asset_id))) then raise exception 'NOT_FOUND'; end if;
  return (select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) from private.media_objects where asset_id=p_asset_id);
end $function$;

ALTER TABLE "private"."media_assets"
  ADD CONSTRAINT "media_assets_purpose_check" CHECK ((purpose = ANY (ARRAY['animal'::text, 'avatar'::text, 'cover'::text])));

ALTER TABLE "private"."media_assets"
  ADD CONSTRAINT "media_assets_subject_check" CHECK ((((purpose = 'animal'::text) AND (animal_id IS
    NOT NULL)) OR ((purpose = ANY (ARRAY['avatar'::text, 'cover'::text])) AND (animal_id IS NULL))));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_avatar_owner_fkey" FOREIGN KEY (avatar_asset_id, id) REFERENCES private.media_assets(id, profile_id) DEFERRABLE;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_cover_owner_fkey" FOREIGN KEY (cover_asset_id, id) REFERENCES private.media_assets(id, profile_id) DEFERRABLE;

CREATE INDEX media_assets_profile_purpose_idx ON private.media_assets USING btree (profile_id, purpose, state);

CREATE INDEX profiles_avatar_owner_idx ON public.profiles USING btree (avatar_asset_id, id)
  WHERE (avatar_asset_id IS NOT NULL);

CREATE INDEX profiles_cover_owner_idx ON public.profiles USING btree (cover_asset_id, id)
  WHERE (cover_asset_id IS NOT NULL);

CREATE TRIGGER media_live_animal
  BEFORE INSERT ON private.media_assets
  FOR EACH ROW
  WHEN ((new.purpose = 'animal'::text))
  EXECUTE FUNCTION private.require_live_animal();

REVOKE ALL ON FUNCTION "api"."cancel_profile_upload_request"(text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."cancel_profile_upload_request"(text, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."pending_profile_uploads"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."pending_profile_uploads"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."profile_upload_state"(uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."profile_upload_state"(uuid[]) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."reserve_profile_upload"(text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."reserve_profile_upload"(text, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."save_design"(jsonb, jsonb, bigint, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."save_design"(jsonb, jsonb, bigint, uuid, jsonb) TO "authenticated";
