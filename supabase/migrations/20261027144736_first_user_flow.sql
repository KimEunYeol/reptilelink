SET local check_function_bodies = off;

CREATE SCHEMA "api";

CREATE SCHEMA "private";

CREATE TABLE "private"."account_state" (
  "user_id"     uuid                     NOT NULL,
  "status"      text                     NOT NULL DEFAULT 'pending'::text,
  "approved_at" timestamp with time zone,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "account_state_pkey" PRIMARY KEY (user_id),
  CONSTRAINT "account_state_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text, 'deleting'::text])))
);

ALTER TABLE "private"."account_state"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."animal_notes" (
  "animal_id"  uuid                     NOT NULL,
  "profile_id" uuid                     NOT NULL,
  "body"       text                     NOT NULL DEFAULT ''::text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "animal_notes_body_check" CHECK ((length(body) <= 2000)),
  CONSTRAINT "animal_notes_pkey" PRIMARY KEY (animal_id)
);

ALTER TABLE "private"."animal_notes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."consents" (
  "user_id"          uuid                     NOT NULL,
  "document_kind"    text                     NOT NULL,
  "document_version" text                     NOT NULL,
  "accepted_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "consents_document_kind_check" CHECK ((document_kind = ANY (ARRAY['terms'::text, 'privacy'::text]))),
  CONSTRAINT "consents_document_version_check" CHECK (((length(document_version) >= 1) AND (length(document_version) <= 40))),
  CONSTRAINT "consents_pkey" PRIMARY KEY (user_id, document_kind, document_version)
);

ALTER TABLE "private"."consents"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."media_assets" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "profile_id"        uuid                     NOT NULL,
  "animal_id"         uuid                     NOT NULL,
  "purpose"           text                     NOT NULL DEFAULT 'animal'::text,
  "state"             text                     NOT NULL DEFAULT 'reserved'::text,
  "reservation_bytes" bigint                   NOT NULL,
  "actual_bytes"      bigint                   NOT NULL DEFAULT 0,
  "expires_at"        timestamp with time zone DEFAULT (now() + '01:00:00'::interval),
  "verified_at"       timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "media_assets_actual_bytes_check" CHECK ((actual_bytes >= 0)),
  CONSTRAINT "media_assets_check" CHECK (((state <> 'ready'::text) OR (verified_at IS NOT NULL))),
  CONSTRAINT "media_assets_id_profile_id_key" UNIQUE (id, profile_id),
  CONSTRAINT "media_assets_pkey" PRIMARY KEY (id),
  CONSTRAINT "media_assets_purpose_check" CHECK ((purpose = 'animal'::text)),
  CONSTRAINT "media_assets_reservation_bytes_check" CHECK (((reservation_bytes >= 1) AND (reservation_bytes <= 307200))),
  CONSTRAINT "media_assets_state_check" CHECK ((state = ANY (ARRAY['reserved'::text, 'ready'::text, 'delete_pending'::text])))
);

ALTER TABLE "private"."media_assets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."media_objects" (
  "id"          uuid    NOT NULL DEFAULT gen_random_uuid(),
  "asset_id"    uuid    NOT NULL,
  "profile_id"  uuid    NOT NULL,
  "variant"     text    NOT NULL,
  "object_path" text    NOT NULL,
  "mime_type"   text    NOT NULL DEFAULT 'image/webp'::text,
  "byte_size"   bigint  NOT NULL,
  "width"       integer,
  "height"      integer,
  "sha256"      text,
  "state"       text    NOT NULL DEFAULT 'reserved'::text,
  CONSTRAINT "media_objects_asset_id_variant_key" UNIQUE (asset_id, variant),
  CONSTRAINT "media_objects_byte_size_check" CHECK ((byte_size > 0)),
  CONSTRAINT "media_objects_mime_type_check" CHECK ((mime_type = 'image/webp'::text)),
  CONSTRAINT "media_objects_object_path_key" UNIQUE (object_path),
  CONSTRAINT "media_objects_pkey" PRIMARY KEY (id),
  CONSTRAINT "media_objects_state_check" CHECK ((state = ANY (ARRAY['reserved'::text, 'stored'::text, 'delete_pending'::text]))),
  CONSTRAINT "media_objects_variant_check" CHECK ((variant = ANY (ARRAY['original_display'::text, 'thumbnail'::text])))
);

