SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION api.cancel_self_photo_request (
  p_animal_id  uuid,
  p_request_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.policy_actor();receipt private.mutation_receipts;hash text;asset uuid;
begin
 if p_request_id is null or p_animal_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor) then raise exception 'NOT_FOUND';end if;
 hash:=md5(jsonb_build_object('animal',p_animal_id)::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if not found then
  -- An unknown in-flight reservation must not be created after explicit cancellation wins the profile lock.
  perform private.record_receipt(actor,p_request_id,'cancel_self_photo_request',hash,'{}'::jsonb);return null;
 end if;
 if receipt.request_hash is distinct from hash or receipt.operation not in('reserve_self_photo','cancel_self_photo_request') then raise exception 'REQUEST_CONFLICT';end if;
 if receipt.operation='cancel_self_photo_request' then return null;end if;
 asset:=(receipt.result_ref->>'id')::uuid;
 perform 1 from private.media_assets where id=asset and profile_id=actor and purpose='animal' and animal_id=p_animal_id and animal_role='self' for update;if not found then return null;end if;
 if private.asset_bound(asset) then raise exception 'NOT_FOUND';end if;
 update private.media_assets set state='delete_pending' where id=asset;return asset;
end $function$;

CREATE OR REPLACE FUNCTION api.reserve_self_photo (
  p_animal_id  uuid,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();asset uuid;a private.media_assets;receipt private.mutation_receipts;hash text;manifest jsonb;reserved jsonb;
begin
 if p_request_id is null or p_animal_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if not private.has_required_consents(actor) then raise exception 'CONSENT_REQUIRED';end if;
 if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor and deleted_at is null) then raise exception 'NOT_FOUND';end if;
 hash:=md5(jsonb_build_object('animal',p_animal_id)::text);
 select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'reserve_self_photo' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;
  asset:=(receipt.result_ref->>'id')::uuid;
  select * into a from private.media_assets where id=asset and profile_id=actor and purpose='animal' and animal_id=p_animal_id and animal_role='self' for update;
  if not found or a.state not in('reserved','ready') or not(coalesce(a.expires_at>now(),false) or(a.state='ready'and private.asset_bound(a.id))) then raise exception 'REQUEST_EXPIRED';end if;
 else
  reserved:=api.reserve_photo_edit(p_animal_id);
  asset:=(reserved->>'asset_id')::uuid;
  select * into strict a from private.media_assets where id=asset and profile_id=actor and animal_id=p_animal_id and animal_role='self';
  perform private.record_receipt(actor,p_request_id,'reserve_self_photo',hash,jsonb_build_object('id',asset));
 end if;
 if a.state='reserved' then perform private.check_writes();end if;
 select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant))into manifest from private.media_objects where asset_id=asset;
 return jsonb_build_object('asset_id',asset,'objects',manifest,'ready',a.state='ready','expires_at',a.expires_at,'server_now',clock_timestamp());
end $function$;

REVOKE ALL ON FUNCTION "api"."cancel_self_photo_request"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."cancel_self_photo_request"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."reserve_self_photo"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."reserve_self_photo"(uuid, uuid) TO "authenticated";
