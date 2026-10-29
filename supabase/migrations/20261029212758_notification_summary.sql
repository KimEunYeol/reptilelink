SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION api.my_notification_summary()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();
begin
 if not exists(select 1 from public.profiles where id=actor) then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('unread',(select count(*) from private.notifications where recipient_id=actor and read_at is null and created_at>now()-interval '90 days'));
end $function$;

REVOKE ALL ON FUNCTION "api"."my_notification_summary"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_notification_summary"() TO "authenticated";
