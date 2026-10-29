SET local check_function_bodies = off;

CREATE TABLE "public"."schedules" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "profile_id"  uuid                     NOT NULL,
  "title"       text                     NOT NULL,
  "description" text                     NOT NULL DEFAULT ''::text,
  "starts_at"   timestamp with time zone,
  "ends_at"     timestamp with time zone,
  "is_always"   boolean                  NOT NULL DEFAULT false,
  "is_closed"   boolean                  NOT NULL DEFAULT false,
  "is_public"   boolean                  NOT NULL DEFAULT false,
  "sort_order"  integer                  NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schedules_check" CHECK (((is_always AND (starts_at IS NULL) AND (ends_at IS NULL)) OR ((NOT is_always) AND (starts_at IS NOT NULL) AND (ends_at IS
    NOT NULL) AND isfinite(starts_at) AND isfinite(ends_at) AND (ends_at > starts_at)))),
  CONSTRAINT "schedules_description_check" CHECK ((length(description) <= 300)),
  CONSTRAINT "schedules_pkey" PRIMARY KEY (id),
  CONSTRAINT "schedules_profile_id_sort_order_key" UNIQUE (profile_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "schedules_sort_order_check" CHECK ((sort_order >= 0)),
  CONSTRAINT "schedules_title_check" CHECK ((((length(title) >= 1) AND (length(title) <= 80)) AND (title !~ '^[[:space:]]*$'::text)))
);

