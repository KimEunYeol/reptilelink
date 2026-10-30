SET local check_function_bodies = off;

CREATE TABLE "private"."account_withdrawals" (
  "user_id"      uuid                     NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "account_withdrawals_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "private"."account_withdrawals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."recovery_settings" (
  "id"            smallint                 NOT NULL DEFAULT 1,
  "journal_epoch" uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "started_at"    timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "recovery_settings_id_check" CHECK ((id = 1)),
  CONSTRAINT "recovery_settings_pkey" PRIMARY KEY (id)
);

ALTER TABLE "private"."recovery_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION api.complete_account_deletion (
  p_actor uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor) THEN RAISE EXCEPTION 'CLEANUP_PENDING'; END IF;
 INSERT INTO private.account_withdrawals(user_id,requested_at,completed_at)
 SELECT user_id,requested_at,clock_timestamp() FROM private.account_deletions WHERE user_id=p_actor AND application_deleted_at IS NOT NULL
 ON CONFLICT(user_id)DO UPDATE SET completed_at=coalesce(private.account_withdrawals.completed_at,excluded.completed_at);
 DELETE FROM private.account_deletions WHERE user_id=p_actor AND application_deleted_at IS NOT NULL;
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
 insert into private.account_withdrawals(user_id,requested_at) select user_id,requested_at from private.account_deletions where user_id=actor on conflict(user_id)do nothing;
 update public.profiles set is_published=false,avatar_asset_id=null,cover_asset_id=null,revision=revision+1,updated_at=now() where id=actor;
 update public.animals set is_public=false,deleted_at=coalesce(deleted_at,now()),father_asset_id=null,mother_asset_id=null,updated_at=now() where profile_id=actor and deleted_at is null;
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

CREATE OR REPLACE FUNCTION private.prune_account_withdrawals (
  p_users uuid[] DEFAULT NULL::uuid[]
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE total integer;
BEGIN
 IF cardinality(p_users)>1000 THEN RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
 WITH expired AS(SELECT w.user_id FROM private.account_withdrawals w WHERE(p_users IS NULL OR w.user_id=ANY(p_users))AND w.completed_at<now()-interval '7 days'AND NOT EXISTS(SELECT 1 FROM private.account_deletions d WHERE d.user_id=w.user_id)ORDER BY w.completed_at,w.user_id FOR UPDATE OF w SKIP LOCKED LIMIT 500)
 DELETE FROM private.account_withdrawals w USING expired e WHERE w.user_id=e.user_id;
 GET DIAGNOSTICS total=ROW_COUNT;RETURN total;
END $function$;

CREATE OR REPLACE FUNCTION private.prune_mutation_receipts (
  p_actor uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE total integer; withdrawals integer;
BEGIN
 WITH expired AS (
  SELECT r.actor_id,r.request_id FROM private.mutation_receipts r
  WHERE (p_actor IS NULL OR r.actor_id=p_actor) AND r.expires_at<now()-interval '1 hour'
   AND NOT EXISTS(SELECT 1 FROM private.account_deletions d WHERE d.user_id=r.actor_id)
   AND NOT EXISTS(SELECT 1 FROM private.media_assets m WHERE m.profile_id=r.actor_id AND m.id::text=r.result_ref->>'id' AND m.cleanup_after>now())
  ORDER BY r.expires_at,r.actor_id,r.request_id FOR UPDATE OF r SKIP LOCKED LIMIT 500
 ) DELETE FROM private.mutation_receipts r USING expired e WHERE r.actor_id=e.actor_id AND r.request_id=e.request_id;
 GET DIAGNOSTICS total=ROW_COUNT;
 withdrawals:=private.prune_account_withdrawals(CASE WHEN p_actor IS NULL THEN NULL ELSE ARRAY[p_actor] END);
 RETURN jsonb_build_object('receipts',total,'withdrawals',withdrawals);
END $function$;

CREATE INDEX account_withdrawals_completed_idx ON private.account_withdrawals USING btree (completed_at)
  WHERE (completed_at IS NOT NULL);

REVOKE ALL ON FUNCTION "private"."prune_account_withdrawals"(uuid[]) FROM PUBLIC;
