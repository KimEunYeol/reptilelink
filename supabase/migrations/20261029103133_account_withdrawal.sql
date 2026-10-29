SET local check_function_bodies = off;

CREATE TABLE "private"."account_deletions" (
  "user_id"                uuid                     NOT NULL,
  "request_id"             uuid                     NOT NULL,
  "requested_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "sessions_revoked_at"    timestamp with time zone,
  "application_deleted_at" timestamp with time zone,
  CONSTRAINT "account_deletions_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "private"."account_deletions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "private"."signup_allowlist"
  ADD COLUMN "invited_user_id" uuid;

CREATE OR REPLACE FUNCTION api.account_cleanup_identity()
  RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$declare actor uuid:=auth.uid();begin if actor is null then raise exception 'UNAUTHENTICATED';end if;if not exists(select 1 from private.account_deletions where user_id=actor) or (exists(select 1 from auth.users where id=actor) and not exists(select 1 from private.account_state where user_id=actor and status='deleting')) then raise exception 'NOT_FOUND';end if;return actor;end $function$;

CREATE OR REPLACE FUNCTION api.account_deletion_assets (
  p_actor uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$begin
 if not exists(select 1 from private.account_deletions where user_id=p_actor and sessions_revoked_at is not null) then raise exception 'CLEANUP_PENDING';end if;
 return (select coalesce(jsonb_agg(id),'[]'::jsonb) from (select id from private.media_assets where profile_id=p_actor order by cleanup_after,id limit 4) m);
end $function$;

CREATE OR REPLACE FUNCTION api.account_deletion_job (
  p_actor uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select jsonb_build_object('id',user_id,'request_id',request_id,'sessions_revoked',sessions_revoked_at is not null,'data_deleted',application_deleted_at is not null)
 from private.account_deletions where user_id=p_actor;
$function$;

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
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'apply_animal_collection',request_hash,result);
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
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'apply_external_links',hash,result);return result;
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
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'apply_schedules',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION api.before_user_created (
  event jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if exists(select 1 from private.signup_allowlist where normalized_email=lower(trim(event->'user'->>'email')) and invited_user_id is null and revoked_at is null and expires_at>now()) then
    return '{}'::jsonb;
  end if;
  return '{"error":{"http_code":403,"message":"초대된 계정만 가입할 수 있습니다."}}'::jsonb;
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
  if exists(select 1 from private.account_deletions where user_id=p_actor and sessions_revoked_at is null) then raise exception 'CLEANUP_PENDING';end if;
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  select * into a from private.media_assets where id=p_asset_id and profile_id=p_actor for update;
  if not found or exists(select 1 from public.profiles where avatar_asset_id=p_asset_id or cover_asset_id=p_asset_id) or exists(select 1 from public.animal_photos where asset_id=p_asset_id) then raise exception 'NOT_FOUND'; end if;
  update private.media_assets set state='delete_pending' where id=p_asset_id;
  if a.cleanup_after>now() then return null; end if;
  return (select jsonb_agg(object_path) from private.media_objects where asset_id=p_asset_id);
end $function$;

CREATE OR REPLACE FUNCTION api.complete_account_deletion (
  p_actor uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$begin
 if exists(select 1 from auth.users where id=p_actor) then raise exception 'CLEANUP_PENDING';end if;
 delete from private.account_deletions where user_id=p_actor and application_deleted_at is not null;
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
  perform private.lock_active_account(p_actor);
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
  if (a.purpose='avatar' and total>102400) or (a.purpose='cover' and total>204800) then raise exception 'INVALID_IMAGE'; end if;
  update private.media_assets set state='ready',actual_bytes=total,verified_at=now() where id=a.id;
  update private.storage_usage set reserved_bytes=reserved_bytes-a.reservation_bytes,stored_bytes=stored_bytes+total where profile_id=p_actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes-a.reservation_bytes,media_stored_bytes=media_stored_bytes+total where id=1;
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
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'create_animal',md5(p_data::text),result);
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
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'delete_animal',hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION api.expired_uploads()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'profile_id',m.profile_id)),'[]'::jsonb) from
 (select id,profile_id from private.media_assets where (state='delete_pending' or expires_at<now()) and (cleanup_after is null or cleanup_after<=now()) and not exists(select 1 from private.account_deletions j where j.user_id=private.media_assets.profile_id) order by created_at limit 50) m;
