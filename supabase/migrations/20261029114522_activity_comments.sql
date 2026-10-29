SET local check_function_bodies = off;

CREATE TABLE "private"."action_buckets" (
  "actor_id"          uuid                     NOT NULL,
  "action"            text                     NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "window_seconds"    integer                  NOT NULL,
  "count"             integer                  NOT NULL,
  "expires_at"        timestamp with time zone NOT NULL,
  CONSTRAINT "action_buckets_action_check" CHECK ((action = ANY (ARRAY['comment'::text, 'report'::text]))),
  CONSTRAINT "action_buckets_count_check" CHECK ((count > 0)),
  CONSTRAINT "action_buckets_pkey" PRIMARY KEY (actor_id, action, window_started_at, window_seconds),
  CONSTRAINT "action_buckets_window_seconds_check" CHECK ((window_seconds = ANY (ARRAY[2, 60, 86400])))
);

ALTER TABLE "private"."action_buckets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."content_reports" (
  "id"                    uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "reporter_id"           uuid                     NOT NULL,
  "profile_id"            uuid                     NOT NULL,
  "animal_id"             uuid,
  "comment_id"            uuid,
  "reason"                text                     NOT NULL,
  "detail"                text                     NOT NULL DEFAULT ''::text,
  "status"                text                     NOT NULL DEFAULT 'open'::text,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at"           timestamp with time zone,
  "resolution_action"     text,
  "resolution_request_id" uuid,
  CONSTRAINT "content_reports_check1" CHECK ((((status = 'open'::text) AND (resolved_at IS NULL)) OR ((status = 'resolved'::text) AND (resolved_at IS NOT NULL)))),
  CONSTRAINT "content_reports_check" CHECK ((num_nonnulls(animal_id, comment_id) = 1)),
  CONSTRAINT "content_reports_detail_check" CHECK ((length(detail) <= 500)),
  CONSTRAINT "content_reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "content_reports_reason_check" CHECK ((reason = ANY (ARRAY['spam'::text, 'abuse'::text, 'privacy'::text, 'other'::text]))),
  CONSTRAINT "content_reports_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text]))),
  CONSTRAINT "reports_resolution_check"
    CHECK ((((status = 'open'::text) AND (resolution_action IS NULL) AND (resolution_request_id IS NULL)) OR ((status = 'resolved'::text) AND (resolution_action IS
    NOT NULL) AND (resolution_action = ANY (ARRAY['hide'::text, 'dismiss'::text])) AND (resolution_request_id IS NOT NULL))))
);

ALTER TABLE "private"."content_reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."notifications" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "recipient_id" uuid                     NOT NULL,
  "kind"         text                     NOT NULL DEFAULT 'comment'::text,
  "comment_id"   uuid                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "read_at"      timestamp with time zone,
  CONSTRAINT "notifications_comment_id_key" UNIQUE (comment_id),
  CONSTRAINT "notifications_kind_check" CHECK ((kind = 'comment'::text)),
  CONSTRAINT "notifications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "private"."notifications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."comments" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" uuid                     NOT NULL,
  "animal_id"  uuid                     NOT NULL,
  "author_id"  uuid                     NOT NULL,
  "body"       text,
  "status"     text                     NOT NULL DEFAULT 'visible'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "comments_check" CHECK ((((status = 'deleted'::text) AND (body IS NULL) AND (deleted_at IS
    NOT NULL)) OR ((status = ANY (ARRAY['visible'::text, 'hidden'::text])) AND (body IS NOT NULL) AND ((length(body) >= 1) AND (length(body) <= 500)) AND (deleted_at IS NULL)))),
  CONSTRAINT "comments_id_profile_id_key" UNIQUE (id, profile_id),
  CONSTRAINT "comments_pkey" PRIMARY KEY (id),
  CONSTRAINT "comments_status_check" CHECK ((status = ANY (ARRAY['visible'::text, 'hidden'::text, 'deleted'::text])))
);

ALTER TABLE "public"."comments"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."comments" FROM "anon", "authenticated";

