SET local check_function_bodies = off;

CREATE TABLE "private"."growth_notes" (
  "record_id"  uuid                     NOT NULL,
  "profile_id" uuid                     NOT NULL,
  "body"       text                     NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "growth_notes_body_check" CHECK ((length(body) <= 1000)),
  CONSTRAINT "growth_notes_pkey" PRIMARY KEY (record_id)
);

ALTER TABLE "private"."growth_notes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."growth_records" (
  "id"          uuid                     NOT NULL,
  "profile_id"  uuid                     NOT NULL,
  "animal_id"   uuid                     NOT NULL,
  "measured_on" date                     NOT NULL,
  "weight_g"    numeric                  NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "growth_animal_day_key" UNIQUE (animal_id, measured_on) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "growth_records_id_profile_id_key" UNIQUE (id, profile_id),
  CONSTRAINT "growth_records_measured_on_check" CHECK (((measured_on >= '0001-01-01'::date) AND (measured_on <= '9999-12-31'::date))),
  CONSTRAINT "growth_records_pkey" PRIMARY KEY (id),
  CONSTRAINT "growth_records_weight_g_check" CHECK (((weight_g > (0)::numeric) AND (weight_g <= (100000)::numeric) AND (scale(weight_g) <= 2)))
);

ALTER TABLE "public"."growth_records"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION api.my_animal_growth (
  p_animal_id uuid,
  p_period    text DEFAULT 'month'::text,
  p_before    date DEFAULT NULL::date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();begin
 if p_period is null or p_period not in ('week','month','year') then raise exception 'VALIDATION_FAILED'; end if;
 if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
 return (with bounds as (select (now() at time zone 'Asia/Seoul')::date as today),
 data as (select id,measured_on,weight_g from public.growth_records where animal_id=p_animal_id),
 page as (select * from data where p_before is null or measured_on<p_before order by measured_on desc limit 21),
 visible as (select * from page order by measured_on desc limit 20),
 chart_rows as (select *,row_number() over(order by measured_on) as rn,count(*) over() as cnt from data,bounds where measured_on between today-(case p_period when 'week' then 6 when 'month' then 29 else 364 end) and today),
 sampled as (select distinct on(case when cnt<2 then 0 else floor((rn-1)*119.0/(cnt-1)) end) * from chart_rows order by case when cnt<2 then 0 else floor((rn-1)*119.0/(cnt-1)) end,rn)
 select jsonb_build_object('today',today,'period',p_period,'from',today-(case p_period when 'week' then 6 when 'month' then 29 else 364 end),'to',today,
 'records',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'measured_on',g.measured_on,'weight_g',g.weight_g,'note',coalesce((select n.body from private.growth_notes n where n.record_id=g.id and n.profile_id=actor),'')) order by g.measured_on desc) from visible g),'[]'::jsonb),
 'next_before',case when (select count(*) from page)>20 then (select min(measured_on) from visible) else null end,
 'chart',coalesce((select jsonb_agg(jsonb_build_object('measured_on',measured_on,'weight_g',weight_g) order by measured_on) from sampled),'[]'::jsonb),
 'latest',(select jsonb_build_object('measured_on',measured_on,'weight_g',weight_g) from data order by measured_on desc limit 1)
 ,'show_growth',(select show_growth from public.animals where id=p_animal_id),'note',coalesce((select body from private.animal_notes where animal_id=p_animal_id and profile_id=actor),''),'revision',(select revision from public.profiles where id=actor),'total',(select count(*) from data),'profile_total',(select count(*) from public.growth_records where profile_id=actor)) from bounds);
end $function$;