$function$;

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
 delete from private.animal_deletions where profile_id=p_actor;
 delete from private.storage_usage where profile_id=p_actor;
 delete from public.profiles where id=p_actor;
 update private.account_deletions set application_deleted_at=now() where user_id=p_actor;
 return true;
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
  if exists(select 1 from private.account_deletions where user_id=(select profile_id from private.media_assets where id=p_asset_id) and sessions_revoked_at is null) then raise exception 'CLEANUP_PENDING';end if;
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

CREATE OR REPLACE FUNCTION api.mark_account_sessions_revoked (
  p_actor uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$begin
 update private.account_deletions set sessions_revoked_at=coalesce(sessions_revoked_at,now()) where user_id=p_actor;
 if not found then raise exception 'NOT_FOUND';end if;
end $function$;

CREATE OR REPLACE FUNCTION api.my_account_deletion()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=auth.uid();j private.account_deletions;begin
 if actor is null then raise exception 'UNAUTHENTICATED';end if;
 select * into j from private.account_deletions where user_id=actor;if not found then return null;end if;
 return jsonb_build_object('request_id',j.request_id,'requested_at',j.requested_at,'sessions_revoked',j.sessions_revoked_at is not null,'phase',case when j.sessions_revoked_at is null then 'sessions' when j.application_deleted_at is not null then 'auth' else 'files' end);
end $function$;

CREATE OR REPLACE FUNCTION api.my_dashboard()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  return jsonb_build_object(
    'account_status',case when exists(select 1 from private.account_deletions where user_id=actor) then 'deleting' else coalesce((select status from private.account_state where user_id=actor),case when exists(select 1 from auth.users where id=actor) then 'unknown' else 'deleted' end) end,'account_deletion',api.my_account_deletion(),
    'profile',(select to_jsonb(p) from public.profiles p where id=actor and private.active(actor)),
    'animals',coalesce((select jsonb_agg((to_jsonb(a)-array['deleted_at','active_sort_order'])||jsonb_build_object('photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where profile_id=actor and a.deleted_at is null and private.active(actor)),'[]'::jsonb),
    'pending_deletions',coalesce((select jsonb_agg(jsonb_build_object('id',animal_id,'name',animal_name,'requested_at',requested_at) order by requested_at) from private.animal_deletions where profile_id=actor and private.active(actor)),'[]'::jsonb),
    'usage',(select jsonb_build_object('stored_bytes',stored_bytes,'reserved_bytes',reserved_bytes,'limit_bytes',limit_bytes) from private.storage_usage where profile_id=actor and private.active(actor)));
end $function$;

CREATE OR REPLACE FUNCTION api.my_withdrawal_context()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$declare actor uuid:=auth.uid();state text;begin if actor is null then raise exception 'UNAUTHENTICATED';end if;select status into state from private.account_state where user_id=actor;if not found then raise exception 'NOT_FOUND';end if;if state='deleting' then raise exception 'ACCOUNT_NOT_ACTIVE';end if;return jsonb_build_object('expected',(select revision from public.profiles where id=actor));end $function$;

CREATE OR REPLACE FUNCTION api.pending_account_deletions()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select coalesce(jsonb_agg(user_id),'[]'::jsonb) from (select user_id from private.account_deletions order by requested_at limit 10) j;
$function$;

CREATE OR REPLACE FUNCTION api.pending_animal_deletions()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',animal_id,'profile_id',profile_id)),'[]'::jsonb) from
 (select animal_id,profile_id from private.animal_deletions where not exists(select 1 from private.account_deletions d where d.user_id=private.animal_deletions.profile_id) order by requested_at limit 50) j;
$function$;

CREATE OR REPLACE FUNCTION api.register_upload_lease (
  p_asset_id uuid,
  p_actor    uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare a private.media_assets; extra bigint;
begin
  perform private.lock_active_account(p_actor);
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  select * into a from private.media_assets where id=p_asset_id and profile_id=p_actor and state='reserved' and expires_at>now() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  extra:=greatest(450560-a.reservation_bytes,0);
  if exists(select 1 from private.storage_usage where profile_id=p_actor and reserved_bytes+stored_bytes+extra>limit_bytes)
    or exists(select 1 from private.project_budget where id=1 and media_reserved_bytes+media_stored_bytes+extra>media_limit_bytes) then raise exception 'QUOTA_EXCEEDED'; end if;
  update private.storage_usage set reserved_bytes=reserved_bytes+extra where profile_id=p_actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes+extra where id=1;
  update private.media_assets set reservation_bytes=reservation_bytes+extra,cleanup_after=greatest(coalesce(cleanup_after,now()),clock_timestamp()+interval '2 hours 5 minutes') where id=a.id;
end $function$;

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
 delete from public.animal_photos where profile_id=actor;
 update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where profile_id=actor;
 -- Bind invitations at signup so a later email change cannot revive the original invitation.
 delete from private.signup_allowlist where invited_user_id=actor or normalized_email=(select lower(trim(email)) from auth.users where id=actor);
 result:=api.my_account_deletion();
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'delete_account',hash,jsonb_build_object('requested',true));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION api.reserve_photo_edit (
  p_animal_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor(); asset uuid:=gen_random_uuid(); budget bigint:=450560; manifest jsonb;
begin
  perform private.check_writes();
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  perform 1 from public.profiles where id=actor for update;
  if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.media_assets where profile_id=actor and state='reserved')>=2 then raise exception 'QUOTA_EXCEEDED'; end if;
  if (select count(*) from private.media_assets m where m.animal_id=p_animal_id and m.state<>'delete_pending' and not exists(select 1 from public.animal_photos p where p.asset_id=m.id))>=3 then raise exception 'QUOTA_EXCEEDED'; end if;
  if exists(select 1 from private.storage_usage where profile_id=actor and reserved_bytes+stored_bytes+budget>limit_bytes) or exists(select 1 from private.project_budget where id=1 and media_reserved_bytes+media_stored_bytes+budget>media_limit_bytes) then raise exception 'QUOTA_EXCEEDED'; end if;
  if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
  insert into private.media_assets(id,profile_id,animal_id,reservation_bytes,cleanup_after) values(asset,actor,p_animal_id,budget,clock_timestamp()+interval '2 hours 5 minutes');
  insert into private.media_objects(asset_id,profile_id,variant,object_path,byte_size)
    values(asset,actor,'original_display',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',225280),
          (asset,actor,'thumbnail',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',81920);
  update private.storage_usage set reserved_bytes=reserved_bytes+budget where profile_id=actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes+budget where id=1;
  select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) into manifest from private.media_objects where asset_id=asset;
  return jsonb_build_object('asset_id',asset,'objects',manifest);
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
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'reserve_profile_upload',hash,jsonb_build_object('id',asset));
 end if;
 if a.state='reserved' then perform private.check_writes();end if;
 select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) into manifest from private.media_objects where asset_id=asset;
 return jsonb_build_object('asset_id',asset,'objects',manifest,'ready',a.state='ready','expires_at',a.expires_at,'server_now',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION api.reserve_upload (
  p_animal_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor(); asset uuid:=gen_random_uuid(); budget bigint:=307200; manifest jsonb;
begin
  perform private.check_writes();
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  perform 1 from public.profiles where id=actor for update;
  if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.media_assets where profile_id=actor and state='reserved')>=2 then raise exception 'QUOTA_EXCEEDED'; end if;
  if (select count(*) from private.media_assets where animal_id=p_animal_id and state<>'delete_pending')>=3 then raise exception 'QUOTA_EXCEEDED'; end if;
  if exists(select 1 from private.storage_usage where profile_id=actor and reserved_bytes+stored_bytes+budget>limit_bytes) or exists(select 1 from private.project_budget where id=1 and media_reserved_bytes+media_stored_bytes+budget>media_limit_bytes) then raise exception 'QUOTA_EXCEEDED'; end if;
  insert into private.media_assets(id,profile_id,animal_id,reservation_bytes) values(asset,actor,p_animal_id,budget);
  insert into private.media_objects(asset_id,profile_id,variant,object_path,byte_size)
    values(asset,actor,'original_display',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',225280),
          (asset,actor,'thumbnail',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',81920);
  update private.storage_usage set reserved_bytes=reserved_bytes+budget where profile_id=actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes+budget where id=1;
  select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) into manifest from private.media_objects where asset_id=asset;
  return jsonb_build_object('asset_id',asset,'objects',manifest);
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
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'save_animal_edit',request_hash,result);
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
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_animal_growth',hash,result);
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
 result:=jsonb_build_object('revision',revision);insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_design',hash,result);return result;
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
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_external_link',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION api.save_profile (
  p_slug         text,
  p_name         text,
  p_bio          text,
  p_expected     bigint,
  p_publish      boolean,
  p_accept_terms boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid := private.write_actor(); current_profile public.profiles; new_revision bigint;
begin
  if p_name is null or p_bio is null then raise exception 'VALIDATION_FAILED';end if;
  p_name:=private.trim_profile_text(p_name);p_bio:=private.trim_profile_text(p_bio);
  if length(p_name) not between 1 and 40 or length(p_bio)>300 or p_name~('[[:cntrl:]]|['||chr(8232)||chr(8233)||']') then raise exception 'VALIDATION_FAILED';end if;
  perform private.check_writes();
  perform 1 from private.project_budget where id=1 for update;
  select * into current_profile from public.profiles where id=actor for update;
  if found then
    if current_profile.revision is distinct from p_expected then raise exception 'VERSION_CONFLICT'; end if;
    if current_profile.first_published_at is not null and current_profile.slug<>lower(trim(p_slug)) then raise exception 'SLUG_LOCKED'; end if;
  else
    if not (select admission_open from private.project_budget where id=1) or (select count(*) from public.profiles)>=(select profile_limit from private.project_budget where id=1) then raise exception 'QUOTA_EXCEEDED'; end if;
    if p_accept_terms is distinct from true then raise exception 'CONSENT_REQUIRED'; end if;
    insert into private.consents(user_id,document_kind,document_version) values(actor,'terms','local-preview-v1'),(actor,'privacy','local-preview-v1') on conflict do nothing;
  end if;
  if lower(trim(p_slug)) in ('admin','api','auth','dashboard','help','terms','privacy','support','www') then raise exception 'SLUG_RESERVED'; end if;
  if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
  insert into public.profiles(id,slug,display_name,bio,is_published,first_published_at,revision)
  values(actor,lower(trim(p_slug)),trim(p_name),trim(p_bio),p_publish,case when p_publish then now() end,1)
  on conflict(id) do update set slug=excluded.slug,display_name=excluded.display_name,bio=excluded.bio,
    is_published=excluded.is_published,first_published_at=coalesce(profiles.first_published_at,excluded.first_published_at),revision=profiles.revision+1,updated_at=now()
  returning revision into new_revision;
  insert into private.storage_usage(profile_id) values(actor) on conflict do nothing;
  return jsonb_build_object('revision',new_revision);
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
 result:=jsonb_build_object('id',new_id,'revision',private.bump(actor));insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_schedule',hash,result);return result;
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
 result:=jsonb_build_object('revision',revision);insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_social_links',hash,result);return result;
end $function$;

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
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'update_animal',request_hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION api.upload_manifest (
  p_asset_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();
begin
  if not exists(select 1 from private.media_assets where id=p_asset_id and profile_id=actor and state in ('reserved','ready') and (expires_at>now() or exists(select 1 from public.profiles p where p.avatar_asset_id=p_asset_id or p.cover_asset_id=p_asset_id))) then raise exception 'NOT_FOUND'; end if;
  return (select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) from private.media_objects where asset_id=p_asset_id);
end $function$;

CREATE OR REPLACE FUNCTION private.lock_active_account (
  p_actor uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare state text;begin
 select status into state from private.account_state where user_id=p_actor for share;
 if state is distinct from 'active' then raise exception 'ACCOUNT_NOT_ACTIVE';end if;
end $function$;

CREATE OR REPLACE FUNCTION private.lock_profile (
  p_expected bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid := private.write_actor(); current_revision bigint;
begin
  select revision into current_revision from public.profiles where id=actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if current_revision is distinct from p_expected then raise exception 'VERSION_CONFLICT'; end if;
  return actor;
end $function$;

CREATE OR REPLACE FUNCTION private.new_account()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into private.account_state(user_id) values(new.id);
  update private.signup_allowlist set invited_user_id=new.id where normalized_email=lower(trim(new.email)) and invited_user_id is null and revoked_at is null and expires_at>now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.write_actor()
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=auth.uid();begin if actor is null then raise exception 'UNAUTHENTICATED';end if;perform private.lock_active_account(actor);return actor;end $function$;

ALTER TABLE "private"."signup_allowlist"
  ADD CONSTRAINT "signup_allowlist_invited_user_id_fkey" FOREIGN KEY (invited_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX signup_allowlist_user_idx ON private.signup_allowlist USING btree (invited_user_id)
  WHERE (invited_user_id IS NOT NULL);

REVOKE ALL ON FUNCTION "api"."account_cleanup_identity"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."account_cleanup_identity"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."account_deletion_assets"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."account_deletion_assets"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."account_deletion_job"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."account_deletion_job"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."complete_account_deletion"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."complete_account_deletion"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."finish_account_data"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."finish_account_data"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."mark_account_sessions_revoked"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."mark_account_sessions_revoked"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."my_account_deletion"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_account_deletion"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."my_withdrawal_context"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_withdrawal_context"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."pending_account_deletions"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."pending_account_deletions"() TO "service_role";

REVOKE ALL ON FUNCTION "api"."request_account_deletion"(bigint, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."request_account_deletion"(bigint, uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."lock_active_account"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."write_actor"() FROM PUBLIC;
