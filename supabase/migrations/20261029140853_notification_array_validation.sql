SET local check_function_bodies = off;

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
 if p_ids is null or cardinality(p_ids)not between 1 and 5 or array_ndims(p_ids)<>1 then raise exception 'VALIDATION_FAILED';end if;
 if array_position(p_ids,null)is not null then raise exception 'VALIDATION_FAILED';end if;
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
