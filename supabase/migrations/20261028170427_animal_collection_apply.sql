SET local check_function_bodies = off;

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
  select count(*) into owned_count from public.animals where profile_id = actor;
  if owned_count <> jsonb_array_length(p_items)
     or (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_items)) <> owned_count
     or (select count(*) from public.animals a join jsonb_array_elements(p_items) i on a.id = (i.value->>'id')::uuid
         where a.profile_id = actor) <> owned_count then
    raise exception 'VALIDATION_FAILED';
  end if;
  -- Existing privacy policy: hiding remains possible while nonessential writes are paused.
  if exists(select 1 from jsonb_array_elements(p_items) with ordinality i(value,position)
      join public.animals a on a.id = (i.value->>'id')::uuid and a.profile_id = actor
      where a.sort_order <> i.position - 1 or (not a.is_public and (i.value->>'is_public')::boolean)) then
    perform private.check_writes();
  end if;
  set constraints public.animals_profile_id_sort_order_key deferred;
  update public.animals a set sort_order = i.position - 1, is_public = (i.value->>'is_public')::boolean, updated_at = now()
    from jsonb_array_elements(p_items) with ordinality i(value,position)
    where a.id = (i.value->>'id')::uuid and a.profile_id = actor
      and (a.sort_order is distinct from i.position - 1 or a.is_public is distinct from (i.value->>'is_public')::boolean);
  if found then revision := private.bump(actor);
  else select p.revision into revision from public.profiles p where id = actor;
  end if;
  result := jsonb_build_object('revision',revision);
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'apply_animal_collection',request_hash,result);
  return result;
end $function$;

REVOKE ALL ON FUNCTION "api"."apply_animal_collection"(jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."apply_animal_collection"(jsonb, bigint, uuid) TO "authenticated";
