SET local check_function_bodies = off;

ALTER TABLE "private"."action_buckets"
  DROP CONSTRAINT "action_buckets_action_check";

ALTER TABLE "private"."project_budget"
  ADD COLUMN "receipt_limit" integer NOT NULL DEFAULT 100000;

CREATE OR REPLACE FUNCTION api.cancel_parent_photo_request (
  p_animal_id  uuid,
  p_role       text,
  p_request_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.policy_actor();receipt private.mutation_receipts;hash text;asset uuid;
begin
 if p_request_id is null or p_role is null or p_role not in('father','mother') or p_animal_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor) then raise exception 'NOT_FOUND';end if;
 hash:=md5(jsonb_build_object('animal',p_animal_id,'role',p_role)::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if not found then
  perform private.consume_activity_rate(actor,'upload_cancel');
  -- An unknown in-flight reservation must not be created after explicit cancellation wins the profile lock.
  perform private.record_receipt(actor,p_request_id,'cancel_parent_photo_request',hash,'{}'::jsonb);return null;
 end if;
 if receipt.request_hash is distinct from hash or receipt.operation not in('reserve_parent_photo','cancel_parent_photo_request') then raise exception 'REQUEST_CONFLICT';end if;
 if receipt.operation='cancel_parent_photo_request' then return null;end if;
 asset:=(receipt.result_ref->>'id')::uuid;
 perform 1 from private.media_assets where id=asset and profile_id=actor and purpose='animal' and animal_id=p_animal_id and animal_role=p_role for update;if not found then return null;end if;
 if private.asset_bound(asset) then raise exception 'NOT_FOUND';end if;
 update private.media_assets set state='delete_pending' where id=asset;return asset;
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
declare actor uuid:=private.policy_actor();receipt private.mutation_receipts;hash text;asset uuid;
begin
 if p_request_id is null or p_purpose is null or p_purpose not in('avatar','cover') then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 hash:=md5(p_purpose);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if not found then
  perform private.consume_activity_rate(actor,'upload_cancel');
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
  perform private.consume_activity_rate(actor,'upload_cancel');
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

CREATE OR REPLACE FUNCTION api.prune_mutation_receipts (
  p_actor uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$ SELECT private.prune_mutation_receipts(p_actor); $function$;

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
 if p_action is null or p_action not in('comment','report','like','notification_read','upload_cancel') then raise exception 'VALIDATION_FAILED';end if;
 foreach seconds in array(case when p_action in('like','notification_read','upload_cancel') then array[3600] when p_action='comment' then array[2,60,86400] else array[2,86400] end) loop
  cap:=case when p_action='upload_cancel' then 120 when seconds=3600 then 60 when seconds=2 then 1 when seconds=60 then 3 when p_action='comment' then 30 else 5 end;
  start_at:=case when seconds=86400 then date_trunc('day',ts at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' else to_timestamp(floor(extract(epoch from ts)/seconds)*seconds) end;
  insert into private.action_buckets(actor_id,action,window_started_at,window_seconds,count,expires_at) values(p_actor,p_action,start_at,seconds,1,ts+interval '47 hours')
  on conflict(actor_id,action,window_started_at,window_seconds) do update set count=private.action_buckets.count+1 returning count into total;
  if total>cap then raise exception 'RATE_LIMITED' using hint=greatest(1,ceil(extract(epoch from start_at+make_interval(secs=>seconds)-ts)))::text;end if;
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.guard_receipt_budget()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE cap integer; total bigint;
BEGIN
 IF NEW.operation='delete_account' OR EXISTS(SELECT 1 FROM private.mutation_receipts WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RETURN NEW; END IF;
 SELECT receipt_limit INTO cap FROM private.project_budget WHERE id=1;
 IF cap IS NULL OR cap=0 THEN RAISE EXCEPTION 'SERVICE_UNAVAILABLE'; END IF;
 SELECT count(*) INTO total FROM (SELECT 1 FROM private.mutation_receipts LIMIT cap) r;
 IF total>=cap THEN RAISE EXCEPTION 'SERVICE_UNAVAILABLE'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private.prune_mutation_receipts (
  p_actor uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE total integer;
BEGIN
 WITH expired AS (
  SELECT r.actor_id,r.request_id FROM private.mutation_receipts r
  WHERE (p_actor IS NULL OR r.actor_id=p_actor) AND r.expires_at<now()-interval '1 hour'
   AND NOT EXISTS(SELECT 1 FROM private.account_deletions d WHERE d.user_id=r.actor_id)
   AND NOT EXISTS(SELECT 1 FROM private.media_assets m WHERE m.profile_id=r.actor_id AND m.id::text=r.result_ref->>'id' AND m.cleanup_after>now())
  ORDER BY r.expires_at,r.actor_id,r.request_id FOR UPDATE OF r SKIP LOCKED LIMIT 500
 ) DELETE FROM private.mutation_receipts r USING expired e WHERE r.actor_id=e.actor_id AND r.request_id=e.request_id;
 GET DIAGNOSTICS total=ROW_COUNT;
 RETURN jsonb_build_object('receipts',total);
END $function$;

ALTER TABLE "private"."action_buckets"
  ADD CONSTRAINT "action_buckets_action_check" CHECK ((action = ANY (ARRAY['comment'::text, 'report'::text, 'like'::text, 'notification_read'::text, 'upload_cancel'::text])));

ALTER TABLE "private"."project_budget"
  ADD CONSTRAINT "project_budget_receipt_limit_check" CHECK (((receipt_limit >= 0) AND (receipt_limit <= 100000)));

CREATE TRIGGER guard_receipt_budget
  BEFORE INSERT ON private.mutation_receipts
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_receipt_budget();

REVOKE ALL ON FUNCTION "api"."prune_mutation_receipts"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."prune_mutation_receipts"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "private"."guard_receipt_budget"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."prune_mutation_receipts"(uuid) FROM PUBLIC;
