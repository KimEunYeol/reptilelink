SET local check_function_bodies = off;

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
  insert into private.action_buckets(actor_id,action,window_started_at,window_seconds,count,expires_at) values(p_actor,p_action,start_at,seconds,1,ts+interval '47 hours')
  on conflict(actor_id,action,window_started_at,window_seconds) do update set count=private.action_buckets.count+1 returning count into total;
  if total>cap then raise exception 'RATE_LIMITED' using hint=greatest(1,ceil(extract(epoch from start_at+make_interval(secs=>seconds)-ts)))::text;end if;
 end loop;
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
 with expired as(select id from public.comments where (p_actor is null or author_id=p_actor) and status='deleted' and deleted_at<=now()-interval '6 days 23 hours' order by deleted_at,id for update skip locked limit 500)
 delete from public.comments c using expired e where c.id=e.id;get diagnostics comments_count=row_count;
 with expired as(select id from private.notifications where (p_actor is null or recipient_id=p_actor) and created_at<=now()-interval '89 days 23 hours' order by created_at,id for update skip locked limit 500)
 delete from private.notifications n using expired e where n.id=e.id;get diagnostics notification_count=row_count;
 with expired as(select id from private.content_reports where (p_actor is null or reporter_id=p_actor) and status='resolved' and resolved_at<=now()-interval '89 days 23 hours' order by resolved_at,id for update skip locked limit 500)
 delete from private.content_reports r using expired e where r.id=e.id;get diagnostics report_count=row_count;
 with expired as(select actor_id,action,window_started_at,window_seconds from private.action_buckets where (p_actor is null or actor_id=p_actor) and expires_at<=now() order by expires_at,actor_id,action,window_started_at,window_seconds for update skip locked limit 500)
 delete from private.action_buckets b using expired e where b.actor_id=e.actor_id and b.action=e.action and b.window_started_at=e.window_started_at and b.window_seconds=e.window_seconds;get diagnostics bucket_count=row_count;
 return jsonb_build_object('comments',comments_count,'notifications',notification_count,'reports',report_count,'buckets',bucket_count);
end $function$;