ALTER TABLE "private"."media_objects"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."mutation_receipts" (
  "actor_id"     uuid                     NOT NULL,
  "request_id"   uuid                     NOT NULL,
  "operation"    text                     NOT NULL,
  "request_hash" text                     NOT NULL,
  "result_ref"   jsonb                    NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"   timestamp with time zone NOT NULL DEFAULT (now() + '24:00:00'::interval),
  CONSTRAINT "mutation_receipts_pkey" PRIMARY KEY (actor_id, request_id)
);

ALTER TABLE "private"."mutation_receipts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."project_budget" (
  "id"                   smallint NOT NULL,
  "profile_limit"        integer  NOT NULL DEFAULT 10,
  "media_limit_bytes"    bigint   NOT NULL DEFAULT 734003200,
  "media_reserved_bytes" bigint   NOT NULL DEFAULT 0,
  "media_stored_bytes"   bigint   NOT NULL DEFAULT 0,
  "admission_open"       boolean  NOT NULL DEFAULT true,
  "writes_enabled"       boolean  NOT NULL DEFAULT true,
  CONSTRAINT "project_budget_check" CHECK (((media_reserved_bytes + media_stored_bytes) <= media_limit_bytes)),
  CONSTRAINT "project_budget_id_check" CHECK ((id = 1)),
  CONSTRAINT "project_budget_media_reserved_bytes_check" CHECK ((media_reserved_bytes >= 0)),
  CONSTRAINT "project_budget_media_stored_bytes_check" CHECK ((media_stored_bytes >= 0)),
  CONSTRAINT "project_budget_pkey" PRIMARY KEY (id),
  CONSTRAINT "project_budget_profile_limit_check" CHECK (((profile_limit >= 1) AND (profile_limit <= 10)))
);

ALTER TABLE "private"."project_budget"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."signup_allowlist" (
  "normalized_email" text                     NOT NULL,
  "expires_at"       timestamp with time zone NOT NULL,
  "revoked_at"       timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "signup_allowlist_normalized_email_check" CHECK ((normalized_email = lower(TRIM(BOTH FROM normalized_email)))),
  CONSTRAINT "signup_allowlist_pkey" PRIMARY KEY (normalized_email)
);

ALTER TABLE "private"."signup_allowlist"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."storage_usage" (
  "profile_id"     uuid   NOT NULL,
  "reserved_bytes" bigint NOT NULL DEFAULT 0,
  "stored_bytes"   bigint NOT NULL DEFAULT 0,
  "limit_bytes"    bigint NOT NULL DEFAULT 20971520,
  CONSTRAINT "storage_usage_check" CHECK (((reserved_bytes + stored_bytes) <= limit_bytes)),
  CONSTRAINT "storage_usage_limit_bytes_check" CHECK (((limit_bytes >= 1) AND (limit_bytes <= 20971520))),
  CONSTRAINT "storage_usage_pkey" PRIMARY KEY (profile_id),
  CONSTRAINT "storage_usage_reserved_bytes_check" CHECK ((reserved_bytes >= 0)),
  CONSTRAINT "storage_usage_stored_bytes_check" CHECK ((stored_bytes >= 0))
);

ALTER TABLE "private"."storage_usage"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."animal_photos" (
  "id"         uuid    NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" uuid    NOT NULL,
  "animal_id"  uuid    NOT NULL,
  "asset_id"   uuid    NOT NULL,
  "sort_order" integer NOT NULL,
  CONSTRAINT "animal_photos_animal_id_sort_order_key" UNIQUE (animal_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "animal_photos_asset_id_key" UNIQUE (asset_id),
  CONSTRAINT "animal_photos_pkey" PRIMARY KEY (id),
  CONSTRAINT "animal_photos_sort_order_check" CHECK (((sort_order >= 0) AND (sort_order <= 2)))
);

ALTER TABLE "public"."animal_photos"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."animals" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "profile_id"     uuid                     NOT NULL,
  "name"           text                     NOT NULL,
  "species"        text                     NOT NULL,
  "morph"          text                     NOT NULL DEFAULT ''::text,
  "sex"            text                     NOT NULL DEFAULT 'unknown'::text,
  "description"    text                     NOT NULL DEFAULT ''::text,
  "listing_status" text                     NOT NULL DEFAULT 'not_listed'::text,
  "is_public"      boolean                  NOT NULL DEFAULT false,
  "show_growth"    boolean                  NOT NULL DEFAULT false,
  "sort_order"     integer                  NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "animals_description_check" CHECK ((length(description) <= 500)),
  CONSTRAINT "animals_id_profile_id_key" UNIQUE (id, profile_id),
  CONSTRAINT "animals_listing_status_check" CHECK ((listing_status = ANY (ARRAY['not_listed'::text, 'available'::text, 'reserved'::text, 'rehomed'::text]))),
  CONSTRAINT "animals_morph_check" CHECK ((length(morph) <= 120)),
  CONSTRAINT "animals_name_check" CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 40))),
  CONSTRAINT "animals_pkey" PRIMARY KEY (id),
  CONSTRAINT "animals_profile_id_sort_order_key" UNIQUE (profile_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "animals_sex_check" CHECK ((sex = ANY (ARRAY['unknown'::text, 'male'::text, 'female'::text]))),
  CONSTRAINT "animals_sort_order_check" CHECK ((sort_order >= 0)),
  CONSTRAINT "animals_species_check" CHECK (((length(TRIM(BOTH FROM species)) >= 1) AND (length(TRIM(BOTH FROM species)) <= 80)))
);

