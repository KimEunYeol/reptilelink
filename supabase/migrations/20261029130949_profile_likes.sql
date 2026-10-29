SET local check_function_bodies = off;

ALTER TABLE "private"."action_buckets"
  DROP CONSTRAINT "action_buckets_action_check";

ALTER TABLE "private"."action_buckets"
  DROP CONSTRAINT "action_buckets_window_seconds_check";

ALTER TABLE "private"."notifications"
  DROP CONSTRAINT "notifications_kind_check";

CREATE TABLE "private"."profile_likes" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" uuid                     NOT NULL,
  "actor_id"   uuid                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profile_likes_check" CHECK ((profile_id <> actor_id)),
  CONSTRAINT "profile_likes_id_profile_id_key" UNIQUE (id, profile_id),
  CONSTRAINT "profile_likes_pkey" PRIMARY KEY (id),
  CONSTRAINT "profile_likes_profile_id_actor_id_key" UNIQUE (profile_id, actor_id)
);

ALTER TABLE "private"."profile_likes"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "private"."notifications"
  ADD COLUMN "like_id" uuid;

ALTER TABLE "private"."notifications"
  ALTER COLUMN "comment_id" DROP NOT NULL;

CREATE OR REPLACE FUNCTION api.apply_animal_collection (
  p_items      jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid := private.write_actor();
  receipt private.mutation_receipts;
  request_hash text;
  item jsonb;
  owned_count integer;
  result jsonb;
  revision bigint;
begin
  if p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id = actor
      and document_version = 'local-preview-v1' and document_kind in ('terms','privacy')) <> 2 then
    raise exception 'CONSENT_REQUIRED';
  end if;
  request_hash := md5(jsonb_build_object('items',p_items)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'apply_animal_collection' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'VALIDATION_FAILED'; end if;
  if jsonb_array_length(p_items) > 20 then raise exception 'VALIDATION_FAILED'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
    if not (item ?& array['id','is_public']) or (item - array['id','is_public']) <> '{}'::jsonb
       or jsonb_typeof(item->'id') is distinct from 'string'
       or jsonb_typeof(item->'is_public') is distinct from 'boolean' then
      raise exception 'VALIDATION_FAILED';
    end if;
    if (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION_FAILED';
    end if;
  end loop;
  select count(*) into owned_count from public.animals where profile_id = actor and deleted_at is null;
  if owned_count <> jsonb_array_length(p_items)
     or (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_items)) <> owned_count
     or (select count(*) from public.animals a join jsonb_array_elements(p_items) i on a.id = (i.value->>'id')::uuid
         where a.profile_id = actor and a.deleted_at is null) <> owned_count then
    raise exception 'VALIDATION_FAILED';
  end if;
  -- Existing privacy policy: hiding remains possible while nonessential writes are paused.
  if exists(select 1 from jsonb_array_elements(p_items) with ordinality i(value,position)
      join (select id,is_public,row_number() over(order by sort_order,id) as position
            from public.animals where profile_id=actor and deleted_at is null) a
        on a.id = (i.value->>'id')::uuid
      where a.position <> i.position or (not a.is_public and (i.value->>'is_public')::boolean)) then
    perform private.check_writes();
  end if;
  set constraints public.animals_profile_id_sort_order_key deferred;
  update public.animals a set sort_order = i.position - 1, is_public = (i.value->>'is_public')::boolean, updated_at = now()
    from jsonb_array_elements(p_items) with ordinality i(value,position)
    where a.id = (i.value->>'id')::uuid and a.profile_id = actor and a.deleted_at is null
      and (a.sort_order is distinct from i.position - 1 or a.is_public is distinct from (i.value->>'is_public')::boolean);
  if found then revision := private.bump(actor);
  else select p.revision into revision from public.profiles p where id = actor;
  end if;
  result := jsonb_build_object('revision',revision);
  perform private.record_receipt(actor,p_request_id,'apply_animal_collection',request_hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION api.apply_external_links (
  p_items      jsonb,
  p_remove     jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();receipt private.mutation_receipts;hash text;result jsonb;r jsonb;ids uuid[]:='{}'::uuid[];removed uuid[]:='{}'::uuid[];rid uuid;changed boolean;revision bigint;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND'; end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
 hash:=md5(jsonb_build_object('items',p_items,'remove',p_remove)::text);
 select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'apply_external_links' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;return receipt.result_ref;
 end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_remove) is distinct from 'array' then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_array_length(p_items)>10 or jsonb_array_length(p_remove)>10 then raise exception 'VALIDATION_FAILED'; end if;
 for r in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(r) is distinct from 'object' or not(r?&array['id','is_public']) or r-array['id','is_public']<>'{}'::jsonb or jsonb_typeof(r->'id') is distinct from 'string' or (r->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(r->'is_public') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r->>'id')::uuid;if rid=any(ids) then raise exception 'VALIDATION_FAILED'; end if;ids:=array_append(ids,rid);
 end loop;
 for r in select value from jsonb_array_elements(p_remove) loop
  if jsonb_typeof(r) is distinct from 'string' or (r#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r#>>'{}')::uuid;if rid=any(ids) or rid=any(removed) then raise exception 'VALIDATION_FAILED'; end if;removed:=array_append(removed,rid);
 end loop;
 if (select count(*) from public.external_links where profile_id=actor)<>cardinality(ids)+cardinality(removed)
 or (select count(*) from public.external_links where profile_id=actor and id=any(ids||removed))<>cardinality(ids)+cardinality(removed) then raise exception 'VALIDATION_FAILED'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) with ordinality i(value,position)
  join(select id,is_public,row_number() over(order by sort_order,id) as position from public.external_links where profile_id=actor and not(id=any(removed))) l on l.id=(i.value->>'id')::uuid
  where l.position<>i.position or (not l.is_public and (i.value->>'is_public')::boolean)) then perform private.check_writes(); end if;
 delete from public.external_links where profile_id=actor and id=any(removed);changed:=found;
 set constraints public.external_links_profile_id_sort_order_key deferred;
 update public.external_links l set sort_order=i.position-1,is_public=(i.value->>'is_public')::boolean,updated_at=now() from jsonb_array_elements(p_items) with ordinality i(value,position)
  where l.profile_id=actor and l.id=(i.value->>'id')::uuid and (l.sort_order is distinct from i.position-1 or l.is_public is distinct from (i.value->>'is_public')::boolean);
 if changed or found then revision:=private.bump(actor);else select p.revision into revision from public.profiles p where id=actor;end if;
 result:=jsonb_build_object('revision',revision);
 perform private.record_receipt(actor,p_request_id,'apply_external_links',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION api.apply_schedules (
  p_items      jsonb,
  p_remove     jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();receipt private.mutation_receipts;hash text;result jsonb;r jsonb;ids uuid[]:='{}'::uuid[];removed uuid[]:='{}'::uuid[];rid uuid;changed boolean;revision bigint;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND'; end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
 hash:=md5(jsonb_build_object('items',p_items,'remove',p_remove)::text);
 select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'apply_schedules' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;return receipt.result_ref;
 end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_remove) is distinct from 'array' then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_array_length(p_items)>20 or jsonb_array_length(p_remove)>20 then raise exception 'VALIDATION_FAILED'; end if;
 for r in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(r) is distinct from 'object' or not(r?&array['id','is_public']) or r-array['id','is_public']<>'{}'::jsonb or jsonb_typeof(r->'id') is distinct from 'string' or (r->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(r->'is_public') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r->>'id')::uuid;if rid=any(ids) then raise exception 'VALIDATION_FAILED'; end if;ids:=array_append(ids,rid);
 end loop;
 for r in select value from jsonb_array_elements(p_remove) loop
  if jsonb_typeof(r) is distinct from 'string' or (r#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r#>>'{}')::uuid;if rid=any(ids) or rid=any(removed) then raise exception 'VALIDATION_FAILED'; end if;removed:=array_append(removed,rid);
 end loop;
 if (select count(*) from public.schedules where profile_id=actor)<>cardinality(ids)+cardinality(removed)
 or (select count(*) from public.schedules where profile_id=actor and id=any(ids||removed))<>cardinality(ids)+cardinality(removed) then raise exception 'VALIDATION_FAILED'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) with ordinality i(value,position)
  join(select id,is_public,row_number() over(order by sort_order,id) as position from public.schedules where profile_id=actor and not(id=any(removed))) l on l.id=(i.value->>'id')::uuid
  where l.position<>i.position or (not l.is_public and (i.value->>'is_public')::boolean)) then perform private.check_writes(); end if;
 delete from public.schedules where profile_id=actor and id=any(removed);changed:=found;
 set constraints public.schedules_profile_id_sort_order_key deferred;
 update public.schedules l set sort_order=i.position-1,is_public=(i.value->>'is_public')::boolean,updated_at=now() from jsonb_array_elements(p_items) with ordinality i(value,position)
  where l.profile_id=actor and l.id=(i.value->>'id')::uuid and (l.sort_order is distinct from i.position-1 or l.is_public is distinct from (i.value->>'is_public')::boolean);
 if changed or found then revision:=private.bump(actor);else select p.revision into revision from public.profiles p where id=actor;end if;
 result:=jsonb_build_object('revision',revision);
 perform private.record_receipt(actor,p_request_id,'apply_schedules',hash,result);return result;
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
declare actor uuid:=private.write_actor();receipt private.mutation_receipts;hash text;asset uuid;
begin
 if p_request_id is null or p_purpose is null or p_purpose not in('avatar','cover') then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 hash:=md5(p_purpose);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if not found then
  -- An unknown in-flight reservation must not be created after explicit cancellation wins the profile lock.
  perform private.record_receipt(actor,p_request_id,'cancel_profile_upload_request',hash,'{}'::jsonb);return null;
 end if;
 if receipt.request_hash is distinct from hash or receipt.operation not in('reserve_profile_upload','cancel_profile_upload_request') then raise exception 'REQUEST_CONFLICT';end if;
 if receipt.operation='cancel_profile_upload_request' then return null;end if;
 asset:=(receipt.result_ref->>'id')::uuid;
 perform 1 from private.media_assets where id=asset and profile_id=actor and purpose=p_purpose for update;if not found then return null;end if;
 if exists(select 1 from public.profiles where avatar_asset_id=asset or cover_asset_id=asset) or exists(select 1 from public.animal_photos where asset_id=asset) then raise exception 'NOT_FOUND';end if;
 update private.media_assets set state='delete_pending' where id=asset;return asset;
end $function$;

CREATE OR REPLACE FUNCTION api.create_animal (
  p_data       jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid; animal_id uuid; result jsonb; old_receipt private.mutation_receipts;
begin
  perform private.check_writes();
  actor:=private.write_actor();
  -- Serializing by profile also serializes receipt checks and item quota checks.
  perform 1 from public.profiles where id=actor for update;
  select * into old_receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
  if found then
    if old_receipt.operation<>'create_animal' or old_receipt.request_hash<>md5(p_data::text) then raise exception 'REQUEST_CONFLICT'; end if;
    return old_receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if (select count(*) from public.animals where profile_id=actor)>=20 then raise exception 'QUOTA_EXCEEDED'; end if;
  insert into public.animals(profile_id,name,species,morph,sex,description,is_public,listing_status,sort_order)
  values(actor,trim(p_data->>'name'),trim(p_data->>'species'),coalesce(p_data->>'morph',''),coalesce(p_data->>'sex','unknown'),coalesce(p_data->>'description',''),coalesce((p_data->>'is_public')::boolean,false),coalesce(p_data->>'listing_status','not_listed'),coalesce((select max(sort_order)+1 from public.animals where profile_id=actor),0))
  returning id into animal_id;
  result:=jsonb_build_object('id',animal_id,'revision',private.bump(actor));
  perform private.record_receipt(actor,p_request_id,'create_animal',md5(p_data::text),result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION api.delete_animal (
  p_animal_id  uuid,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor(); receipt private.mutation_receipts; hash text; a public.animals; result jsonb;
begin
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  perform 1 from public.profiles where id=actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
  hash:=md5(jsonb_build_object('animal_id',p_animal_id)::text);
  select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.operation<>'delete_animal' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
    if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  select * into a from public.animals where id=p_animal_id and profile_id=actor and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform private.lock_profile(p_expected);
  update public.animals set deleted_at=now(),is_public=false,updated_at=now() where id=a.id;
  delete from public.animal_photos where animal_id=a.id and profile_id=actor;
  update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where animal_id=a.id and profile_id=actor;
  insert into private.animal_deletions(animal_id,profile_id,animal_name,request_id) values(a.id,actor,a.name,p_request_id);
  result:=jsonb_build_object('id',a.id,'revision',private.bump(actor));
  perform private.record_receipt(actor,p_request_id,'delete_animal',hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION api.finish_account_data (
  p_actor uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j private.account_deletions;begin
 perform 1 from private.account_state where user_id=p_actor for update;
 select * into j from private.account_deletions where user_id=p_actor for update;
 if not found or j.sessions_revoked_at is null then raise exception 'CLEANUP_PENDING';end if;
 if j.application_deleted_at is not null then return true;end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=p_actor for update;
 perform 1 from public.profiles where id=p_actor for update;
 if exists(select 1 from private.media_assets where profile_id=p_actor) then return false;end if;
 if exists(select 1 from private.storage_usage where profile_id=p_actor and (stored_bytes<>0 or reserved_bytes<>0)) then raise exception 'FILES_REMAIN';end if;
 delete from private.profile_likes where actor_id=p_actor;
 delete from public.comments where author_id=p_actor;
 delete from private.content_reports where reporter_id=p_actor;
 delete from private.action_buckets where actor_id=p_actor;
 delete from private.animal_deletions where profile_id=p_actor;
 delete from private.storage_usage where profile_id=p_actor;
 delete from public.profiles where id=p_actor;
 update private.account_deletions set application_deleted_at=now() where user_id=p_actor;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION api.my_existing_profile_like (
  p_slug text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 SELECT jsonb_build_object('liked',EXISTS(SELECT 1 FROM private.profile_likes l JOIN public.profiles p ON p.id=l.profile_id WHERE l.actor_id=auth.uid() AND p.slug=p_slug),'can_cancel',coalesce(private.activity_member(auth.uid()),false),'signed_in',auth.uid() IS NOT NULL);
$function$;

CREATE OR REPLACE FUNCTION api.my_profile_likes (
  p_before    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id uuid                     DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE actor uuid:=private.actor();rows jsonb;more boolean;cursor_at timestamptz;cursor_id uuid;
BEGIN
 IF (p_before IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'VALIDATION_FAILED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 WITH page AS(SELECT * FROM private.profile_likes WHERE profile_id=actor AND (p_before IS NULL OR(created_at,id)<(p_before,p_before_id)) ORDER BY created_at DESC,id DESC LIMIT 21),shown AS(SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT 20)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'created_at',l.created_at,'author',jsonb_build_object('name',coalesce(p.display_name,'회원'),'slug',p.slug,'avatar_asset_id',p.avatar_asset_id)) ORDER BY l.created_at DESC,l.id DESC),'[]'::jsonb),(SELECT count(*)>20 FROM page) INTO rows,more
 FROM shown l LEFT JOIN public.profiles p ON p.id=l.actor_id AND p.is_published AND private.active(p.id);
 IF more THEN SELECT(r->>'created_at')::timestamptz,(r->>'id')::uuid INTO cursor_at,cursor_id FROM jsonb_array_elements(rows) WITH ORDINALITY x(r,n) ORDER BY n DESC LIMIT 1;END IF;
 RETURN jsonb_build_object('rows',rows,'total',(SELECT count(*) FROM private.profile_likes WHERE profile_id=actor),'next',CASE WHEN more THEN jsonb_build_object('before',cursor_at,'id',cursor_id) ELSE NULL END);
END $function$;

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
  return jsonb_build_object('like_count',api.public_profile_like_count(p_slug),'server_now',statement_timestamp(),'schedules',(api.public_schedules(p_slug)->'schedules'),'profile',jsonb_build_object('slug',p.slug,'display_name',p.display_name,'bio',p.bio,'tagline',p.tagline,'theme_token',p.theme_token,'avatar_asset_id',p.avatar_asset_id,'cover_asset_id',p.cover_asset_id),
    'socials',coalesce((select jsonb_agg(jsonb_build_object('platform',s.platform,'url',s.url) order by s.sort_order) from public.social_links s where s.profile_id=p.id and s.is_public),'[]'::jsonb),'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'url',l.url,'color_token',l.color_token) order by l.sort_order,l.id) from public.external_links l where l.profile_id=p.id and l.is_public),'[]'::jsonb),'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'comment_count',api.public_comment_count(a.id),'species',a.species,'morph',a.morph,'sex',a.sex,'birth_date',a.birth_date,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.public_profile_like_count (
  p_slug text
)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 SELECT count(*)::integer FROM private.profile_likes l JOIN public.profiles p ON p.id=l.profile_id WHERE p.slug=p_slug AND p.is_published AND private.active(p.id);
$function$;

CREATE OR REPLACE FUNCTION api.public_profile_likes (
  p_slug text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE p public.profiles;actor uuid:=auth.uid();BEGIN
 SELECT * INTO p FROM public.profiles WHERE slug=p_slug AND is_published AND private.active(id);IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('count',(SELECT count(*) FROM private.profile_likes WHERE profile_id=p.id),'liked',EXISTS(SELECT 1 FROM private.profile_likes WHERE profile_id=p.id AND actor_id=actor),'ready',coalesce(private.activity_member(actor),false),'signed_in',actor IS NOT NULL,'is_owner',coalesce(actor=p.id,false));
END $function$;

CREATE OR REPLACE FUNCTION api.request_account_deletion (
  p_expected   bigint,
  p_request_id uuid,
  p_confirm    text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=auth.uid();p public.profiles;r private.mutation_receipts;hash text:=md5('withdrawal:confirmed');result jsonb;
begin
 if actor is null then raise exception 'UNAUTHENTICATED';end if;
 if p_request_id is null or p_confirm is distinct from '탈퇴' then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.account_state where user_id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 select * into r from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if r.operation<>'delete_account' or r.request_hash<>hash then raise exception 'REQUEST_CONFLICT';end if;
  return api.my_account_deletion();
 end if;
 perform 1 from private.account_deletions where user_id=actor;
 if found then raise exception 'REQUEST_CONFLICT';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;
 select * into p from public.profiles where id=actor for update;
 if (found and p.revision is distinct from p_expected) or (not found and p_expected is not null) then raise exception 'VERSION_CONFLICT';end if;
 update private.account_state set status='deleting' where user_id=actor;
 insert into private.account_deletions(user_id,request_id) values(actor,p_request_id);
 update public.profiles set is_published=false,avatar_asset_id=null,cover_asset_id=null,revision=revision+1,updated_at=now() where id=actor;
 update public.animals set is_public=false,deleted_at=coalesce(deleted_at,now()),updated_at=now() where profile_id=actor;
 delete from private.profile_likes where actor_id=actor;
 update public.comments set body=null,status='deleted',deleted_at=coalesce(deleted_at,now()),updated_at=now() where author_id=actor and status<>'deleted';
 delete from public.animal_photos where profile_id=actor;
 update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where profile_id=actor;
 -- Bind invitations at signup so a later email change cannot revive the original invitation.
 delete from private.signup_allowlist where invited_user_id=actor or normalized_email=(select lower(trim(email)) from auth.users where id=actor);
 result:=api.my_account_deletion();
 perform private.record_receipt(actor,p_request_id,'delete_account',hash,jsonb_build_object('requested',true));
 return result;
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
declare actor uuid:=private.write_actor();asset uuid;budget bigint:=450560;a private.media_assets;receipt private.mutation_receipts;hash text;manifest jsonb;
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
  perform private.record_receipt(actor,p_request_id,'reserve_profile_upload',hash,jsonb_build_object('id',asset));
 end if;
 if a.state='reserved' then perform private.check_writes();end if;
 select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) into manifest from private.media_objects where asset_id=asset;
 return jsonb_build_object('asset_id',asset,'objects',manifest,'ready',a.state='ready','expires_at',a.expires_at,'server_now',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION api.save_animal_edit (
  p_animal_id  uuid,
  p_data       jsonb,
  p_assets     jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid;
  receipt private.mutation_receipts;
  request_hash text;
  result jsonb;
  field text;
  animal_name text;
  animal_species text;
  animal_morph text;
  animal_description text;
  birthday date;
  assets uuid[];
  previous_assets uuid[];
begin
  perform 1 from private.project_budget where id=1 for update;
  actor := private.write_actor();
  perform 1 from private.storage_usage where profile_id=actor for update;
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  -- Match existing owner commands: serialize profile, receipts and revision together.
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id = actor
      and document_version = 'local-preview-v1' and document_kind in ('terms','privacy')) <> 2 then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if not exists(select 1 from public.animals where id = p_animal_id and profile_id = actor) then
    raise exception 'NOT_FOUND';
  end if;
  request_hash := md5(jsonb_build_object('animal_id', p_animal_id, 'data', p_data, 'assets', p_assets)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'save_animal_edit' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
  if not (p_data ?& array['name','species','morph','sex','birth_date','description','listing_status'])
     or (p_data - array['name','species','morph','sex','birth_date','description','listing_status']) <> '{}'::jsonb then
    raise exception 'VALIDATION_FAILED';
  end if;
  foreach field in array array['name','species','morph','sex','description','listing_status'] loop
    if jsonb_typeof(p_data -> field) is distinct from 'string' then raise exception 'VALIDATION_FAILED'; end if;
  end loop;
  animal_name := regexp_replace(p_data->>'name', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_species := regexp_replace(p_data->>'species', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_morph := regexp_replace(p_data->>'morph', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_description := regexp_replace(p_data->>'description', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  if length(animal_name) not between 1 and 40 or length(animal_species) not between 1 and 80
     or length(animal_morph) > 120 or length(animal_description) > 500
     or (p_data->>'sex') not in ('unknown','male','female')
     or (p_data->>'listing_status') not in ('not_listed','available','reserved','rehomed') then
    raise exception 'VALIDATION_FAILED';
  end if;
  if jsonb_typeof(p_data->'birth_date') = 'null' then birthday := null;
  elsif jsonb_typeof(p_data->'birth_date') = 'string' and (p_data->>'birth_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      birthday := (p_data->>'birth_date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'VALIDATION_FAILED';
    end;
  else raise exception 'VALIDATION_FAILED';
  end if;
  if jsonb_typeof(p_assets) is distinct from 'array' or jsonb_array_length(p_assets)>3 then raise exception 'VALIDATION_FAILED'; end if;
  if exists(select 1 from jsonb_array_elements(p_assets) x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'VALIDATION_FAILED'; end if;
  select coalesce(array_agg(x::uuid order by ord),'{}'::uuid[]) into assets from jsonb_array_elements_text(p_assets) with ordinality as e(x,ord);
  if cardinality(assets)<>(select count(distinct x) from unnest(assets) x) then raise exception 'VALIDATION_FAILED'; end if;
  -- Upload and cleanup lock assets after the profile/budget locks. No external IO here.
  perform 1 from private.media_assets where id=any(assets) order by id for update;
  if exists(select 1 from unnest(assets) x where not exists(select 1 from private.media_assets m
    where m.id=x and m.profile_id=actor and m.animal_id=p_animal_id and m.purpose='animal' and m.state='ready'
      and m.verified_at is not null and (m.expires_at is null or m.expires_at>now())
      and (select count(*) from private.media_objects o where o.asset_id=m.id and o.state='stored')=2)) then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(asset_id order by sort_order),'{}'::uuid[]) into previous_assets from public.animal_photos where animal_id=p_animal_id and profile_id=actor;
  if not (select writes_enabled from private.project_budget where id=1) then
    if assets is distinct from array(select x from unnest(previous_assets) x where x=any(assets))
      or not exists(select 1 from public.animals a where a.id=p_animal_id and a.profile_id=actor
        and a.name=animal_name and a.species=animal_species and a.morph=animal_morph
        and a.sex=p_data->>'sex' and a.birth_date is not distinct from birthday
        and a.description=animal_description and a.listing_status=p_data->>'listing_status')
    then raise exception 'SERVICE_UNAVAILABLE'; end if;
  end if;
  delete from public.animal_photos where animal_id=p_animal_id and profile_id=actor;
  insert into public.animal_photos(profile_id,animal_id,asset_id,sort_order)
    select actor,p_animal_id,x,(ord-1)::integer from unnest(assets) with ordinality as e(x,ord);
  update private.media_assets set expires_at=null where id=any(assets);
  update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where id=any(previous_assets) and not(id=any(assets));
  update public.animals set name = animal_name, species = animal_species, morph = animal_morph,
    sex = p_data->>'sex', birth_date = birthday, description = animal_description,
    listing_status = p_data->>'listing_status', updated_at = now()
    where id = p_animal_id and profile_id = actor;
  result := jsonb_build_object('id', p_animal_id, 'revision', private.bump(actor));
  perform private.record_receipt(actor,p_request_id,'save_animal_edit',request_hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION api.save_animal_growth (
  p_animal_id  uuid,
  p_data       jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();receipt private.mutation_receipts;hash text;result jsonb;a public.animals;
 r jsonb;rid uuid;day date;weight numeric;old_note text;ids uuid[]:='{}'::uuid[];removed uuid[]:='{}'::uuid[];
begin
 if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
 perform 1 from public.profiles where id=actor for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
 hash:=md5(jsonb_build_object('animal_id',p_animal_id,'data',p_data)::text);
 select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_animal_growth' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;
  return receipt.result_ref;
 end if;
 select * into a from public.animals where id=p_animal_id and profile_id=actor and deleted_at is null for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_data) is distinct from 'object' or not(p_data?&array['upsert','remove','note','show_growth'])
 or p_data-array['upsert','remove','note','show_growth']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_typeof(p_data->'upsert') is distinct from 'array' or jsonb_typeof(p_data->'remove') is distinct from 'array'
 or jsonb_typeof(p_data->'note') is distinct from 'string' or jsonb_typeof(p_data->'show_growth') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_array_length(p_data->'upsert')>100 or jsonb_array_length(p_data->'remove')>100 or length(p_data->>'note')>2000 then raise exception 'VALIDATION_FAILED'; end if;
 for r in select value from jsonb_array_elements(p_data->'upsert') loop
  if jsonb_typeof(r) is distinct from 'object' or not(r?&array['id','measured_on','weight_g','note']) or r-array['id','measured_on','weight_g','note']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
  if jsonb_typeof(r->'id') is distinct from 'string' or (r->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(r->'measured_on') is distinct from 'string' or (r->>'measured_on')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(r->'weight_g') is distinct from 'string' or (r->>'weight_g')!~'^[0-9]{1,6}(\.[0-9]{1,2})?$'
  or jsonb_typeof(r->'note') is distinct from 'string' or length(r->>'note')>1000 then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r->>'id')::uuid;
  if rid=any(ids) then raise exception 'VALIDATION_FAILED'; end if;ids:=array_append(ids,rid);
  if exists(select 1 from public.growth_records where id=rid and (animal_id<>a.id or profile_id<>actor)) then raise exception 'NOT_FOUND'; end if;
  begin day:=(r->>'measured_on')::date;exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_FAILED';end;
  weight:=(r->>'weight_g')::numeric;
  if to_char(day,'YYYY-MM-DD')<>r->>'measured_on' or day>(now() at time zone 'Asia/Seoul')::date or weight<=0 or weight>100000 then raise exception 'VALIDATION_FAILED'; end if;
 end loop;
 for r in select value from jsonb_array_elements(p_data->'remove') loop
  if jsonb_typeof(r) is distinct from 'string' or (r#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r#>>'{}')::uuid;
  if rid=any(removed) or rid=any(ids) then raise exception 'VALIDATION_FAILED'; end if;removed:=array_append(removed,rid);
  if not exists(select 1 from public.growth_records where id=rid and animal_id=a.id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
 end loop;
 select coalesce((select body from private.animal_notes where animal_id=a.id and profile_id=actor),'') into old_note;
 if cardinality(ids)>0 or (not a.show_growth and (p_data->>'show_growth')::boolean) or ((p_data->>'note')<>old_note and (p_data->>'note')<>'') then perform private.check_writes(); end if;
 delete from public.growth_records where id=any(removed) and animal_id=a.id and profile_id=actor;
 set constraints public.growth_animal_day_key deferred;
 for r in select value from jsonb_array_elements(p_data->'upsert') loop
  rid:=(r->>'id')::uuid;
  insert into public.growth_records(id,profile_id,animal_id,measured_on,weight_g) values(rid,actor,a.id,(r->>'measured_on')::date,(r->>'weight_g')::numeric)
   on conflict(id) do update set measured_on=excluded.measured_on,weight_g=excluded.weight_g,updated_at=now()
    where growth_records.profile_id=actor and growth_records.animal_id=a.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r->>'note'='' then delete from private.growth_notes where record_id=rid and profile_id=actor;
  else insert into private.growth_notes(record_id,profile_id,body) values(rid,actor,r->>'note') on conflict(record_id) do update set body=excluded.body,updated_at=now(); end if;
 end loop;
 if exists(select 1 from public.growth_records where animal_id=a.id group by measured_on having count(*)>1) then raise exception 'VALIDATION_FAILED'; end if;
 if (select count(*) from public.growth_records where profile_id=actor)>3000 then raise exception 'QUOTA_EXCEEDED'; end if;
 if p_data->>'note'='' then delete from private.animal_notes where animal_id=a.id and profile_id=actor;
 else insert into private.animal_notes(animal_id,profile_id,body) values(a.id,actor,p_data->>'note') on conflict(animal_id) do update set body=excluded.body,updated_at=now(); end if;
 update public.animals set show_growth=(p_data->>'show_growth')::boolean,updated_at=now() where id=a.id;
 result:=jsonb_build_object('id',a.id,'revision',private.bump(actor));
 perform private.record_receipt(actor,p_request_id,'save_animal_growth',hash,result);
 return result;
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
declare actor uuid:=private.write_actor();p public.profiles;receipt private.mutation_receipts;hash text;result jsonb;name_value text;tagline_value text;bio_value text;profile_changed boolean;social_changed boolean;revision bigint; options_changed boolean:=false; avatar uuid; cover uuid; theme text; asset private.media_assets;
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
 result:=jsonb_build_object('revision',revision);perform private.record_receipt(actor,p_request_id,'save_design',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION api.save_external_link (
  p_link_id    uuid,
  p_data       jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();receipt private.mutation_receipts;hash text;result jsonb;link_id uuid;title_value text;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND'; end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
 hash:=md5(jsonb_build_object('link_id',p_link_id,'data',p_data)::text);
 select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_external_link' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;return receipt.result_ref;
 end if;
 if p_link_id is not null and not exists(select 1 from public.external_links where id=p_link_id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
 perform private.lock_profile(p_expected);perform private.check_writes();
 if jsonb_typeof(p_data) is distinct from 'object' or not(p_data?&array['title','url','color_token']) or p_data-array['title','url','color_token']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_typeof(p_data->'title') is distinct from 'string' or jsonb_typeof(p_data->'url') is distinct from 'string' or jsonb_typeof(p_data->'color_token') is distinct from 'string' then raise exception 'VALIDATION_FAILED'; end if;
 title_value:=regexp_replace(p_data->>'title',('^[[:space:]'||chr(65279)||']+|[[:space:]'||chr(65279)||']+$'),'','g');
 if length(title_value) not between 1 and 40 or not private.valid_https_url(p_data->>'url') or p_data->>'color_token' not in ('black','gray','blue','mint','green','light-pink','pink','red','purple','yellow','orange') then raise exception 'VALIDATION_FAILED'; end if;
 if p_link_id is null then
  if (select count(*) from public.external_links where profile_id=actor)>=10 then raise exception 'QUOTA_EXCEEDED'; end if;
  insert into public.external_links(profile_id,title,url,color_token,sort_order) values(actor,title_value,p_data->>'url',p_data->>'color_token',coalesce((select max(sort_order)+1 from public.external_links where profile_id=actor),0)) returning id into link_id;
 else
  update public.external_links set title=title_value,url=p_data->>'url',color_token=p_data->>'color_token',updated_at=now() where id=p_link_id and profile_id=actor returning id into link_id;
  if not found then raise exception 'NOT_FOUND'; end if;
 end if;
 result:=jsonb_build_object('id',link_id,'revision',private.bump(actor));
 perform private.record_receipt(actor,p_request_id,'save_external_link',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION api.save_schedule (
  p_schedule_id uuid,
  p_data        jsonb,
  p_expected    bigint,
  p_request_id  uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();receipt private.mutation_receipts;hash text;result jsonb;item public.schedules;new_id uuid;title_value text;starts_value timestamptz;ends_value timestamptz;always_value boolean;closed_value boolean;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED';end if;
 hash:=md5(jsonb_build_object('id',p_schedule_id,'data',p_data)::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_schedule' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;return receipt.result_ref;
 end if;
 if p_schedule_id is not null then select * into item from public.schedules where id=p_schedule_id and profile_id=actor;if not found then raise exception 'NOT_FOUND';end if;end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_data) is distinct from 'object' or not(p_data?&array['title','description','starts_at','ends_at','is_always','is_closed']) or p_data-array['title','description','starts_at','ends_at','is_always','is_closed']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED';end if;
 if jsonb_typeof(p_data->'title') is distinct from 'string' or jsonb_typeof(p_data->'description') is distinct from 'string' or jsonb_typeof(p_data->'is_always') is distinct from 'boolean' or jsonb_typeof(p_data->'is_closed') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED';end if;
 title_value:=regexp_replace(p_data->>'title',('^[[:space:]'||chr(65279)||']+|[[:space:]'||chr(65279)||']+$'),'','g');always_value:=(p_data->>'is_always')::boolean;closed_value:=(p_data->>'is_closed')::boolean;
 if length(title_value) not between 1 and 80 or length(p_data->>'description')>300 then raise exception 'VALIDATION_FAILED';end if;
 if always_value then
  if p_data->'starts_at'<>'null'::jsonb or p_data->'ends_at'<>'null'::jsonb then raise exception 'VALIDATION_FAILED';end if;
 else
  if jsonb_typeof(p_data->'starts_at') is distinct from 'string' or jsonb_typeof(p_data->'ends_at') is distinct from 'string' or (p_data->>'starts_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' or (p_data->>'ends_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' then raise exception 'VALIDATION_FAILED';end if;
  starts_value:=(p_data->>'starts_at')::timestamptz;ends_value:=(p_data->>'ends_at')::timestamptz;
  if ends_value<=starts_value or to_char(starts_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>(case when position('.' in p_data->>'starts_at')=0 then replace(p_data->>'starts_at','Z','.000Z') else p_data->>'starts_at' end) or to_char(ends_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>(case when position('.' in p_data->>'ends_at')=0 then replace(p_data->>'ends_at','Z','.000Z') else p_data->>'ends_at' end) then raise exception 'VALIDATION_FAILED';end if;
 end if;
 if p_schedule_id is null or item.title is distinct from title_value or item.description is distinct from p_data->>'description' or item.starts_at is distinct from starts_value or item.ends_at is distinct from ends_value or item.is_always is distinct from always_value or (item.is_closed and not closed_value) then perform private.check_writes();end if;
 if p_schedule_id is null then
  if (select count(*) from public.schedules where profile_id=actor)>=20 then raise exception 'QUOTA_EXCEEDED';end if;
  insert into public.schedules(profile_id,title,description,starts_at,ends_at,is_always,is_closed,sort_order) values(actor,title_value,p_data->>'description',starts_value,ends_value,always_value,closed_value,coalesce((select max(sort_order)+1 from public.schedules where profile_id=actor),0)) returning id into new_id;
 else
  update public.schedules set title=title_value,description=p_data->>'description',starts_at=starts_value,ends_at=ends_value,is_always=always_value,is_closed=closed_value,updated_at=now() where id=p_schedule_id and profile_id=actor returning id into new_id;if not found then raise exception 'NOT_FOUND';end if;
 end if;
 result:=jsonb_build_object('id',new_id,'revision',private.bump(actor));perform private.record_receipt(actor,p_request_id,'save_schedule',hash,result);return result;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_FAILED';
end $function$;

CREATE OR REPLACE FUNCTION api.save_social_links (
  p_items      jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();receipt private.mutation_receipts;hash text;result jsonb;changed boolean;revision bigint;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED';end if;
 hash:=md5(p_items::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_social_links' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;return receipt.result_ref;
 end if;
 perform private.lock_profile(p_expected);changed:=private.apply_social_values(actor,p_items);
 if changed then revision:=private.bump(actor);else select p.revision into revision from public.profiles p where id=actor;end if;
 result:=jsonb_build_object('revision',revision);perform private.record_receipt(actor,p_request_id,'save_social_links',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION api.set_profile_like (
  p_slug       text,
  p_liked      boolean,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE actor uuid:=private.activity_actor();hash text:=md5(jsonb_build_object('slug',p_slug,'liked',p_liked)::text);result jsonb;p public.profiles;like_uuid uuid;
BEGIN
 result:=private.replay_activity(actor,p_request_id,'profile_like',hash);IF result IS NOT NULL THEN RETURN result;END IF;
 IF p_liked IS NULL OR p_slug IS NULL THEN RAISE EXCEPTION 'VALIDATION_FAILED';END IF;
 p:=private.lock_like_profile(p_slug,p_liked);
 IF p.id=actor THEN RAISE EXCEPTION 'VALIDATION_FAILED';END IF;
 result:=private.claim_activity(actor,p_request_id,'profile_like',hash);IF result IS NOT NULL THEN RETURN result;END IF;
 PERFORM private.consume_activity_rate(actor,'like');
 IF p_liked THEN
  PERFORM private.check_writes();
  INSERT INTO private.profile_likes(profile_id,actor_id) VALUES(p.id,actor) ON CONFLICT(profile_id,actor_id) DO NOTHING RETURNING id INTO like_uuid;
  IF FOUND THEN INSERT INTO private.notifications(recipient_id,kind,like_id) VALUES(p.id,'profile_like',like_uuid);
  ELSE SELECT id INTO like_uuid FROM private.profile_likes WHERE profile_id=p.id AND actor_id=actor;END IF;
 ELSE
  DELETE FROM private.profile_likes WHERE profile_id=p.id AND actor_id=actor;
 END IF;
 result:=jsonb_build_object('liked',p_liked,'like_id',like_uuid);
 UPDATE private.mutation_receipts SET result_ref=result WHERE actor_id=actor AND request_id=p_request_id;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 IF private.active(actor) THEN result:=private.replay_activity(actor,p_request_id,'profile_like',hash);IF result IS NOT NULL THEN RETURN result;END IF;END IF;RAISE;
END $function$;

CREATE OR REPLACE FUNCTION api.update_animal (
  p_animal_id  uuid,
  p_data       jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid;
  receipt private.mutation_receipts;
  request_hash text;
  result jsonb;
  field text;
  animal_name text;
  animal_species text;
  animal_morph text;
  animal_description text;
  birthday date;
begin
  perform private.check_writes();
  actor := private.write_actor();
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  -- Match existing owner commands: serialize profile, receipts and revision together.
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id = actor
      and document_version = 'local-preview-v1' and document_kind in ('terms','privacy')) <> 2 then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if not exists(select 1 from public.animals where id = p_animal_id and profile_id = actor) then
    raise exception 'NOT_FOUND';
  end if;
  request_hash := md5(jsonb_build_object('animal_id', p_animal_id, 'data', p_data)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'update_animal' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
  if not (p_data ?& array['name','species','morph','sex','birth_date','description','listing_status'])
     or (p_data - array['name','species','morph','sex','birth_date','description','listing_status']) <> '{}'::jsonb then
    raise exception 'VALIDATION_FAILED';
  end if;
  foreach field in array array['name','species','morph','sex','description','listing_status'] loop
    if jsonb_typeof(p_data -> field) is distinct from 'string' then raise exception 'VALIDATION_FAILED'; end if;
  end loop;
  animal_name := regexp_replace(p_data->>'name', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_species := regexp_replace(p_data->>'species', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_morph := regexp_replace(p_data->>'morph', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_description := regexp_replace(p_data->>'description', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  if length(animal_name) not between 1 and 40 or length(animal_species) not between 1 and 80
     or length(animal_morph) > 120 or length(animal_description) > 500
     or (p_data->>'sex') not in ('unknown','male','female')
     or (p_data->>'listing_status') not in ('not_listed','available','reserved','rehomed') then
    raise exception 'VALIDATION_FAILED';
  end if;
  if jsonb_typeof(p_data->'birth_date') = 'null' then birthday := null;
  elsif jsonb_typeof(p_data->'birth_date') = 'string' and (p_data->>'birth_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      birthday := (p_data->>'birth_date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'VALIDATION_FAILED';
    end;
  else raise exception 'VALIDATION_FAILED';
  end if;
  update public.animals set name = animal_name, species = animal_species, morph = animal_morph,
    sex = p_data->>'sex', birth_date = birthday, description = animal_description,
    listing_status = p_data->>'listing_status', updated_at = now()
    where id = p_animal_id and profile_id = actor;
  result := jsonb_build_object('id', p_animal_id, 'revision', private.bump(actor));
  perform private.record_receipt(actor,p_request_id,'update_animal',request_hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION private.consume_activity_rate (
  p_actor  uuid,
  p_action text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ts timestamptz:=clock_timestamp();seconds integer;cap integer;start_at timestamptz;total integer;begin
 if p_action is null or p_action not in('comment','report','like') then raise exception 'VALIDATION_FAILED';end if;
 foreach seconds in array(case when p_action='like' then array[3600] when p_action='comment' then array[2,60,86400] else array[2,86400] end) loop
  cap:=case when seconds=3600 then 60 when seconds=2 then 1 when seconds=60 then 3 when p_action='comment' then 30 else 5 end;
  start_at:=case when seconds=86400 then date_trunc('day',ts at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' else to_timestamp(floor(extract(epoch from ts)/seconds)*seconds) end;
  insert into private.action_buckets(actor_id,action,window_started_at,window_seconds,count,expires_at) values(p_actor,p_action,start_at,seconds,1,ts+interval '47 hours')
  on conflict(actor_id,action,window_started_at,window_seconds) do update set count=private.action_buckets.count+1 returning count into total;
  if total>cap then raise exception 'RATE_LIMITED' using hint=greatest(1,ceil(extract(epoch from start_at+make_interval(secs=>seconds)-ts)))::text;end if;
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.lock_like_profile (
  p_slug   text,
  p_public boolean
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE target uuid; p public.profiles;
BEGIN
 SELECT id INTO target FROM public.profiles WHERE slug=p_slug;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM 1 FROM private.account_state WHERE user_id=target FOR SHARE;
 SELECT * INTO p FROM public.profiles WHERE id=target FOR UPDATE;
 IF NOT FOUND OR (p_public AND (NOT p.is_published OR NOT private.active(p.id))) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 RETURN p;
END $function$;

CREATE OR REPLACE FUNCTION private.record_receipt (
  p_actor     uuid,
  p_request   uuid,
  p_operation text,
  p_hash      text,
  p_result    jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
 IF p_request IS NULL THEN RAISE EXCEPTION 'VALIDATION_FAILED';END IF;
 INSERT INTO private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) VALUES(p_actor,p_request,p_operation,p_hash,p_result) ON CONFLICT(actor_id,request_id) DO NOTHING;
 IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_CONFLICT';END IF;
END $function$;

ALTER TABLE "private"."action_buckets"
  ADD CONSTRAINT "action_buckets_action_check" CHECK ((action = ANY (ARRAY['comment'::text, 'report'::text, 'like'::text])));

ALTER TABLE "private"."action_buckets"
  ADD CONSTRAINT "action_buckets_window_seconds_check" CHECK ((window_seconds = ANY (ARRAY[2, 60, 3600, 86400])));

ALTER TABLE "private"."notifications"
  ADD CONSTRAINT "notifications_kind_reference_check" CHECK ((((kind = 'comment'::text) AND (comment_id IS
    NOT NULL) AND (like_id IS NULL)) OR ((kind = 'profile_like'::text) AND (like_id IS NOT NULL) AND (comment_id IS NULL))));

ALTER TABLE "private"."notifications"
  ADD CONSTRAINT "notifications_like_id_key" UNIQUE (like_id);

ALTER TABLE "private"."profile_likes"
  ADD CONSTRAINT "profile_likes_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "private"."notifications"
  ADD CONSTRAINT "notifications_like_recipient_fk" FOREIGN KEY (like_id, recipient_id) REFERENCES private.profile_likes(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "private"."profile_likes"
  ADD CONSTRAINT "profile_likes_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX profile_likes_actor_idx ON private.profile_likes USING btree (actor_id);

CREATE INDEX profile_likes_owner_page_idx ON private.profile_likes USING btree (profile_id, created_at DESC, id DESC);

REVOKE ALL ON FUNCTION "api"."my_existing_profile_like"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_existing_profile_like"(text) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "api"."my_profile_likes"(timestamp WITH time zone, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_profile_likes"(timestamp WITH time zone, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."public_profile_like_count"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."public_profile_like_count"(text) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "api"."public_profile_likes"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."public_profile_likes"(text) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "api"."set_profile_like"(text, boolean, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."set_profile_like"(text, boolean, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."lock_like_profile"(text, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."record_receipt"(uuid, uuid, text, text, jsonb) FROM PUBLIC;