ALTER TABLE "public"."schedules"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION api.apply_schedules (
  p_items      jsonb,
  p_remove     jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();receipt private.mutation_receipts;hash text;result jsonb;r jsonb;ids uuid[]:='{}'::uuid[];removed uuid[]:='{}'::uuid[];rid uuid;changed boolean;revision bigint;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND'; end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
 hash:=md5(jsonb_build_object('items',p_items,'remove',p_remove)::text);
 select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'apply_schedules' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;return receipt.result_ref;
 end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_remove) is distinct from 'array' then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_array_length(p_items)>20 or jsonb_array_length(p_remove)>20 then raise exception 'VALIDATION_FAILED'; end if;
 for r in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(r) is distinct from 'object' or not(r?&array['id','is_public']) or r-array['id','is_public']<>'{}'::jsonb or jsonb_typeof(r->'id') is distinct from 'string' or (r->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(r->'is_public') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r->>'id')::uuid;if rid=any(ids) then raise exception 'VALIDATION_FAILED'; end if;ids:=array_append(ids,rid);
 end loop;
 for r in select value from jsonb_array_elements(p_remove) loop
  if jsonb_typeof(r) is distinct from 'string' or (r#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r#>>'{}')::uuid;if rid=any(ids) or rid=any(removed) then raise exception 'VALIDATION_FAILED'; end if;removed:=array_append(removed,rid);
 end loop;
 if (select count(*) from public.schedules where profile_id=actor)<>cardinality(ids)+cardinality(removed)
 or (select count(*) from public.schedules where profile_id=actor and id=any(ids||removed))<>cardinality(ids)+cardinality(removed) then raise exception 'VALIDATION_FAILED'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) with ordinality i(value,position)
  join(select id,is_public,row_number() over(order by sort_order,id) as position from public.schedules where profile_id=actor and not(id=any(removed))) l on l.id=(i.value->>'id')::uuid
  where l.position<>i.position or (not l.is_public and (i.value->>'is_public')::boolean)) then perform private.check_writes(); end if;
 delete from public.schedules where profile_id=actor and id=any(removed);changed:=found;
 set constraints public.schedules_profile_id_sort_order_key deferred;
 update public.schedules l set sort_order=i.position-1,is_public=(i.value->>'is_public')::boolean,updated_at=now() from jsonb_array_elements(p_items) with ordinality i(value,position)
  where l.profile_id=actor and l.id=(i.value->>'id')::uuid and (l.sort_order is distinct from i.position-1 or l.is_public is distinct from (i.value->>'is_public')::boolean);
 if changed or found then revision:=private.bump(actor);else select p.revision into revision from public.profiles p where id=actor;end if;
 result:=jsonb_build_object('revision',revision);
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'apply_schedules',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION api.my_schedules()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();stamp timestamptz:=statement_timestamp();begin
 if not exists(select 1 from public.profiles where id=actor) then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('revision',(select revision from public.profiles where id=actor),'server_now',stamp,'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'starts_at',starts_at,'ends_at',ends_at,'is_always',is_always,'is_closed',is_closed,'is_public',is_public,'sort_order',sort_order,'status',private.schedule_status(is_always,is_closed,starts_at,ends_at,stamp)) order by sort_order,id) from public.schedules where profile_id=actor),'[]'::jsonb));
end $function$;

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
  return jsonb_build_object('server_now',statement_timestamp(),'schedules',(api.public_schedules(p_slug)->'schedules'),'profile',jsonb_build_object('slug',p.slug,'display_name',p.display_name,'bio',p.bio,'tagline',p.tagline,'theme_token',p.theme_token),
    'socials',coalesce((select jsonb_agg(jsonb_build_object('platform',s.platform,'url',s.url) order by s.sort_order) from public.social_links s where s.profile_id=p.id and s.is_public),'[]'::jsonb),'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'url',l.url,'color_token',l.color_token) order by l.sort_order,l.id) from public.external_links l where l.profile_id=p.id and l.is_public),'[]'::jsonb),'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'species',a.species,'morph',a.morph,'sex',a.sex,'birth_date',a.birth_date,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.public_schedules (
  p_slug text,
  p_from date DEFAULT NULL::date,
  p_to   date DEFAULT NULL::date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare p public.profiles;stamp timestamptz:=statement_timestamp();lower_bound timestamptz;upper_bound timestamptz;begin
 if (p_from is not null and (not isfinite(p_from) or p_from<'0001-01-01'::date or p_from>'9999-12-31'::date)) or (p_to is not null and (not isfinite(p_to) or p_to<'0001-01-01'::date or p_to>'9999-12-31'::date)) or (p_from is not null and p_to is not null and p_from>p_to) then raise exception 'VALIDATION_FAILED';end if;
 select * into p from public.profiles where slug=p_slug and is_published;if not found then return null;end if;
 lower_bound:=p_from::timestamp at time zone 'Asia/Seoul';upper_bound:=(p_to+1)::timestamp at time zone 'Asia/Seoul';
 return jsonb_build_object('server_now',stamp,'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'description',s.description,'starts_at',s.starts_at,'ends_at',s.ends_at,'is_always',s.is_always,'is_closed',s.is_closed,'status',private.schedule_status(s.is_always,s.is_closed,s.starts_at,s.ends_at,stamp)) order by s.sort_order,s.id) from public.schedules s where s.profile_id=p.id and s.is_public and (s.is_always or ((lower_bound is null or s.ends_at>lower_bound) and (upper_bound is null or s.starts_at<upper_bound)))),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.save_schedule (
  p_schedule_id uuid,
  p_data        jsonb,
  p_expected    bigint,
  p_request_id  uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();receipt private.mutation_receipts;hash text;result jsonb;item public.schedules;new_id uuid;title_value text;starts_value timestamptz;ends_value timestamptz;always_value boolean;closed_value boolean;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED';end if;
 hash:=md5(jsonb_build_object('id',p_schedule_id,'data',p_data)::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_schedule' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;return receipt.result_ref;
 end if;
 if p_schedule_id is not null then select * into item from public.schedules where id=p_schedule_id and profile_id=actor;if not found then raise exception 'NOT_FOUND';end if;end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_data) is distinct from 'object' or not(p_data?&array['title','description','starts_at','ends_at','is_always','is_closed']) or p_data-array['title','description','starts_at','ends_at','is_always','is_closed']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED';end if;
 if jsonb_typeof(p_data->'title') is distinct from 'string' or jsonb_typeof(p_data->'description') is distinct from 'string' or jsonb_typeof(p_data->'is_always') is distinct from 'boolean' or jsonb_typeof(p_data->'is_closed') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED';end if;
 title_value:=regexp_replace(p_data->>'title',('^[[:space:]'||chr(65279)||']+|[[:space:]'||chr(65279)||']+$'),'','g');always_value:=(p_data->>'is_always')::boolean;closed_value:=(p_data->>'is_closed')::boolean;
 if length(title_value) not between 1 and 80 or length(p_data->>'description')>300 then raise exception 'VALIDATION_FAILED';end if;
 if always_value then
  if p_data->'starts_at'<>'null'::jsonb or p_data->'ends_at'<>'null'::jsonb then raise exception 'VALIDATION_FAILED';end if;
 else
  if jsonb_typeof(p_data->'starts_at') is distinct from 'string' or jsonb_typeof(p_data->'ends_at') is distinct from 'string' or (p_data->>'starts_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' or (p_data->>'ends_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' then raise exception 'VALIDATION_FAILED';end if;
  starts_value:=(p_data->>'starts_at')::timestamptz;ends_value:=(p_data->>'ends_at')::timestamptz;
  if ends_value<=starts_value or to_char(starts_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>(case when position('.' in p_data->>'starts_at')=0 then replace(p_data->>'starts_at','Z','.000Z') else p_data->>'starts_at' end) or to_char(ends_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>(case when position('.' in p_data->>'ends_at')=0 then replace(p_data->>'ends_at','Z','.000Z') else p_data->>'ends_at' end) then raise exception 'VALIDATION_FAILED';end if;
 end if;
 if p_schedule_id is null or item.title is distinct from title_value or item.description is distinct from p_data->>'description' or item.starts_at is distinct from starts_value or item.ends_at is distinct from ends_value or item.is_always is distinct from always_value or (item.is_closed and not closed_value) then perform private.check_writes();end if;
 if p_schedule_id is null then
  if (select count(*) from public.schedules where profile_id=actor)>=20 then raise exception 'QUOTA_EXCEEDED';end if;
  insert into public.schedules(profile_id,title,description,starts_at,ends_at,is_always,is_closed,sort_order) values(actor,title_value,p_data->>'description',starts_value,ends_value,always_value,closed_value,coalesce((select max(sort_order)+1 from public.schedules where profile_id=actor),0)) returning id into new_id;
 else
  update public.schedules set title=title_value,description=p_data->>'description',starts_at=starts_value,ends_at=ends_value,is_always=always_value,is_closed=closed_value,updated_at=now() where id=p_schedule_id and profile_id=actor returning id into new_id;if not found then raise exception 'NOT_FOUND';end if;
 end if;
 result:=jsonb_build_object('id',new_id,'revision',private.bump(actor));insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_schedule',hash,result);return result;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_FAILED';
end $function$;

CREATE OR REPLACE FUNCTION private.schedule_status (
  p_always boolean,
  p_closed boolean,
  p_start  timestamp with time zone,
  p_end    timestamp with time zone,
  p_now    timestamp with time zone
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
 select case when p_closed then 'CLOSE' when p_always then 'ALWAYS' when p_now<p_start then 'SOON' when p_now<p_end then 'OPEN' else 'CLOSE' end;
$function$;

ALTER TABLE "public"."schedules"
  ADD CONSTRAINT "schedules_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE POLICY "schedule_read" ON "public"."schedules"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((private.active(profile_id) AND ((profile_id = ( SELECT auth.uid() AS uid)) OR (is_public AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = schedules.profile_id) AND p.is_published)))))));

REVOKE ALL ON FUNCTION "api"."apply_schedules"(jsonb, jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."apply_schedules"(jsonb, jsonb, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."my_schedules"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_schedules"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."public_schedules"(text, date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."public_schedules"(text, date, date) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "api"."save_schedule"(uuid, jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."save_schedule"(uuid, jsonb, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."schedule_status"(boolean, boolean, timestamp WITH time zone, timestamp WITH time zone, timestamp WITH time zone) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."schedule_status"(boolean, boolean, timestamp WITH time zone, timestamp WITH time zone, timestamp WITH time zone) TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("description") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("description") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ("ends_at") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("ends_at") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ("id") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("id") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ("is_always") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("is_always") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ("is_closed") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("is_closed") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ("is_public") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("is_public") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ("profile_id") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("profile_id") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ("sort_order") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("sort_order") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ("starts_at") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("starts_at") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ("title") ON TABLE "public"."schedules" FROM "anon";

GRANT SELECT ("title") ON TABLE "public"."schedules" TO "anon";

REVOKE ALL ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("description") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("description") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ("ends_at") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("ends_at") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ("is_always") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("is_always") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ("is_closed") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("is_closed") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ("is_public") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("is_public") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ("profile_id") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("profile_id") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ("sort_order") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("sort_order") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ("starts_at") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("starts_at") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ("title") ON TABLE "public"."schedules" FROM "authenticated";

GRANT SELECT ("title") ON TABLE "public"."schedules" TO "authenticated";

REVOKE ALL ON TABLE "public"."schedules" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schedules" TO "postgres";

REVOKE ALL ON TABLE "public"."schedules" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."schedules" TO "service_role";
