SET local check_function_bodies = off;

CREATE TABLE "private"."analytics_daily" (
  "profile_id" uuid                     NOT NULL,
  "day"        date                     NOT NULL,
  "page_views" bigint                   NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_daily_page_views_check" CHECK ((page_views >= 0)),
  CONSTRAINT "analytics_daily_pkey" PRIMARY KEY (profile_id, day)
);

ALTER TABLE "private"."analytics_daily"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."analytics_receipts" (
  "profile_id"   uuid                     NOT NULL,
  "day"          date                     NOT NULL,
  "session_hash" text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL,
  "expires_at"   timestamp with time zone NOT NULL,
  CONSTRAINT "analytics_receipts_check" CHECK ((expires_at = (created_at + '47:00:00'::interval))),
  CONSTRAINT "analytics_receipts_pkey" PRIMARY KEY (profile_id, day, session_hash),
  CONSTRAINT "analytics_receipts_session_hash_check" CHECK ((session_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE "private"."analytics_receipts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."analytics_settings" (
  "id"             integer                  NOT NULL,
  "enabled"        boolean                  NOT NULL DEFAULT false,
  "started_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "profile_limit"  integer                  NOT NULL DEFAULT 1000,
  "day_limit"      integer                  NOT NULL DEFAULT 5000,
  "counter_day"    date                     NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul'::text))::date,
  "accepted_count" integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "analytics_settings_accepted_count_check" CHECK (((accepted_count >= 0) AND (accepted_count <= 5000))),
  CONSTRAINT "analytics_settings_day_limit_check" CHECK (((day_limit > 0) AND (day_limit <= 5000))),
  CONSTRAINT "analytics_settings_id_check" CHECK ((id = 1)),
  CONSTRAINT "analytics_settings_pkey" PRIMARY KEY (id),
  CONSTRAINT "analytics_settings_profile_limit_check" CHECK (((profile_limit > 0) AND (profile_limit <= 1000)))
);

ALTER TABLE "private"."analytics_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."analytics_totals" (
  "profile_id" uuid                     NOT NULL,
  "page_views" bigint                   NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_totals_page_views_check" CHECK ((page_views >= 0)),
  CONSTRAINT "analytics_totals_pkey" PRIMARY KEY (profile_id)
);

ALTER TABLE "private"."analytics_totals"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION api.analytics_target (
  p_slug text
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select jsonb_build_object('profile_id',p.id,'day',private.analytics_day(clock_timestamp()))from public.profiles p where p.slug=p_slug and p.is_published and private.active(p.id)and exists(select 1 from private.analytics_settings where id=1 and enabled)and exists(select 1 from private.project_budget where id=1 and writes_enabled);
$function$;

CREATE OR REPLACE FUNCTION api.my_analytics()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();p public.profiles;cfg private.analytics_settings;first_at timestamptz;first_day date;today date:=private.analytics_day(now());today_count bigint;series jsonb;begin
 select * into p from public.profiles where id=actor;if not found then raise exception 'NOT_FOUND';end if;
 select * into cfg from private.analytics_settings where id=1;if not found then return jsonb_build_object('available',false);end if;
 select started_at into first_at from private.analytics_totals where profile_id=actor;first_at:=coalesce(first_at,greatest(cfg.started_at,p.created_at));first_day:=private.analytics_day(first_at);
 select coalesce(page_views,0)into today_count from private.analytics_daily where profile_id=actor and day=today;today_count:=coalesce(today_count,0);
 select jsonb_agg(jsonb_build_object('day',d::date,'views',case when d::date<first_day then null else coalesce(a.page_views,0)end)order by d)into series from generate_series((today-7)::timestamp,today::timestamp,interval '1 day')d left join private.analytics_daily a on a.profile_id=actor and a.day=d::date;
 return jsonb_build_object('available',true,'day',today,'started_at',first_at,'collecting',cfg.enabled and(select writes_enabled from private.project_budget where id=1),
 'limited',today_count>=cfg.profile_limit or(cfg.counter_day=today and cfg.accepted_count>=cfg.day_limit),
 'today',case when today<first_day then null else today_count end,'yesterday',case when today-1<first_day then null else coalesce((select page_views from private.analytics_daily where profile_id=actor and day=today-1),0)end,
 'week',(select coalesce(sum(page_views),0)from private.analytics_daily where profile_id=actor and day between today-6 and today),
 'month',(select coalesce(sum(page_views),0)from private.analytics_daily where profile_id=actor and day between today-29 and today),
 'total',coalesce((select page_views from private.analytics_totals where profile_id=actor),0),'chart',series);
end $function$;

CREATE OR REPLACE FUNCTION api.prune_analytics (
  p_actor uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$select private.prune_analytics(p_actor)$function$;

CREATE OR REPLACE FUNCTION api.record_page_view (
  p_profile_id   uuid,
  p_day          date,
  p_session_hash text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare p public.profiles;cfg private.analytics_settings;ts timestamptz;today date;daily_count bigint;begin
 if p_profile_id is null or p_day is null or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$'then raise exception 'VALIDATION_FAILED';end if;
 perform private.lock_active_account(p_profile_id);
 select * into p from public.profiles where id=p_profile_id and is_published for share;if not found then return jsonb_build_object('accepted',false);end if;
 -- One global settings/counter row bounds receipts across profiles and serializes
 -- new events without retaining per-IP or unbounded budget keys.
 select * into cfg from private.analytics_settings where id=1 for update;
 if not found or not cfg.enabled or not(select writes_enabled from private.project_budget where id=1)then return jsonb_build_object('accepted',false);end if;
 ts:=clock_timestamp();today:=private.analytics_day(ts);if p_day<>today then raise exception 'DAY_CHANGED';end if;
 if exists(select 1 from private.analytics_receipts where profile_id=p_profile_id and day=today and session_hash=p_session_hash)then return jsonb_build_object('accepted',true,'day',today,'seconds_until_next_day',ceil(extract(epoch from((today+1)::timestamp at time zone 'Asia/Seoul')-ts)));end if;
 if cfg.counter_day<>today then cfg.accepted_count:=0;update private.analytics_settings set counter_day=today,accepted_count=0 where id=1;end if;
 select page_views into daily_count from private.analytics_daily where profile_id=p_profile_id and day=today;
 if cfg.accepted_count>=cfg.day_limit or coalesce(daily_count,0)>=cfg.profile_limit then return jsonb_build_object('accepted',false);end if;
 insert into private.analytics_receipts(profile_id,day,session_hash,created_at,expires_at)values(p_profile_id,today,p_session_hash,ts,ts+interval '47 hours');
 insert into private.analytics_daily(profile_id,day,page_views,updated_at)values(p_profile_id,today,1,ts)on conflict(profile_id,day)do update set page_views=private.analytics_daily.page_views+1,updated_at=excluded.updated_at;
 insert into private.analytics_totals(profile_id,page_views,started_at,updated_at)values(p_profile_id,1,greatest(cfg.started_at,p.created_at),ts)on conflict(profile_id)do update set page_views=private.analytics_totals.page_views+1,updated_at=excluded.updated_at;
 update private.analytics_settings set accepted_count=accepted_count+1 where id=1;
 return jsonb_build_object('accepted',true,'day',today,'seconds_until_next_day',ceil(extract(epoch from((today+1)::timestamp at time zone 'Asia/Seoul')-ts)));
end $function$;

CREATE OR REPLACE FUNCTION private.analytics_day (
  p_at timestamp with time zone
)
  RETURNS date
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$select(p_at at time zone 'Asia/Seoul')::date$function$;

CREATE OR REPLACE FUNCTION private.prune_analytics (
  p_actor uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare receipt_count integer;day_count integer;begin
 with expired as(select profile_id,day,session_hash from private.analytics_receipts where(p_actor is null or profile_id=p_actor)and expires_at<=clock_timestamp()order by expires_at,profile_id,day,session_hash for update skip locked limit 500)
 delete from private.analytics_receipts r using expired e where r.profile_id=e.profile_id and r.day=e.day and r.session_hash=e.session_hash;get diagnostics receipt_count=row_count;
 with expired as(select profile_id,day from private.analytics_daily where(p_actor is null or profile_id=p_actor)and day<private.analytics_day(clock_timestamp())-364 order by day,profile_id for update skip locked limit 500)
 delete from private.analytics_daily a using expired e where a.profile_id=e.profile_id and a.day=e.day;get diagnostics day_count=row_count;
 return jsonb_build_object('receipts',receipt_count,'daily',day_count);
end $function$;

ALTER TABLE "private"."analytics_daily"
  ADD CONSTRAINT "analytics_daily_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "private"."analytics_receipts"
  ADD CONSTRAINT "analytics_receipts_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "private"."analytics_totals"
  ADD CONSTRAINT "analytics_totals_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX analytics_daily_expiry_idx ON private.analytics_daily USING btree (day, profile_id);

CREATE INDEX analytics_receipts_expiry_idx ON private.analytics_receipts USING btree (expires_at, profile_id, day, session_hash);

REVOKE ALL ON FUNCTION "api"."analytics_target"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."analytics_target"(text) TO "service_role";

REVOKE ALL ON FUNCTION "api"."my_analytics"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_analytics"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."prune_analytics"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."prune_analytics"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."record_page_view"(uuid, date, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."record_page_view"(uuid, date, text) TO "service_role";

REVOKE ALL ON FUNCTION "private"."analytics_day"(timestamp WITH time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."prune_analytics"(uuid) FROM PUBLIC;