ALTER TABLE "public"."animals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"                 uuid                     NOT NULL,
  "slug"               text                     NOT NULL,
  "display_name"       text                     NOT NULL,
  "tagline"            text                     NOT NULL DEFAULT ''::text,
  "bio"                text                     NOT NULL DEFAULT ''::text,
  "theme_token"        text                     NOT NULL DEFAULT 'green'::text,
  "is_published"       boolean                  NOT NULL DEFAULT false,
  "first_published_at" timestamp with time zone,
  "revision"           bigint                   NOT NULL DEFAULT 0,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profiles_bio_check" CHECK ((length(bio) <= 300)),
  CONSTRAINT "profiles_display_name_check" CHECK (((length(TRIM(BOTH FROM display_name)) >= 1) AND (length(TRIM(BOTH FROM display_name)) <= 40))),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "profiles_slug_check" CHECK ((slug ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$'::text)),
  CONSTRAINT "profiles_slug_key" UNIQUE (slug),
  CONSTRAINT "profiles_tagline_check" CHECK ((length(tagline) <= 80)),
  CONSTRAINT "profiles_theme_token_check" CHECK ((theme_token = ANY (ARRAY['green'::text, 'mint'::text, 'forest'::text])))
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION api.attach_photo (
  p_asset_id uuid,
  p_expected bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.lock_profile(p_expected); a private.media_assets;
begin
  perform private.check_writes();
  select * into a from private.media_assets where id=p_asset_id and profile_id=actor and state='ready' and expires_at>now() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.animal_photos where asset_id=a.id) then raise exception 'ALREADY_ATTACHED'; end if;
  insert into public.animal_photos(profile_id,animal_id,asset_id,sort_order) values(actor,a.animal_id,a.id,coalesce((select max(sort_order)+1 from public.animal_photos where animal_id=a.animal_id),0));
  update private.media_assets set expires_at=null where id=a.id;
  return jsonb_build_object('revision',private.bump(actor));
end $function$;

CREATE OR REPLACE FUNCTION api.before_user_created (
  event jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if exists(select 1 from private.signup_allowlist where normalized_email=lower(trim(event->'user'->>'email')) and revoked_at is null and expires_at>now()) then
    return '{}'::jsonb;
  end if;
  return '{"error":{"http_code":403,"message":"초대된 계정만 가입할 수 있습니다."}}'::jsonb;
end $function$;

CREATE OR REPLACE FUNCTION api.cleanup_manifest (
  p_asset_id uuid,
  p_actor    uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare a private.media_assets;
begin
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  select * into a from private.media_assets where id=p_asset_id and profile_id=p_actor for update;
  if not found or exists(select 1 from public.animal_photos where asset_id=p_asset_id) then raise exception 'NOT_FOUND'; end if;
  update private.media_assets set state='delete_pending' where id=p_asset_id;
  return (select jsonb_agg(object_path) from private.media_objects where asset_id=p_asset_id);
end $function$;

CREATE OR REPLACE FUNCTION api.complete_upload (
  p_asset_id uuid,
  p_actor    uuid,
  p_objects  jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare a private.media_assets; o record; total bigint:=0;
begin
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  select * into a from private.media_assets where id=p_asset_id and profile_id=p_actor for update;
  if not found or not private.active(p_actor) then raise exception 'NOT_FOUND'; end if;
  if a.state='ready' then return; end if;
  if a.state<>'reserved' or a.expires_at<=now() then raise exception 'UPLOAD_EXPIRED'; end if;
  if jsonb_array_length(p_objects)<>2 then raise exception 'VALIDATION_FAILED'; end if;
  for o in select * from jsonb_to_recordset(p_objects) as x(variant text,bytes bigint,width integer,height integer,sha256 text) loop
    if o.variant is null or o.bytes is null or o.width is null or o.height is null or o.sha256 is null
       or o.variant not in ('original_display','thumbnail') or o.bytes<=0
       or o.bytes>(case when o.variant='thumbnail' then 81920 else 225280 end)
       or o.width<=0 or o.height<=0
       or greatest(o.width,o.height)>(case when o.variant='thumbnail' then 480 else 1280 end)
       or o.sha256 !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_FAILED'; end if;
    update private.media_objects set byte_size=o.bytes,width=o.width,height=o.height,sha256=o.sha256,state='stored' where asset_id=a.id and variant=o.variant and state='reserved';
    if not found then raise exception 'VALIDATION_FAILED'; end if;
    total:=total+o.bytes;
  end loop;
  update private.media_assets set state='ready',actual_bytes=total,verified_at=now() where id=a.id;
  update private.storage_usage set reserved_bytes=reserved_bytes-a.reservation_bytes,stored_bytes=stored_bytes+total where profile_id=p_actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes-a.reservation_bytes,media_stored_bytes=media_stored_bytes+total where id=1;
end $function$;

CREATE OR REPLACE FUNCTION api.create_animal (
  p_data       jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid; animal_id uuid; result jsonb; old_receipt private.mutation_receipts;
begin
  perform private.check_writes();
  actor:=private.actor();
  -- Serializing by profile also serializes receipt checks and item quota checks.
  perform 1 from public.profiles where id=actor for update;
  select * into old_receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
  if found then
    if old_receipt.operation<>'create_animal' or old_receipt.request_hash<>md5(p_data::text) then raise exception 'REQUEST_CONFLICT'; end if;
    return old_receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if (select count(*) from public.animals where profile_id=actor)>=20 then raise exception 'QUOTA_EXCEEDED'; end if;
  insert into public.animals(profile_id,name,species,morph,sex,description,is_public,listing_status,sort_order)
  values(actor,trim(p_data->>'name'),trim(p_data->>'species'),coalesce(p_data->>'morph',''),coalesce(p_data->>'sex','unknown'),coalesce(p_data->>'description',''),coalesce((p_data->>'is_public')::boolean,false),coalesce(p_data->>'listing_status','not_listed'),coalesce((select max(sort_order)+1 from public.animals where profile_id=actor),0))
  returning id into animal_id;
  result:=jsonb_build_object('id',animal_id,'revision',private.bump(actor));
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'create_animal',md5(p_data::text),result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION api.expired_uploads()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'profile_id',m.profile_id)),'[]'::jsonb) from
 (select id,profile_id from private.media_assets where state='delete_pending' or expires_at<now() order by created_at limit 50) m;
$function$;

CREATE OR REPLACE FUNCTION api.finish_cleanup (
  p_asset_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare a private.media_assets;
begin
  perform 1 from private.project_budget where id=1 for update;
  select * into a from private.media_assets where id=p_asset_id and state='delete_pending';
  if not found then return; end if;
  perform 1 from private.storage_usage where profile_id=a.profile_id for update;
  if exists(select 1 from storage.objects where bucket_id='animal-media' and name in (select object_path from private.media_objects where asset_id=a.id)) then raise exception 'FILES_REMAIN'; end if;
  if a.verified_at is null then
    update private.storage_usage set reserved_bytes=reserved_bytes-a.reservation_bytes where profile_id=a.profile_id;
    update private.project_budget set media_reserved_bytes=media_reserved_bytes-a.reservation_bytes where id=1;
  else
    update private.storage_usage set stored_bytes=stored_bytes-a.actual_bytes where profile_id=a.profile_id;
    update private.project_budget set media_stored_bytes=media_stored_bytes-a.actual_bytes where id=1;
  end if;
  delete from private.media_assets where id=a.id;
end $function$;

CREATE OR REPLACE FUNCTION api.media_access (
  p_asset_id uuid,
  p_variant  text,
  p_actor    uuid DEFAULT NULL::uuid
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select o.object_path from private.media_objects o join private.media_assets m on m.id=o.asset_id
 join public.animal_photos ph on ph.asset_id=m.id join public.animals a on a.id=ph.animal_id join public.profiles p on p.id=a.profile_id
 where m.id=p_asset_id and o.variant=p_variant and m.state='ready' and o.state='stored' and private.active(p.id)
 and (p.id=p_actor or (p.is_published and a.is_public));
$function$;

CREATE OR REPLACE FUNCTION api.my_dashboard()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  return jsonb_build_object(
    'account_status',(select status from private.account_state where user_id=actor),
    'profile',(select to_jsonb(p) from public.profiles p where id=actor and private.active(actor)),
    'animals',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where profile_id=actor and private.active(actor)),'[]'::jsonb),
    'usage',(select jsonb_build_object('stored_bytes',stored_bytes,'reserved_bytes',reserved_bytes,'limit_bytes',limit_bytes) from private.storage_usage where profile_id=actor)
  );
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
  return jsonb_build_object('profile',jsonb_build_object('slug',p.slug,'display_name',p.display_name,'bio',p.bio,'tagline',p.tagline,'theme_token',p.theme_token),
    'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'species',a.species,'morph',a.morph,'sex',a.sex,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.reserve_upload (
  p_animal_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor(); asset uuid:=gen_random_uuid(); budget bigint:=307200; manifest jsonb;
begin
  perform private.check_writes();
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  perform 1 from public.profiles where id=actor for update;
  if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.media_assets where profile_id=actor and state='reserved')>=2 then raise exception 'QUOTA_EXCEEDED'; end if;
  if (select count(*) from private.media_assets where animal_id=p_animal_id and state<>'delete_pending')>=3 then raise exception 'QUOTA_EXCEEDED'; end if;
  if exists(select 1 from private.storage_usage where profile_id=actor and reserved_bytes+stored_bytes+budget>limit_bytes) or exists(select 1 from private.project_budget where id=1 and media_reserved_bytes+media_stored_bytes+budget>media_limit_bytes) then raise exception 'QUOTA_EXCEEDED'; end if;
  insert into private.media_assets(id,profile_id,animal_id,reservation_bytes) values(asset,actor,p_animal_id,budget);
  insert into private.media_objects(asset_id,profile_id,variant,object_path,byte_size)
    values(asset,actor,'original_display',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',225280),
          (asset,actor,'thumbnail',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',81920);
  update private.storage_usage set reserved_bytes=reserved_bytes+budget where profile_id=actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes+budget where id=1;
  select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) into manifest from private.media_objects where asset_id=asset;
  return jsonb_build_object('asset_id',asset,'objects',manifest);
end $function$;

CREATE OR REPLACE FUNCTION api.save_profile (
  p_slug         text,
  p_name         text,
  p_bio          text,
  p_expected     bigint,
  p_publish      boolean,
  p_accept_terms boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid := private.actor(); current_profile public.profiles; new_revision bigint;
begin
  perform private.check_writes();
  perform 1 from private.project_budget where id=1 for update;
  select * into current_profile from public.profiles where id=actor for update;
  if found then
    if current_profile.revision is distinct from p_expected then raise exception 'VERSION_CONFLICT'; end if;
    if current_profile.first_published_at is not null and current_profile.slug<>lower(trim(p_slug)) then raise exception 'SLUG_LOCKED'; end if;
  else
    if not (select admission_open from private.project_budget where id=1) or (select count(*) from public.profiles)>=(select profile_limit from private.project_budget where id=1) then raise exception 'QUOTA_EXCEEDED'; end if;
    if p_accept_terms is distinct from true then raise exception 'CONSENT_REQUIRED'; end if;
    insert into private.consents(user_id,document_kind,document_version) values(actor,'terms','local-preview-v1'),(actor,'privacy','local-preview-v1') on conflict do nothing;
  end if;
  if lower(trim(p_slug)) in ('admin','api','auth','dashboard','help','terms','privacy','support','www') then raise exception 'SLUG_RESERVED'; end if;
  if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
  insert into public.profiles(id,slug,display_name,bio,is_published,first_published_at,revision)
  values(actor,lower(trim(p_slug)),trim(p_name),trim(p_bio),p_publish,case when p_publish then now() end,1)
  on conflict(id) do update set slug=excluded.slug,display_name=excluded.display_name,bio=excluded.bio,
    is_published=excluded.is_published,first_published_at=coalesce(profiles.first_published_at,excluded.first_published_at),revision=profiles.revision+1,updated_at=now()
  returning revision into new_revision;
  insert into private.storage_usage(profile_id) values(actor) on conflict do nothing;
  return jsonb_build_object('revision',new_revision);
end $function$;

CREATE OR REPLACE FUNCTION api.set_animal_public (
  p_animal_id uuid,
  p_public    boolean,
  p_expected  bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid;
begin
  if p_public then perform private.check_writes(); end if;
  actor:=private.lock_profile(p_expected);
  update public.animals set is_public=p_public,updated_at=now() where id=p_animal_id and profile_id=actor;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('revision',private.bump(actor));
end $function$;

CREATE OR REPLACE FUNCTION api.set_profile_public (
  p_public   boolean,
  p_expected bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid;
begin
  if p_public then perform private.check_writes(); end if;
  actor:=private.lock_profile(p_expected);
  update public.profiles set is_published=p_public,first_published_at=case when p_public then coalesce(first_published_at,now()) else first_published_at end,updated_at=now() where id=actor;
  return jsonb_build_object('revision',private.bump(actor));
end $function$;

CREATE OR REPLACE FUNCTION api.upload_manifest (
  p_asset_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();
begin
  if not exists(select 1 from private.media_assets where id=p_asset_id and profile_id=actor and state='reserved' and expires_at>now()) then raise exception 'NOT_FOUND'; end if;
  return (select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) from private.media_objects where asset_id=p_asset_id);
end $function$;

CREATE OR REPLACE FUNCTION private.active (
  p_user uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists(select 1 from private.account_state where user_id=p_user and status='active');
$function$;

CREATE OR REPLACE FUNCTION private.actor()
  RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not private.active(actor) then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  return actor;
end $function$;

CREATE OR REPLACE FUNCTION private.bump (
  p_user uuid
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result bigint;
begin
  update public.profiles set revision=revision+1,updated_at=now() where id=p_user returning revision into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION private.check_writes()
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not (select writes_enabled from private.project_budget where id=1) then raise exception 'SERVICE_UNAVAILABLE'; end if;
end $function$;

CREATE OR REPLACE FUNCTION private.lock_profile (
  p_expected bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid := private.actor(); current_revision bigint;
begin
  select revision into current_revision from public.profiles where id=actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if current_revision is distinct from p_expected then raise exception 'VERSION_CONFLICT'; end if;
  return actor;
end $function$;

CREATE OR REPLACE FUNCTION private.new_account()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into private.account_state(user_id) values(new.id);
  return new;
end $function$;

ALTER TABLE "private"."account_state"
  ADD CONSTRAINT "account_state_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "private"."consents"
  ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "private"."media_objects"
  ADD CONSTRAINT "media_objects_asset_id_profile_id_fkey" FOREIGN KEY (asset_id, profile_id) REFERENCES private.media_assets(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "private"."mutation_receipts"
  ADD CONSTRAINT "mutation_receipts_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."animal_photos"
  ADD CONSTRAINT "animal_photos_asset_id_profile_id_fkey" FOREIGN KEY (asset_id, profile_id) REFERENCES private.media_assets(id, profile_id) ON DELETE RESTRICT;

ALTER TABLE "private"."animal_notes"
  ADD CONSTRAINT "animal_notes_animal_id_profile_id_fkey" FOREIGN KEY (animal_id, profile_id) REFERENCES public.animals(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "private"."media_assets"
  ADD CONSTRAINT "media_assets_animal_id_profile_id_fkey" FOREIGN KEY (animal_id, profile_id) REFERENCES public.animals(id, profile_id) ON DELETE RESTRICT;

ALTER TABLE "public"."animal_photos"
  ADD CONSTRAINT "animal_photos_animal_id_profile_id_fkey" FOREIGN KEY (animal_id, profile_id) REFERENCES public.animals(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "private"."media_assets"
  ADD CONSTRAINT "media_assets_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "private"."storage_usage"
  ADD CONSTRAINT "storage_usage_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."animals"
  ADD CONSTRAINT "animals_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX animal_notes_owner_idx ON private.animal_notes USING btree (profile_id);

CREATE INDEX media_assets_animal_idx ON private.media_assets USING btree (animal_id);

CREATE INDEX media_assets_expiry_idx ON private.media_assets USING btree (state, expires_at);

CREATE INDEX media_assets_owner_idx ON private.media_assets USING btree (profile_id, state);

CREATE INDEX media_objects_owner_idx ON private.media_objects USING btree (profile_id);

CREATE INDEX mutation_receipts_expiry_idx ON private.mutation_receipts USING btree (expires_at);

CREATE INDEX animal_photos_owner_idx ON public.animal_photos USING btree (profile_id);

CREATE INDEX animals_owner_order_idx ON public.animals USING btree (profile_id, sort_order, id);

CREATE TRIGGER reptilelink_account_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.new_account();

CREATE POLICY "hook_allowlist_read" ON "private"."signup_allowlist"
  FOR SELECT
  TO "supabase_auth_admin"
  USING (true);

CREATE POLICY "photo_read" ON "public"."animal_photos"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.animals a
  WHERE ((a.id = animal_photos.animal_id) AND (a.profile_id = animal_photos.profile_id)))));

CREATE POLICY "animal_read" ON "public"."animals"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((private.active(profile_id) AND ((profile_id = ( SELECT auth.uid() AS uid)) OR (is_public AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = animals.profile_id) AND p.is_published)))))));

CREATE POLICY "profile_read" ON "public"."profiles"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((private.active(id) AND ((id = ( SELECT auth.uid() AS uid)) OR is_published)));

REVOKE ALL ON FUNCTION "api"."attach_photo"(uuid, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."attach_photo"(uuid, bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."before_user_created"(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."before_user_created"(jsonb) TO "supabase_auth_admin";

REVOKE ALL ON FUNCTION "api"."cleanup_manifest"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."cleanup_manifest"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."complete_upload"(uuid, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."complete_upload"(uuid, uuid, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "api"."create_animal"(jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."create_animal"(jsonb, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."expired_uploads"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."expired_uploads"() TO "service_role";

REVOKE ALL ON FUNCTION "api"."finish_cleanup"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."finish_cleanup"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."media_access"(uuid, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."media_access"(uuid, text, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."my_dashboard"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_dashboard"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."public_page"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."public_page"(text) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "api"."reserve_upload"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."reserve_upload"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."save_profile"(text, text, text, bigint, boolean, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."save_profile"(text, text, text, bigint, boolean, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."set_animal_public"(uuid, boolean, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."set_animal_public"(uuid, boolean, bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."set_profile_public"(boolean, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."set_profile_public"(boolean, bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."upload_manifest"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."upload_manifest"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."active"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."active"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "private"."actor"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."bump"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."check_writes"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."lock_profile"(bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."new_account"() FROM PUBLIC;

GRANT USAGE ON SCHEMA "api" TO "anon", "authenticated", "service_role", "supabase_auth_admin";

GRANT USAGE ON SCHEMA "private" TO "anon", "authenticated", "supabase_auth_admin";

GRANT SELECT ON TABLE "private"."signup_allowlist" TO "supabase_auth_admin";

REVOKE ALL ON TABLE "public"."animal_photos" FROM "anon";

GRANT SELECT ON TABLE "public"."animal_photos" TO "anon";

REVOKE ALL ON TABLE "public"."animal_photos" FROM "authenticated";

GRANT SELECT ON TABLE "public"."animal_photos" TO "authenticated";

REVOKE ALL ON TABLE "public"."animal_photos" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."animal_photos" TO "postgres";

REVOKE ALL ON TABLE "public"."animal_photos" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."animal_photos" TO "service_role";

REVOKE ALL ON TABLE "public"."animals" FROM "anon";

GRANT SELECT ON TABLE "public"."animals" TO "anon";

REVOKE ALL ON TABLE "public"."animals" FROM "authenticated";

GRANT SELECT ON TABLE "public"."animals" TO "authenticated";

REVOKE ALL ON TABLE "public"."animals" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."animals" TO "postgres";

REVOKE ALL ON TABLE "public"."animals" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."animals" TO "service_role";

REVOKE ALL ON TABLE "public"."profiles" FROM "anon";

GRANT SELECT ON TABLE "public"."profiles" TO "anon";

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres";

REVOKE ALL ON TABLE "public"."profiles" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profiles" TO "service_role";


-- Application data required after schema creation.
insert into private.project_budget(id) values(1) on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('animal-media','animal-media',false,225280,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No browser table policy: only server-issued create-only signed uploads and signed reads.
-- Storage API is the only code allowed to remove objects; never DELETE storage.objects directly.