CREATE OR REPLACE FUNCTION api.public_animal_growth (
  p_animal_id uuid,
  p_period    text DEFAULT 'month'::text,
  p_before    date DEFAULT NULL::date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
 if p_period is null or p_period not in ('week','month','year') then raise exception 'VALIDATION_FAILED'; end if;
 if not exists(select 1 from public.animals a join public.profiles p on p.id=a.profile_id where a.id=p_animal_id and a.deleted_at is null and a.is_public and a.show_growth and p.is_published and private.active(p.id)) then return null; end if;
 return (with bounds as (select (now() at time zone 'Asia/Seoul')::date as today),
 data as (select id,measured_on,weight_g from public.growth_records where animal_id=p_animal_id),
 page as (select * from data where p_before is null or measured_on<p_before order by measured_on desc limit 21),
 visible as (select * from page order by measured_on desc limit 20),
 chart_rows as (select *,row_number() over(order by measured_on) as rn,count(*) over() as cnt from data,bounds where measured_on between today-(case p_period when 'week' then 6 when 'month' then 29 else 364 end) and today),
 sampled as (select distinct on(case when cnt<2 then 0 else floor((rn-1)*119.0/(cnt-1)) end) * from chart_rows order by case when cnt<2 then 0 else floor((rn-1)*119.0/(cnt-1)) end,rn)
 select jsonb_build_object('today',today,'period',p_period,'from',today-(case p_period when 'week' then 6 when 'month' then 29 else 364 end),'to',today,
 'records',coalesce((select jsonb_agg(jsonb_build_object('measured_on',g.measured_on,'weight_g',g.weight_g) order by g.measured_on desc) from visible g),'[]'::jsonb),
 'next_before',case when (select count(*) from page)>20 then (select min(measured_on) from visible) else null end,
 'chart',coalesce((select jsonb_agg(jsonb_build_object('measured_on',measured_on,'weight_g',weight_g) order by measured_on) from sampled),'[]'::jsonb),
 'latest',(select jsonb_build_object('measured_on',measured_on,'weight_g',weight_g) from data order by measured_on desc limit 1)
 ) from bounds);
end $function$;

CREATE OR REPLACE FUNCTION api.save_animal_growth (
  p_animal_id  uuid,
  p_data       jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();receipt private.mutation_receipts;hash text;result jsonb;a public.animals;
 r jsonb;rid uuid;day date;weight numeric;old_note text;ids uuid[]:='{}'::uuid[];removed uuid[]:='{}'::uuid[];
begin
 if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
 perform 1 from public.profiles where id=actor for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
 hash:=md5(jsonb_build_object('animal_id',p_animal_id,'data',p_data)::text);
 select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_animal_growth' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;
  return receipt.result_ref;
 end if;
 select * into a from public.animals where id=p_animal_id and profile_id=actor and deleted_at is null for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_data) is distinct from 'object' or not(p_data?&array['upsert','remove','note','show_growth'])
 or p_data-array['upsert','remove','note','show_growth']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_typeof(p_data->'upsert') is distinct from 'array' or jsonb_typeof(p_data->'remove') is distinct from 'array'
 or jsonb_typeof(p_data->'note') is distinct from 'string' or jsonb_typeof(p_data->'show_growth') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_array_length(p_data->'upsert')>100 or jsonb_array_length(p_data->'remove')>100 or length(p_data->>'note')>2000 then raise exception 'VALIDATION_FAILED'; end if;
 for r in select value from jsonb_array_elements(p_data->'upsert') loop
  if jsonb_typeof(r) is distinct from 'object' or not(r?&array['id','measured_on','weight_g','note']) or r-array['id','measured_on','weight_g','note']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
  if jsonb_typeof(r->'id') is distinct from 'string' or (r->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(r->'measured_on') is distinct from 'string' or (r->>'measured_on')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(r->'weight_g') is distinct from 'string' or (r->>'weight_g')!~'^[0-9]{1,6}(\.[0-9]{1,2})?$'
  or jsonb_typeof(r->'note') is distinct from 'string' or length(r->>'note')>1000 then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r->>'id')::uuid;
  if rid=any(ids) then raise exception 'VALIDATION_FAILED'; end if;ids:=array_append(ids,rid);
  if exists(select 1 from public.growth_records where id=rid and (animal_id<>a.id or profile_id<>actor)) then raise exception 'NOT_FOUND'; end if;
  begin day:=(r->>'measured_on')::date;exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_FAILED';end;
  weight:=(r->>'weight_g')::numeric;
  if to_char(day,'YYYY-MM-DD')<>r->>'measured_on' or day>(now() at time zone 'Asia/Seoul')::date or weight<=0 or weight>100000 then raise exception 'VALIDATION_FAILED'; end if;
 end loop;
 for r in select value from jsonb_array_elements(p_data->'remove') loop
  if jsonb_typeof(r) is distinct from 'string' or (r#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r#>>'{}')::uuid;
  if rid=any(removed) or rid=any(ids) then raise exception 'VALIDATION_FAILED'; end if;removed:=array_append(removed,rid);
  if not exists(select 1 from public.growth_records where id=rid and animal_id=a.id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
 end loop;
 select coalesce((select body from private.animal_notes where animal_id=a.id and profile_id=actor),'') into old_note;
 if cardinality(ids)>0 or (not a.show_growth and (p_data->>'show_growth')::boolean) or ((p_data->>'note')<>old_note and (p_data->>'note')<>'') then perform private.check_writes(); end if;
 delete from public.growth_records where id=any(removed) and animal_id=a.id and profile_id=actor;
 set constraints public.growth_animal_day_key deferred;
 for r in select value from jsonb_array_elements(p_data->'upsert') loop
  rid:=(r->>'id')::uuid;
  insert into public.growth_records(id,profile_id,animal_id,measured_on,weight_g) values(rid,actor,a.id,(r->>'measured_on')::date,(r->>'weight_g')::numeric)
   on conflict(id) do update set measured_on=excluded.measured_on,weight_g=excluded.weight_g,updated_at=now();
  if r->>'note'='' then delete from private.growth_notes where record_id=rid and profile_id=actor;
  else insert into private.growth_notes(record_id,profile_id,body) values(rid,actor,r->>'note') on conflict(record_id) do update set body=excluded.body,updated_at=now(); end if;
 end loop;
 if exists(select 1 from public.growth_records where animal_id=a.id group by measured_on having count(*)>1) then raise exception 'VALIDATION_FAILED'; end if;
 if (select count(*) from public.growth_records where profile_id=actor)>3000 then raise exception 'QUOTA_EXCEEDED'; end if;
 if p_data->>'note'='' then delete from private.animal_notes where animal_id=a.id and profile_id=actor;
 else insert into private.animal_notes(animal_id,profile_id,body) values(a.id,actor,p_data->>'note') on conflict(animal_id) do update set body=excluded.body,updated_at=now(); end if;
 update public.animals set show_growth=(p_data->>'show_growth')::boolean,updated_at=now() where id=a.id;
 result:=jsonb_build_object('id',a.id,'revision',private.bump(actor));
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_animal_growth',hash,result);
 return result;
end $function$;

CREATE OR REPLACE FUNCTION private.guard_growth()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
 if not exists(select 1 from public.animals where id=new.animal_id and profile_id=new.profile_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
 if new.measured_on>(now() at time zone 'Asia/Seoul')::date then raise exception 'VALIDATION_FAILED'; end if;
 return new;
end $function$;

ALTER TABLE "public"."growth_records"
  ADD CONSTRAINT "growth_records_animal_id_profile_id_fkey" FOREIGN KEY (animal_id, profile_id) REFERENCES public.animals(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "private"."growth_notes"
  ADD CONSTRAINT "growth_notes_record_id_profile_id_fkey" FOREIGN KEY (record_id, profile_id) REFERENCES public.growth_records(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "public"."growth_records"
  ADD CONSTRAINT "growth_records_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX growth_notes_owner_idx ON private.growth_notes USING btree (profile_id);

CREATE INDEX growth_owner_idx ON public.growth_records USING btree (profile_id);

CREATE TRIGGER growth_live_animal
  BEFORE INSERT OR UPDATE ON public.growth_records
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_growth();

CREATE POLICY "growth_read" ON "public"."growth_records"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((private.active(profile_id) AND (EXISTS ( SELECT 1
   FROM (public.animals a
     JOIN public.profiles p ON ((p.id = a.profile_id)))
  WHERE
    ((a.id = growth_records.animal_id) AND (a.profile_id = growth_records.profile_id) AND (a.deleted_at IS NULL) AND ((a.profile_id = ( SELECT auth.uid() AS uid)) OR (a.is_public
    AND a.show_growth AND p.is_published)))))));

REVOKE ALL ON FUNCTION "api"."my_animal_growth"(uuid, text, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_animal_growth"(uuid, text, date) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."public_animal_growth"(uuid, text, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."public_animal_growth"(uuid, text, date) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "api"."save_animal_growth"(uuid, jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."save_animal_growth"(uuid, jsonb, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."guard_growth"() FROM PUBLIC;

REVOKE ALL ON TABLE "public"."growth_records" FROM "anon";

REVOKE ALL ("animal_id") ON TABLE "public"."growth_records" FROM "anon";

GRANT SELECT ("animal_id") ON TABLE "public"."growth_records" TO "anon";

REVOKE ALL ("id") ON TABLE "public"."growth_records" FROM "anon";

GRANT SELECT ("id") ON TABLE "public"."growth_records" TO "anon";

REVOKE ALL ("measured_on") ON TABLE "public"."growth_records" FROM "anon";

GRANT SELECT ("measured_on") ON TABLE "public"."growth_records" TO "anon";

REVOKE ALL ("weight_g") ON TABLE "public"."growth_records" FROM "anon";

GRANT SELECT ("weight_g") ON TABLE "public"."growth_records" TO "anon";

REVOKE ALL ON TABLE "public"."growth_records" FROM "authenticated";

REVOKE ALL ("animal_id") ON TABLE "public"."growth_records" FROM "authenticated";

GRANT SELECT ("animal_id") ON TABLE "public"."growth_records" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."growth_records" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."growth_records" TO "authenticated";

REVOKE ALL ("measured_on") ON TABLE "public"."growth_records" FROM "authenticated";

GRANT SELECT ("measured_on") ON TABLE "public"."growth_records" TO "authenticated";

REVOKE ALL ("weight_g") ON TABLE "public"."growth_records" FROM "authenticated";

GRANT SELECT ("weight_g") ON TABLE "public"."growth_records" TO "authenticated";

REVOKE ALL ON TABLE "public"."growth_records" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."growth_records" TO "postgres";

REVOKE ALL ON TABLE "public"."growth_records" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."growth_records" TO "service_role";
