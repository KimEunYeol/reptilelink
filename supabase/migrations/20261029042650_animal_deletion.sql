SET local check_function_bodies = off;

DROP POLICY "animal_read" ON "public"."animals";

ALTER TABLE "public"."animals"
  DROP CONSTRAINT "animals_profile_id_sort_order_key";

CREATE TABLE "private"."animal_deletions" (
  "animal_id"    uuid                     NOT NULL,
  "profile_id"   uuid                     NOT NULL,
  "animal_name"  text                     NOT NULL,
  "request_id"   uuid                     NOT NULL,
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "animal_deletions_pkey" PRIMARY KEY (animal_id)
);

ALTER TABLE "private"."animal_deletions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."animals"
  ADD COLUMN "deleted_at" timestamp WITH time zone;

ALTER TABLE "public"."animals"
  ADD COLUMN "active_sort_order" integer GENERATED ALWAYS AS (
CASE
    WHEN (deleted_at IS NULL) THEN sort_order
    ELSE NULL::integer
END) STORED;

CREATE OR REPLACE FUNCTION api.animal_deletion_assets (
  p_animal_id uuid,
  p_actor     uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not exists(select 1 from private.animal_deletions where animal_id=p_animal_id and profile_id=p_actor)
    and not exists(select 1 from private.mutation_receipts where actor_id=p_actor and operation='delete_animal' and result_ref->>'id'=p_animal_id::text) then raise exception 'NOT_FOUND'; end if;
  return (select coalesce(jsonb_agg(id),'[]'::jsonb) from private.media_assets where animal_id=p_animal_id and profile_id=p_actor);
end $function$;

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
  actor uuid := private.actor();
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
      join public.animals a on a.id = (i.value->>'id')::uuid and a.profile_id = actor and a.deleted_at is null
      where a.sort_order <> i.position - 1 or (not a.is_public and (i.value->>'is_public')::boolean)) then
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
declare actor uuid:=private.actor(); receipt private.mutation_receipts; hash text; a public.animals; result jsonb;
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

CREATE OR REPLACE FUNCTION api.finish_animal_deletion (
  p_animal_id uuid,
  p_actor     uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  perform 1 from public.profiles where id=p_actor for update;
  perform 1 from private.animal_deletions where animal_id=p_animal_id and profile_id=p_actor for update;
  if not found then
    if exists(select 1 from private.mutation_receipts where actor_id=p_actor and operation='delete_animal' and result_ref->>'id'=p_animal_id::text) then return true; end if;
    raise exception 'NOT_FOUND';
  end if;
  if exists(select 1 from private.media_assets where animal_id=p_animal_id and profile_id=p_actor) then return false; end if;
  delete from public.animals where id=p_animal_id and profile_id=p_actor and deleted_at is not null;
  if not found then raise exception 'NOT_FOUND'; end if;
  return true;
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
 and (p.id=p_actor or (p.is_published and a.is_public));
$function$;

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
    'account_status',(select status from private.account_state where user_id=actor),
    'profile',(select to_jsonb(p) from public.profiles p where id=actor and private.active(actor)),
    'animals',coalesce((select jsonb_agg((to_jsonb(a)-array['deleted_at','active_sort_order'])||jsonb_build_object('photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where profile_id=actor and a.deleted_at is null and private.active(actor)),'[]'::jsonb),
    'pending_deletions',coalesce((select jsonb_agg(jsonb_build_object('id',animal_id,'name',animal_name,'requested_at',requested_at) order by requested_at) from private.animal_deletions where profile_id=actor),'[]'::jsonb),
    'usage',(select jsonb_build_object('stored_bytes',stored_bytes,'reserved_bytes',reserved_bytes,'limit_bytes',limit_bytes) from private.storage_usage where profile_id=actor));
end $function$;

CREATE OR REPLACE FUNCTION api.pending_animal_deletions()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',animal_id,'profile_id',profile_id)),'[]'::jsonb) from
 (select animal_id,profile_id from private.animal_deletions order by requested_at limit 50) j;
$function$;

CREATE OR REPLACE FUNCTION private.protect_deleted_animal()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if old.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.require_live_animal()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not exists(select 1 from public.animals where id=new.animal_id and profile_id=new.profile_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  return new;
end $function$;

ALTER TABLE "private"."animal_deletions"
  ADD CONSTRAINT "animal_deletions_animal_id_profile_id_fkey" FOREIGN KEY (animal_id, profile_id) REFERENCES public.animals(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "private"."animal_deletions"
  ADD CONSTRAINT "animal_deletions_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."animals"
  ADD CONSTRAINT "animals_profile_id_sort_order_key" UNIQUE (profile_id, active_sort_order) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX animal_deletions_owner_idx ON private.animal_deletions USING btree (profile_id, requested_at);

CREATE TRIGGER media_live_animal
  BEFORE INSERT ON private.media_assets
  FOR EACH ROW
  EXECUTE FUNCTION private.require_live_animal();

CREATE TRIGGER photo_live_animal
  BEFORE INSERT OR UPDATE ON public.animal_photos
  FOR EACH ROW
  EXECUTE FUNCTION private.require_live_animal();

CREATE TRIGGER protect_deleted_animal
  BEFORE UPDATE ON public.animals
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_deleted_animal();

CREATE POLICY "animal_read" ON "public"."animals"
  FOR SELECT
  TO "anon", "authenticated"
  USING (((deleted_at IS NULL) AND private.active(profile_id) AND ((profile_id = ( SELECT auth.uid() AS uid)) OR (is_public AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = animals.profile_id) AND p.is_published)))))));

REVOKE ALL ON FUNCTION "api"."animal_deletion_assets"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."animal_deletion_assets"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."delete_animal"(uuid, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."delete_animal"(uuid, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."finish_animal_deletion"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."finish_animal_deletion"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."pending_animal_deletions"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."pending_animal_deletions"() TO "service_role";

REVOKE ALL ON FUNCTION "private"."protect_deleted_animal"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."require_live_animal"() FROM PUBLIC;
