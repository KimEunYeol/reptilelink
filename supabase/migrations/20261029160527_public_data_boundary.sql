SET local check_function_bodies = off;

REVOKE ALL ON TABLE "public"."animal_photos" FROM "anon";

REVOKE ALL ON TABLE "public"."animal_photos" FROM "authenticated";

REVOKE ALL ON TABLE "public"."animals" FROM "anon";

REVOKE ALL ON TABLE "public"."animals" FROM "authenticated";

REVOKE ALL ("color_token") ON TABLE "public"."external_links" FROM "anon";

REVOKE ALL ("id") ON TABLE "public"."external_links" FROM "anon";

REVOKE ALL ("is_public") ON TABLE "public"."external_links" FROM "anon";

REVOKE ALL ("profile_id") ON TABLE "public"."external_links" FROM "anon";

REVOKE ALL ("sort_order") ON TABLE "public"."external_links" FROM "anon";

REVOKE ALL ("title") ON TABLE "public"."external_links" FROM "anon";

REVOKE ALL ("url") ON TABLE "public"."external_links" FROM "anon";

REVOKE ALL ("color_token") ON TABLE "public"."external_links" FROM "authenticated";

REVOKE ALL ("id") ON TABLE "public"."external_links" FROM "authenticated";

REVOKE ALL ("is_public") ON TABLE "public"."external_links" FROM "authenticated";

REVOKE ALL ("profile_id") ON TABLE "public"."external_links" FROM "authenticated";

REVOKE ALL ("sort_order") ON TABLE "public"."external_links" FROM "authenticated";

REVOKE ALL ("title") ON TABLE "public"."external_links" FROM "authenticated";

REVOKE ALL ("url") ON TABLE "public"."external_links" FROM "authenticated";

REVOKE ALL ("animal_id") ON TABLE "public"."growth_records" FROM "anon";

REVOKE ALL ("id") ON TABLE "public"."growth_records" FROM "anon";

REVOKE ALL ("measured_on") ON TABLE "public"."growth_records" FROM "anon";

REVOKE ALL ("weight_g") ON TABLE "public"."growth_records" FROM "anon";

REVOKE ALL ("animal_id") ON TABLE "public"."growth_records" FROM "authenticated";

REVOKE ALL ("id") ON TABLE "public"."growth_records" FROM "authenticated";

REVOKE ALL ("measured_on") ON TABLE "public"."growth_records" FROM "authenticated";

REVOKE ALL ("weight_g") ON TABLE "public"."growth_records" FROM "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "anon";

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

REVOKE ALL ("description") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("ends_at") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("id") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("is_always") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("is_closed") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("is_public") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("profile_id") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("sort_order") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("starts_at") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("title") ON TABLE "public"."schedules" FROM "anon";

REVOKE ALL ("description") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("ends_at") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("id") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("is_always") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("is_closed") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("is_public") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("profile_id") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("sort_order") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("starts_at") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("title") ON TABLE "public"."schedules" FROM "authenticated";

REVOKE ALL ("is_public") ON TABLE "public"."social_links" FROM "anon";

REVOKE ALL ("platform") ON TABLE "public"."social_links" FROM "anon";

REVOKE ALL ("profile_id") ON TABLE "public"."social_links" FROM "anon";

REVOKE ALL ("sort_order") ON TABLE "public"."social_links" FROM "anon";

REVOKE ALL ("url") ON TABLE "public"."social_links" FROM "anon";

REVOKE ALL ("is_public") ON TABLE "public"."social_links" FROM "authenticated";

REVOKE ALL ("platform") ON TABLE "public"."social_links" FROM "authenticated";

REVOKE ALL ("profile_id") ON TABLE "public"."social_links" FROM "authenticated";

REVOKE ALL ("sort_order") ON TABLE "public"."social_links" FROM "authenticated";

REVOKE ALL ("url") ON TABLE "public"."social_links" FROM "authenticated";