CREATE OR REPLACE FUNCTION api.activity_context()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select jsonb_build_object('signed_in',auth.uid() is not null,'ready',coalesce(private.activity_member(auth.uid()),false),'public_name',coalesce((select display_name from public.profiles where id=auth.uid() and is_published and private.active(id)),'회원'));
$function$;

CREATE OR REPLACE FUNCTION api.admin_content_reports (
  p_status   text                     DEFAULT 'open'::text,
  p_after    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_after_id uuid                     DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare rows jsonb;more boolean;cursor_at timestamptz;cursor_id uuid;begin
 if p_status is null or p_status not in('open','resolved') or (p_after is null)<>(p_after_id is null) then raise exception 'VALIDATION_FAILED';end if;
 with page as(select * from private.content_reports where status=p_status and (p_after is null or(created_at,id)>(p_after,p_after_id)) order by created_at,id limit 21),visible as(select * from page order by created_at,id limit 20)
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'reason',r.reason,'detail',r.detail,'status',r.status,'created_at',r.created_at,'resolution_action',r.resolution_action,
 'target',jsonb_build_object('type',case when r.comment_id is not null then 'comment' else 'animal' end,'id',coalesce(r.comment_id,r.animal_id),'slug',p.slug,'animal_id',coalesce(r.animal_id,c.animal_id),'animal_name',a.name,'comment_body',c.body,'comment_status',c.status)) order by r.created_at,r.id),'[]'::jsonb),(select count(*)>20 from page) into rows,more
 from visible r join public.profiles p on p.id=r.profile_id left join public.comments c on c.id=r.comment_id left join public.animals a on a.id=coalesce(r.animal_id,c.animal_id);
 if more then select (r->>'created_at')::timestamptz,(r->>'id')::uuid into cursor_at,cursor_id from jsonb_array_elements(rows) with ordinality x(r,n) order by n desc limit 1;end if;
 return jsonb_build_object('rows',rows,'next',case when more then jsonb_build_object('after',cursor_at,'id',cursor_id) else null end);
end $function$;

