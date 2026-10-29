SET local check_function_bodies = off;

ALTER TABLE "private"."action_buckets"
  DROP CONSTRAINT "action_buckets_action_check";

CREATE OR REPLACE FUNCTION api.my_notifications (
  p_before    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id uuid                     DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor(); rows jsonb;more boolean;cursor_at timestamptz;cursor_id uuid;
begin
 if(p_before is null)<>(p_before_id is null) then raise exception 'VALIDATION_FAILED';end if;
 if not exists(select 1 from public.profiles where id=actor) then raise exception 'NOT_FOUND';end if;
 with page as(select id,created_at from private.notifications where recipient_id=actor and created_at>now()-interval '90 days' and(p_before is null or(created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 6),shown as(select * from page order by created_at desc,id desc limit 5)
 select coalesce(jsonb_agg(private.notification_dto(id,actor) order by created_at desc,id desc),'[]'::jsonb),(select count(*)>5 from page) into rows,more from shown;
 if more then select(r->>'created_at')::timestamptz,(r->>'id')::uuid into cursor_at,cursor_id from jsonb_array_elements(rows)with ordinality x(r,n)order by n desc limit 1;end if;
 return jsonb_build_object('rows',rows,'next',case when more then jsonb_build_object('before',cursor_at,'id',cursor_id)else null end,'unread',(select count(*)from private.notifications where recipient_id=actor and read_at is null and created_at>now()-interval '90 days'));
end $function$;

CREATE OR REPLACE FUNCTION api.read_notifications (
  p_ids        uuid[],
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();ids uuid[];hash text;result jsonb;owned integer;begin
 if p_ids is null or cardinality(p_ids)not between 1 and 5 or array_position(p_ids,null)is not null or array_ndims(p_ids)<>1 then raise exception 'VALIDATION_FAILED';end if;
 select array_agg(id order by id) into ids from(select distinct unnest(p_ids)id)x;
 if cardinality(ids)<>cardinality(p_ids) then raise exception 'VALIDATION_FAILED';end if;
 hash:=md5(to_jsonb(ids)::text);result:=private.replay_activity(actor,p_request_id,'notifications_read',hash);if result is not null then return result;end if;
 -- Receipt first: this command never locks a profile, animal or another actor's
 -- notifications. Sorted owned row locks cannot invert content writer locks.
 result:=private.claim_activity(actor,p_request_id,'notifications_read',hash);if result is not null then return result;end if;
 perform private.consume_activity_rate(actor,'notification_read');
 perform id from private.notifications where id=any(ids) and recipient_id=actor and created_at>now()-interval '90 days' order by id for update;
 get diagnostics owned=row_count;if owned<>cardinality(ids) then raise exception 'NOT_FOUND';end if;
 update private.notifications set read_at=coalesce(read_at,now())where id=any(ids)and recipient_id=actor;
 result:=jsonb_build_object('read',cardinality(ids));update private.mutation_receipts set result_ref=result where actor_id=actor and request_id=p_request_id;
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
 if p_action is null or p_action not in('comment','report','like','notification_read') then raise exception 'VALIDATION_FAILED';end if;
 foreach seconds in array(case when p_action in('like','notification_read') then array[3600] when p_action='comment' then array[2,60,86400] else array[2,86400] end) loop
  cap:=case when seconds=3600 then 60 when seconds=2 then 1 when seconds=60 then 3 when p_action='comment' then 30 else 5 end;
  start_at:=case when seconds=86400 then date_trunc('day',ts at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' else to_timestamp(floor(extract(epoch from ts)/seconds)*seconds) end;
  insert into private.action_buckets(actor_id,action,window_started_at,window_seconds,count,expires_at) values(p_actor,p_action,start_at,seconds,1,ts+interval '47 hours')
  on conflict(actor_id,action,window_started_at,window_seconds) do update set count=private.action_buckets.count+1 returning count into total;
  if total>cap then raise exception 'RATE_LIMITED' using hint=greatest(1,ceil(extract(epoch from start_at+make_interval(secs=>seconds)-ts)))::text;end if;
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.notification_dto (
  p_id    uuid,
  p_actor uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select jsonb_build_object('id',n.id,'kind',n.kind,'created_at',n.created_at,'read_at',n.read_at,'available',coalesce(v.available,false),
 'body',case when v.available then c.body else null end,
 'author',jsonb_build_object('name',case when v.available then coalesce(author.display_name,'회원') else '회원' end,'slug',case when v.available then author.slug else null end,'avatar_asset_id',case when v.available then author.avatar_asset_id else null end),
 'target',case when v.available and n.kind='comment' then jsonb_build_object('slug',target.slug,'animal_id',c.animal_id) else null end)
 from private.notifications n left join public.comments c on c.id=n.comment_id left join private.profile_likes l on l.id=n.like_id
 join public.profiles target on target.id=n.recipient_id
 cross join lateral(select target.is_published and private.active(target.id) and (case when n.kind='comment' then private.comment_visible(c.id) else l.id is not null end) as available)v
 left join public.profiles author on author.id=coalesce(c.author_id,l.actor_id) and author.is_published and private.active(author.id)
 where n.id=p_id and n.recipient_id=p_actor and n.created_at>now()-interval '90 days';
$function$;

ALTER TABLE "private"."action_buckets"
  ADD CONSTRAINT "action_buckets_action_check" CHECK ((action = ANY (ARRAY['comment'::text, 'report'::text, 'like'::text, 'notification_read'::text])));

REVOKE ALL ON FUNCTION "api"."my_notifications"(timestamp WITH time zone, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_notifications"(timestamp WITH time zone, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."read_notifications"(uuid[], uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."read_notifications"(uuid[], uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."notification_dto"(uuid, uuid) FROM PUBLIC;