CREATE OR REPLACE FUNCTION api.public_animal_growth (
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
begin
 if p_period is null or p_period not in ('week','month','year') then raise exception 'VALIDATION_FAILED'; end if;
 if not exists(select 1 from public.animals a join public.profiles p on p.id=a.profile_id where a.id=p_animal_id and a.deleted_at is null and a.is_public and a.show_growth and p.is_published and private.active(p.id)) then return null; end if;
 return (with bounds as (select (now() at time zone 'Asia/Seoul')::date as today),
 data as (select id,measured_on,weight_g from public.growth_records g where g.animal_id=p_animal_id and exists(select 1 from public.animals a where a.id=g.animal_id and a.profile_id=g.profile_id)),
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

CREATE OR REPLACE FUNCTION api.public_page (
  p_slug text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare p public.profiles;
begin
  select * into p from public.profiles where slug=p_slug and is_published and private.active(id);
  if not found then return null; end if;
  return jsonb_build_object('like_count',api.public_profile_like_count(p_slug),'server_now',statement_timestamp(),'schedules',(api.public_schedules(p_slug)->'schedules'),'profile',jsonb_build_object('slug',p.slug,'display_name',p.display_name,'bio',p.bio,'tagline',p.tagline,'theme_token',p.theme_token,'avatar_asset_id',(select m.id from private.media_assets m where m.id=p.avatar_asset_id and m.profile_id=p.id and m.purpose='avatar' and m.state='ready'),'cover_asset_id',(select m.id from private.media_assets m where m.id=p.cover_asset_id and m.profile_id=p.id and m.purpose='cover' and m.state='ready')),
    'socials',coalesce((select jsonb_agg(jsonb_build_object('platform',s.platform,'url',s.url) order by s.sort_order) from public.social_links s where s.profile_id=p.id and s.is_public),'[]'::jsonb),'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'url',l.url,'color_token',l.color_token) order by l.sort_order,l.id) from public.external_links l where l.profile_id=p.id and l.is_public),'[]'::jsonb),'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'comment_count',api.public_comment_count(a.id),'species',a.species,'morph',a.morph,'sex',a.sex,'birth_date',a.birth_date,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph join private.media_assets m on m.id=ph.asset_id and m.profile_id=ph.profile_id and m.animal_id=ph.animal_id and m.purpose='animal' and m.state='ready' where ph.animal_id=a.id and ph.profile_id=a.profile_id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public and a.deleted_at is null),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.public_schedules (
  p_slug text,
  p_from date DEFAULT NULL::date,
  p_to   date DEFAULT NULL::date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare p public.profiles;stamp timestamptz:=statement_timestamp();lower_bound timestamptz;upper_bound timestamptz;begin
 if (p_from is not null and (not isfinite(p_from) or p_from<'0001-01-01'::date or p_from>'9999-12-31'::date)) or (p_to is not null and (not isfinite(p_to) or p_to<'0001-01-01'::date or p_to>'9999-12-31'::date)) or (p_from is not null and p_to is not null and p_from>p_to) then raise exception 'VALIDATION_FAILED';end if;
 select * into p from public.profiles where slug=p_slug and is_published and private.active(id);if not found then return null;end if;
 lower_bound:=p_from::timestamp at time zone 'Asia/Seoul';upper_bound:=(p_to+1)::timestamp at time zone 'Asia/Seoul';
 return jsonb_build_object('server_now',stamp,'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'description',s.description,'starts_at',s.starts_at,'ends_at',s.ends_at,'is_always',s.is_always,'is_closed',s.is_closed,'status',private.schedule_status(s.is_always,s.is_closed,s.starts_at,s.ends_at,stamp)) order by s.sort_order,s.id) from public.schedules s where s.profile_id=p.id and s.is_public and (s.is_always or ((lower_bound is null or s.ends_at>lower_bound) and (upper_bound is null or s.starts_at<upper_bound)))),'[]'::jsonb));
end $function$;