CREATE OR REPLACE FUNCTION api.admin_resolve_report (
  p_report_id  uuid,
  p_hide       boolean,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r private.content_reports;target uuid;action text:=case when p_hide then 'hide' else 'dismiss' end;begin
 if p_report_id is null or p_request_id is null or p_hide is null then raise exception 'VALIDATION_FAILED';end if;
 select * into r from private.content_reports where id=p_report_id;if not found then raise exception 'NOT_FOUND';end if;
 if r.comment_id is not null then select animal_id into target from public.comments where id=r.comment_id;else target:=r.animal_id;end if;
 perform private.lock_activity_animal(target,false);
 select * into r from private.content_reports where id=p_report_id for update;if not found then raise exception 'NOT_FOUND';end if;
 if r.status='resolved' then
  if r.resolution_action<>action then raise exception 'REQUEST_CONFLICT';end if;
  return jsonb_build_object('id',r.id,'status',r.status,'action',r.resolution_action,'request_id',r.resolution_request_id);
 end if;
 if p_hide then
  if r.comment_id is not null then update public.comments set status='hidden',updated_at=now() where id=r.comment_id and status='visible';
  else
   update public.animals set is_public=false,updated_at=now() where id=r.animal_id and is_public;
   if found then perform private.bump(r.profile_id);end if;
  end if;
 end if;
 update private.content_reports set status='resolved',resolved_at=now(),resolution_action=action,resolution_request_id=p_request_id where id=r.id;
 return jsonb_build_object('id',r.id,'status','resolved','action',action,'request_id',p_request_id);
end $function$;

CREATE OR REPLACE FUNCTION api.create_comment (
  p_animal_id  uuid,
  p_body       text,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.activity_actor();hash text:=md5(jsonb_build_object('animal',p_animal_id,'body',p_body)::text);result jsonb;a public.animals;created_id uuid:=gen_random_uuid();body_value text;begin
 result:=private.replay_activity(actor,p_request_id,'comment_create',hash);if result is not null then return result;end if;
 if p_animal_id is null or p_body is null then raise exception 'VALIDATION_FAILED';end if;
 body_value:=private.trim_profile_text(p_body);if length(body_value) not between 1 and 500 then raise exception 'VALIDATION_FAILED';end if;
 a:=private.lock_activity_animal(p_animal_id,true);
 result:=private.claim_activity(actor,p_request_id,'comment_create',hash);if result is not null then return result;end if;
 perform private.check_writes();
 if (select count(*) from public.comments where animal_id=a.id)>=200 then raise exception 'QUOTA_EXCEEDED';end if;
 perform private.consume_activity_rate(actor,'comment');
 insert into public.comments(id,profile_id,animal_id,author_id,body) values(created_id,a.profile_id,a.id,actor,body_value);
 if actor<>a.profile_id then insert into private.notifications(recipient_id,comment_id) values(a.profile_id,created_id);end if;
 result:=jsonb_build_object('id',created_id,'status','visible');
 update private.mutation_receipts set result_ref=result where actor_id=actor and request_id=p_request_id;
 return result;
exception when others then
 if private.active(actor) then result:=private.replay_activity(actor,p_request_id,'comment_create',hash);if result is not null then return result;end if;end if;
 raise;
end $function$;

CREATE OR REPLACE FUNCTION api.create_content_report (
  p_animal_id  uuid,
  p_comment_id uuid,
  p_reason     text,
  p_detail     text,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.activity_actor();hash text:=md5(jsonb_build_object('animal',p_animal_id,'comment',p_comment_id,'reason',p_reason,'detail',p_detail)::text);result jsonb;a public.animals;detail_value text;created_id uuid:=gen_random_uuid();target uuid;begin
 result:=private.replay_activity(actor,p_request_id,'report_create',hash);if result is not null then return result;end if;
 if num_nonnulls(p_animal_id,p_comment_id)<>1 or p_reason is null or p_reason not in('spam','abuse','privacy','other') or p_detail is null then raise exception 'VALIDATION_FAILED';end if;
 detail_value:=private.trim_profile_text(p_detail);if length(detail_value)>500 then raise exception 'VALIDATION_FAILED';end if;
 if p_comment_id is not null then select animal_id into target from public.comments where id=p_comment_id;if not found then raise exception 'NOT_FOUND';end if;else target:=p_animal_id;end if;
 a:=private.lock_activity_animal(target,true);
 if p_comment_id is not null then
  perform 1 from public.comments where id=p_comment_id and animal_id=a.id and profile_id=a.profile_id and status='visible' for update;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 result:=private.claim_activity(actor,p_request_id,'report_create',hash);if result is not null then return result;end if;
 perform private.check_writes();perform private.consume_activity_rate(actor,'report');
 insert into private.content_reports(id,reporter_id,profile_id,animal_id,comment_id,reason,detail) values(created_id,actor,a.profile_id,p_animal_id,p_comment_id,p_reason,detail_value);
 result:=jsonb_build_object('id',created_id);
 update private.mutation_receipts set result_ref=result where actor_id=actor and request_id=p_request_id;return result;
exception when others then
 if private.active(actor) then result:=private.replay_activity(actor,p_request_id,'report_create',hash);if result is not null then return result;end if;end if;raise;
end $function$;

CREATE OR REPLACE FUNCTION api.delete_comment (
  p_comment_id uuid,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$select private.change_comment(p_comment_id,p_request_id,'comment_delete');$function$;

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
 delete from public.comments where author_id=p_actor;
 delete from private.content_reports where reporter_id=p_actor;
 delete from private.action_buckets where actor_id=p_actor;
 delete from private.animal_deletions where profile_id=p_actor;
 delete from private.storage_usage where profile_id=p_actor;
 delete from public.profiles where id=p_actor;
 update private.account_deletions set application_deleted_at=now() where user_id=p_actor;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION api.hide_comment (
  p_comment_id uuid,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$select private.change_comment(p_comment_id,p_request_id,'comment_hide');$function$;

CREATE OR REPLACE FUNCTION api.my_activity_request (
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();r private.mutation_receipts;begin
 select * into r from private.mutation_receipts where actor_id=actor and request_id=p_request_id and operation in('comment_create','comment_delete','comment_hide','report_create');
 if not found then return null;end if;if r.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;
 return jsonb_build_object('operation',r.operation,'result',r.result_ref);
end $function$;

CREATE OR REPLACE FUNCTION api.my_animal_comments (
  p_animal_id uuid,
  p_before    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id uuid                     DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();rows jsonb;more boolean;cursor_at timestamptz;cursor_id uuid;begin
 if (p_before is null)<>(p_before_id is null) then raise exception 'VALIDATION_FAILED';end if;
 if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor and deleted_at is null) then raise exception 'NOT_FOUND';end if;
 with page as(select * from public.comments where animal_id=p_animal_id and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 21),
 visible as(select * from page order by created_at desc,id desc limit 20)
 select coalesce(jsonb_agg(private.comment_dto(id,actor)||jsonb_build_object('status',status) order by created_at desc,id desc),'[]'::jsonb),(select count(*)>20 from page) into rows,more from visible;
 if more then select (r->>'created_at')::timestamptz,(r->>'id')::uuid into cursor_at,cursor_id from jsonb_array_elements(rows) with ordinality x(r,n) order by n desc limit 1;end if;
 return jsonb_build_object('rows',rows,'next',case when more then jsonb_build_object('before',cursor_at,'id',cursor_id) else null end);
end $function$;

CREATE OR REPLACE FUNCTION api.my_comment (
  p_comment_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();c public.comments;begin
 select * into c from public.comments where id=p_comment_id and (author_id=actor or profile_id=actor);if not found then return null;end if;
 return private.comment_dto(c.id,actor)||jsonb_build_object('status',c.status);
end $function$;

CREATE OR REPLACE FUNCTION api.prune_activity (
  p_actor uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$select private.prune_activity(p_actor);$function$;

CREATE OR REPLACE FUNCTION api.public_animal_comments (
  p_animal_id uuid,
  p_before    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id uuid                     DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare viewer uuid:=auth.uid();rows jsonb;more boolean;cursor_at timestamptz;cursor_id uuid;total integer;begin
 if p_animal_id is null or (p_before is null)<>(p_before_id is null) then raise exception 'VALIDATION_FAILED';end if;
 if not exists(select 1 from public.animals a join public.profiles p on p.id=a.profile_id where a.id=p_animal_id and a.deleted_at is null and a.is_public and p.is_published and private.active(p.id)) then return null;end if;
 select count(*) into total from public.comments where animal_id=p_animal_id and status='visible';
 with page as(select * from public.comments where animal_id=p_animal_id and status='visible' and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 21),
 visible as(select * from page order by created_at desc,id desc limit 20)
 select coalesce(jsonb_agg(private.comment_dto(id,viewer) order by created_at desc,id desc),'[]'::jsonb),(select count(*)>20 from page) into rows,more from visible;
 if more then select (r->>'created_at')::timestamptz,(r->>'id')::uuid into cursor_at,cursor_id from jsonb_array_elements(rows) with ordinality x(r,n) order by n desc limit 1;end if;
 return jsonb_build_object('rows',rows,'total',total,'next',case when more then jsonb_build_object('before',cursor_at,'id',cursor_id) else null end);
end $function$;

CREATE OR REPLACE FUNCTION api.public_comment (
  p_comment_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select private.comment_dto(p_comment_id,auth.uid()) where private.comment_visible(p_comment_id);
$function$;

CREATE OR REPLACE FUNCTION api.public_comment_count (
  p_animal_id uuid
)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$select case when exists(select 1 from public.animals a join public.profiles p on p.id=a.profile_id where a.id=p_animal_id and a.deleted_at is null and a.is_public and p.is_published and private.active(p.id)) then(select count(*)::integer from public.comments where animal_id=p_animal_id and status='visible') else 0 end;$function$;

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
    'socials',coalesce((select jsonb_agg(jsonb_build_object('platform',s.platform,'url',s.url) order by s.sort_order) from public.social_links s where s.profile_id=p.id and s.is_public),'[]'::jsonb),'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'url',l.url,'color_token',l.color_token) order by l.sort_order,l.id) from public.external_links l where l.profile_id=p.id and l.is_public),'[]'::jsonb),'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'comment_count',api.public_comment_count(a.id),'species',a.species,'morph',a.morph,'sex',a.sex,'birth_date',a.birth_date,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public),'[]'::jsonb));
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
 update public.comments set body=null,status='deleted',deleted_at=coalesce(deleted_at,now()),updated_at=now() where author_id=actor and status<>'deleted';
 delete from public.animal_photos where profile_id=actor;
 update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where profile_id=actor;
 -- Bind invitations at signup so a later email change cannot revive the original invitation.
 delete from private.signup_allowlist where invited_user_id=actor or normalized_email=(select lower(trim(email)) from auth.users where id=actor);
 result:=api.my_account_deletion();
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'delete_account',hash,jsonb_build_object('requested',true));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION private.activity_actor()
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();begin
 if not exists(select 1 from public.profiles where id=actor) or (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED';end if;
 return actor;
end $function$;

CREATE OR REPLACE FUNCTION private.activity_member (
  p_actor uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select private.active(p_actor) and exists(select 1 from public.profiles where id=p_actor) and (select count(*) from private.consents where user_id=p_actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))=2;
$function$;

CREATE OR REPLACE FUNCTION private.change_comment (
  p_id        uuid,
  p_request   uuid,
  p_operation text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();hash text:=md5(p_id::text);result jsonb;c public.comments;begin
 if p_operation not in('comment_delete','comment_hide') or p_id is null then raise exception 'VALIDATION_FAILED';end if;
 result:=private.replay_activity(actor,p_request,p_operation,hash);if result is not null then return result;end if;
 select * into c from public.comments where id=p_id;if not found then raise exception 'NOT_FOUND';end if;
 if (p_operation='comment_delete' and c.author_id<>actor) or (p_operation='comment_hide' and c.profile_id<>actor) then raise exception 'NOT_FOUND';end if;
 perform private.lock_activity_animal(c.animal_id,false);
 select * into c from public.comments where id=p_id for update;if not found then raise exception 'NOT_FOUND';end if;
 result:=private.claim_activity(actor,p_request,p_operation,hash);if result is not null then return result;end if;
 if p_operation='comment_delete' then
  update public.comments set body=null,status='deleted',deleted_at=coalesce(deleted_at,now()),updated_at=now() where id=p_id;
 else
  update public.comments set status='hidden',updated_at=now() where id=p_id and status='visible';
 end if;
 result:=jsonb_build_object('id',p_id,'status',(select status from public.comments where id=p_id));
 update private.mutation_receipts set result_ref=result where actor_id=actor and request_id=p_request;
 return result;
exception when others then
 if private.active(actor) then result:=private.replay_activity(actor,p_request,p_operation,hash);if result is not null then return result;end if;end if;raise;
end $function$;

CREATE OR REPLACE FUNCTION private.claim_activity (
  p_actor     uuid,
  p_request   uuid,
  p_operation text,
  p_hash      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$begin
 if p_request is null then raise exception 'VALIDATION_FAILED';end if;
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(p_actor,p_request,p_operation,p_hash,'{}'::jsonb) on conflict(actor_id,request_id) do nothing;
 if found then return null;end if;
 return private.replay_activity(p_actor,p_request,p_operation,p_hash);
end $function$;

CREATE OR REPLACE FUNCTION private.comment_dto (
  p_id     uuid,
  p_viewer uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select jsonb_build_object('id',c.id,'body',c.body,'created_at',c.created_at,
 'author',jsonb_build_object('name',coalesce(p.display_name,'회원'),'slug',p.slug,'avatar_asset_id',p.avatar_asset_id),
 'can_delete',coalesce(private.active(p_viewer) and c.author_id=p_viewer and c.status<>'deleted',false),
 'can_hide',coalesce(private.active(p_viewer) and c.profile_id=p_viewer and c.status='visible',false),
 'can_report',coalesce(private.activity_member(p_viewer) and private.comment_visible(c.id),false))
 from public.comments c left join public.profiles p on p.id=c.author_id and p.is_published and private.active(p.id) where c.id=p_id;
$function$;

CREATE OR REPLACE FUNCTION private.comment_visible (
  p_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select exists(select 1 from public.comments c join public.animals a on a.id=c.animal_id and a.profile_id=c.profile_id join public.profiles p on p.id=c.profile_id
 where c.id=p_id and c.status='visible' and a.deleted_at is null and a.is_public and p.is_published and private.active(p.id));
$function$;

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
 if p_action not in('comment','report') then raise exception 'VALIDATION_FAILED';end if;
 foreach seconds in array(case when p_action='comment' then array[2,60,86400] else array[2,86400] end) loop
  cap:=case when seconds=2 then 1 when seconds=60 then 3 when p_action='comment' then 30 else 5 end;
  start_at:=case when seconds=86400 then date_trunc('day',ts at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' else to_timestamp(floor(extract(epoch from ts)/seconds)*seconds) end;
  insert into private.action_buckets(actor_id,action,window_started_at,window_seconds,count,expires_at) values(p_actor,p_action,start_at,seconds,1,ts+interval '48 hours')
  on conflict(actor_id,action,window_started_at,window_seconds) do update set count=private.action_buckets.count+1 returning count into total;
  if total>cap then raise exception 'RATE_LIMITED' using hint=greatest(1,ceil(extract(epoch from start_at+make_interval(secs=>seconds)-ts)))::text;end if;
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.lock_activity_animal (
  p_animal uuid,
  p_public boolean
)
  RETURNS public.animals
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target uuid;a public.animals;p public.profiles;begin
 select profile_id into target from public.animals where id=p_animal;if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from private.account_state where user_id=target for share;
 select * into p from public.profiles where id=target for key share;if not found then raise exception 'NOT_FOUND';end if;
 select * into a from public.animals where id=p_animal and profile_id=target for update;
 if not found or (p_public and (a.deleted_at is not null or not private.active(target) or not p.is_published or not a.is_public)) then raise exception 'NOT_FOUND';end if;
 return a;
end $function$;

CREATE OR REPLACE FUNCTION private.prune_activity (
  p_actor uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare comments_count integer;notification_count integer;report_count integer;bucket_count integer;begin
 with expired as(select id from public.comments where (p_actor is null or author_id=p_actor) and status='deleted' and deleted_at<=now()-interval '7 days' order by deleted_at,id for update skip locked limit 500)
 delete from public.comments c using expired e where c.id=e.id;get diagnostics comments_count=row_count;
 with expired as(select id from private.notifications where (p_actor is null or recipient_id=p_actor) and created_at<=now()-interval '90 days' order by created_at,id for update skip locked limit 500)
 delete from private.notifications n using expired e where n.id=e.id;get diagnostics notification_count=row_count;
 with expired as(select id from private.content_reports where (p_actor is null or reporter_id=p_actor) and status='resolved' and resolved_at<=now()-interval '90 days' order by resolved_at,id for update skip locked limit 500)
 delete from private.content_reports r using expired e where r.id=e.id;get diagnostics report_count=row_count;
 with expired as(select actor_id,action,window_started_at,window_seconds from private.action_buckets where (p_actor is null or actor_id=p_actor) and expires_at<=now() order by expires_at,actor_id,action,window_started_at,window_seconds for update skip locked limit 500)
 delete from private.action_buckets b using expired e where b.actor_id=e.actor_id and b.action=e.action and b.window_started_at=e.window_started_at and b.window_seconds=e.window_seconds;get diagnostics bucket_count=row_count;
 return jsonb_build_object('comments',comments_count,'notifications',notification_count,'reports',report_count,'buckets',bucket_count);
end $function$;

CREATE OR REPLACE FUNCTION private.replay_activity (
  p_actor     uuid,
  p_request   uuid,
  p_operation text,
  p_hash      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r private.mutation_receipts;begin
 if p_request is null then raise exception 'VALIDATION_FAILED';end if;
 select * into r from private.mutation_receipts where actor_id=p_actor and request_id=p_request;
 if not found then return null;end if;
 if r.operation<>p_operation or r.request_hash is distinct from p_hash then raise exception 'REQUEST_CONFLICT';end if;
 if r.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;
 return r.result_ref;
end $function$;

ALTER TABLE "private"."action_buckets"
  ADD CONSTRAINT "action_buckets_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "private"."content_reports"
  ADD CONSTRAINT "content_reports_animal_id_profile_id_fkey" FOREIGN KEY (animal_id, profile_id) REFERENCES public.animals(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "private"."content_reports"
  ADD CONSTRAINT "content_reports_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "private"."content_reports"
  ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "private"."notifications"
  ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."comments"
  ADD CONSTRAINT "comments_animal_id_profile_id_fkey" FOREIGN KEY (animal_id, profile_id) REFERENCES public.animals(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "public"."comments"
  ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "private"."content_reports"
  ADD CONSTRAINT "content_reports_comment_id_profile_id_fkey" FOREIGN KEY (comment_id, profile_id) REFERENCES public.comments(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "private"."notifications"
  ADD CONSTRAINT "notifications_comment_id_recipient_id_fkey" FOREIGN KEY (comment_id, recipient_id) REFERENCES public.comments(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "public"."comments"
  ADD CONSTRAINT "comments_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX action_buckets_expiry_idx ON private.action_buckets USING btree (expires_at);

CREATE INDEX notifications_expiry_idx ON private.notifications USING btree (created_at, id);

CREATE INDEX notifications_recipient_created_idx ON private.notifications USING btree (recipient_id, created_at DESC, id DESC);

CREATE INDEX reports_animal_idx ON private.content_reports USING btree (animal_id, profile_id)
  WHERE (animal_id IS NOT NULL);

CREATE INDEX reports_comment_idx ON private.content_reports USING btree (comment_id, profile_id)
  WHERE (comment_id IS NOT NULL);

CREATE INDEX reports_profile_idx ON private.content_reports USING btree (profile_id);

CREATE INDEX reports_reporter_created_idx ON private.content_reports USING btree (reporter_id, created_at);

CREATE INDEX reports_resolved_expiry_idx ON private.content_reports USING btree (resolved_at, id)
  WHERE (status = 'resolved'::text);

CREATE INDEX reports_status_created_idx ON private.content_reports USING btree (status, created_at, id);

CREATE INDEX comments_animal_created_idx ON public.comments USING btree (animal_id, created_at DESC, id DESC);

CREATE INDEX comments_author_created_idx ON public.comments USING btree (author_id, created_at);

CREATE INDEX comments_deleted_expiry_idx ON public.comments USING btree (deleted_at, id)
  WHERE (status = 'deleted'::text);

CREATE INDEX comments_profile_idx ON public.comments USING btree (profile_id);

REVOKE ALL ON FUNCTION "api"."activity_context"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."activity_context"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "api"."admin_content_reports"(text, timestamp WITH time zone, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."admin_content_reports"(text, timestamp WITH time zone, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."admin_resolve_report"(uuid, boolean, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."admin_resolve_report"(uuid, boolean, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."create_comment"(uuid, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."create_comment"(uuid, text, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."create_content_report"(uuid, uuid, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."create_content_report"(uuid, uuid, text, text, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."delete_comment"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."delete_comment"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."hide_comment"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."hide_comment"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."my_activity_request"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_activity_request"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."my_animal_comments"(uuid, timestamp WITH time zone, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_animal_comments"(uuid, timestamp WITH time zone, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."my_comment"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_comment"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."prune_activity"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."prune_activity"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."public_animal_comments"(uuid, timestamp WITH time zone, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."public_animal_comments"(uuid, timestamp WITH time zone, uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "api"."public_comment"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."public_comment"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "api"."public_comment_count"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."public_comment_count"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "private"."activity_actor"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."activity_member"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."change_comment"(uuid, uuid, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."claim_activity"(uuid, uuid, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."comment_dto"(uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."comment_visible"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."consume_activity_rate"(uuid, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."lock_activity_animal"(uuid, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."prune_activity"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."replay_activity"(uuid, uuid, text, text) FROM PUBLIC;

REVOKE ALL ON TABLE "public"."comments" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."comments" TO "postgres";

REVOKE ALL ON TABLE "public"."comments" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."comments" TO "service_role";
