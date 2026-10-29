-- Phase A: reviewed local schema source. Apply locally, verify, then generate a CLI migration.
create schema if not exists private;
create schema if not exists api;
revoke all on schema private from public, anon, authenticated;
grant usage on schema api to anon, authenticated, service_role, supabase_auth_admin;
alter default privileges in schema api revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

create table private.account_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','active','suspended','deleting')),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create table private.signup_allowlist (
  normalized_email text primary key check (normalized_email = lower(trim(normalized_email))),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table private.consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_kind text not null check (document_kind in ('terms','privacy')),
  document_version text not null check (length(document_version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  primary key(user_id, document_kind, document_version)
);
create table private.project_budget (
  id smallint primary key check(id=1),
  profile_limit integer not null default 10 check(profile_limit between 1 and 10),
  media_limit_bytes bigint not null default 734003200,
  media_reserved_bytes bigint not null default 0 check(media_reserved_bytes >= 0),
  media_stored_bytes bigint not null default 0 check(media_stored_bytes >= 0),
  admission_open boolean not null default true,
  writes_enabled boolean not null default true,
  check(media_reserved_bytes + media_stored_bytes <= media_limit_bytes)
);
insert into private.project_budget(id) values(1);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  slug text not null unique check(slug ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$'),
  display_name text not null check(length(trim(display_name)) between 1 and 40),
  tagline text not null default '' check(length(tagline) <= 80),
  bio text not null default '' check(length(bio) <= 300),
  theme_token text not null default 'green' check(theme_token in ('green','mint','forest')),
  is_published boolean not null default false,
  first_published_at timestamptz,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.animals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 40),
  species text not null check(length(trim(species)) between 1 and 80),
  morph text not null default '' check(length(morph) <= 120),
  sex text not null default 'unknown' check(sex in ('unknown','male','female')),
  description text not null default '' check(length(description) <= 500),
  listing_status text not null default 'not_listed' check(listing_status in ('not_listed','available','reserved','rehomed')),
  is_public boolean not null default false,
  show_growth boolean not null default false,
  sort_order integer not null check(sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, profile_id),
  unique(profile_id, sort_order) deferrable initially deferred
);
create index animals_owner_order_idx on public.animals(profile_id,sort_order,id);
create table private.animal_notes (
  animal_id uuid primary key,
  profile_id uuid not null,
  body text not null default '' check(length(body)<=2000),
  updated_at timestamptz not null default now(),
  foreign key(animal_id,profile_id) references public.animals(id,profile_id) on delete cascade
);
create index animal_notes_owner_idx on private.animal_notes(profile_id);
create table private.storage_usage (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  reserved_bytes bigint not null default 0 check(reserved_bytes >= 0),
  stored_bytes bigint not null default 0 check(stored_bytes >= 0),
  limit_bytes bigint not null default 20971520 check(limit_bytes between 1 and 20971520),
  check(reserved_bytes + stored_bytes <= limit_bytes)
);
create table private.media_assets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  animal_id uuid not null,
  purpose text not null default 'animal' check(purpose='animal'),
  state text not null default 'reserved' check(state in ('reserved','ready','delete_pending')),
  reservation_bytes bigint not null check(reservation_bytes between 1 and 307200),
  actual_bytes bigint not null default 0 check(actual_bytes>=0),
  expires_at timestamptz default now() + interval '1 hour',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id,profile_id),
  foreign key(animal_id,profile_id) references public.animals(id,profile_id) on delete restrict,
  check(state <> 'ready' or verified_at is not null)
);
create index media_assets_owner_idx on private.media_assets(profile_id,state);
create index media_assets_animal_idx on private.media_assets(animal_id);
create index media_assets_expiry_idx on private.media_assets(state,expires_at);
create table private.media_objects (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  profile_id uuid not null,
  variant text not null check(variant in ('original_display','thumbnail')),
  object_path text not null unique,
  mime_type text not null default 'image/webp' check(mime_type='image/webp'),
  byte_size bigint not null check(byte_size>0),
  width integer,
  height integer,
  sha256 text,
  state text not null default 'reserved' check(state in ('reserved','stored','delete_pending')),
  unique(asset_id,variant),
  foreign key(asset_id,profile_id) references private.media_assets(id,profile_id) on delete cascade
);
create index media_objects_owner_idx on private.media_objects(profile_id);
create table public.animal_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  animal_id uuid not null,
  asset_id uuid not null unique,
  sort_order integer not null check(sort_order between 0 and 2),
  foreign key(animal_id,profile_id) references public.animals(id,profile_id) on delete cascade,
  foreign key(asset_id,profile_id) references private.media_assets(id,profile_id) on delete restrict,
  unique(animal_id,sort_order) deferrable initially deferred
);
create index animal_photos_owner_idx on public.animal_photos(profile_id);
create table private.mutation_receipts (
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  operation text not null,
  request_hash text not null,
  result_ref jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  primary key(actor_id,request_id)
);
create index mutation_receipts_expiry_idx on private.mutation_receipts(expires_at);

create function private.new_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.account_state(user_id) values(new.id);
  return new;
end $$;
create trigger reptilelink_account_created after insert on auth.users for each row execute function private.new_account();

create function private.active(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.account_state where user_id=p_user and status='active');
$$;
create function private.actor() returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not private.active(actor) then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  return actor;
end $$;

create function private.lock_profile(p_expected bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := private.actor(); current_revision bigint;
begin
  select revision into current_revision from public.profiles where id=actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if current_revision is distinct from p_expected then raise exception 'VERSION_CONFLICT'; end if;
  return actor;
end $$;
create function private.bump(p_user uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare result bigint;
begin
  update public.profiles set revision=revision+1,updated_at=now() where id=p_user returning revision into result;
  return result;
end $$;
create function private.check_writes() returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not (select writes_enabled from private.project_budget where id=1) then raise exception 'SERVICE_UNAVAILABLE'; end if;
end $$;

-- Read policies are a second boundary. Clients cannot mutate tables directly.
alter table public.profiles enable row level security;
alter table public.animals enable row level security;
alter table public.animal_photos enable row level security;
create policy profile_read on public.profiles for select to anon,authenticated
  using(private.active(id) and (id=(select auth.uid()) or is_published));
create policy animal_read on public.animals for select to anon,authenticated
  using(private.active(profile_id) and (profile_id=(select auth.uid()) or (is_public and exists(select 1 from public.profiles p where p.id=profile_id and p.is_published))));
create policy photo_read on public.animal_photos for select to anon,authenticated
  using(exists(select 1 from public.animals a where a.id=animal_id and a.profile_id=animal_photos.profile_id));
grant usage on schema private to anon,authenticated;
grant execute on function private.active(uuid) to anon,authenticated;
revoke all on all tables in schema public from anon,authenticated;
grant select on public.profiles,public.animals,public.animal_photos to anon,authenticated;
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='private' loop
    execute format('alter table private.%I enable row level security',t.tablename);
  end loop;
end $$;

create function api.before_user_created(event jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
  if exists(select 1 from private.signup_allowlist where normalized_email=lower(trim(event->'user'->>'email')) and revoked_at is null and expires_at>now()) then
    return '{}'::jsonb;
  end if;
  return '{"error":{"http_code":403,"message":"초대된 계정만 가입할 수 있습니다."}}'::jsonb;
end $$;
grant usage on schema private to supabase_auth_admin;
grant select on private.signup_allowlist to supabase_auth_admin;
create policy hook_allowlist_read on private.signup_allowlist for select to supabase_auth_admin using(true);
grant execute on function api.before_user_created(jsonb) to supabase_auth_admin;

create function api.my_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  return jsonb_build_object(
    'account_status',(select status from private.account_state where user_id=actor),
    'profile',(select to_jsonb(p) from public.profiles p where id=actor and private.active(actor)),
    'animals',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where profile_id=actor and private.active(actor)),'[]'::jsonb),
    'usage',(select jsonb_build_object('stored_bytes',stored_bytes,'reserved_bytes',reserved_bytes,'limit_bytes',limit_bytes) from private.storage_usage where profile_id=actor)
  );
end $$;
grant execute on function api.my_dashboard() to authenticated;

create function api.save_profile(p_slug text,p_name text,p_bio text,p_expected bigint,p_publish boolean,p_accept_terms boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
grant execute on function api.save_profile(text,text,text,bigint,boolean,boolean) to authenticated;

create function api.create_animal(p_data jsonb,p_expected bigint,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
grant execute on function api.create_animal(jsonb,bigint,uuid) to authenticated;

create function api.set_animal_public(p_animal_id uuid,p_public boolean,p_expected bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  if p_public then perform private.check_writes(); end if;
  actor:=private.lock_profile(p_expected);
  update public.animals set is_public=p_public,updated_at=now() where id=p_animal_id and profile_id=actor;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('revision',private.bump(actor));
end $$;
grant execute on function api.set_animal_public(uuid,boolean,bigint) to authenticated;

create function api.public_page(p_slug text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where slug=p_slug and is_published;
  if not found then return null; end if;
  return jsonb_build_object('profile',jsonb_build_object('slug',p.slug,'display_name',p.display_name,'bio',p.bio,'tagline',p.tagline,'theme_token',p.theme_token),
    'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'species',a.species,'morph',a.morph,'sex',a.sex,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public),'[]'::jsonb));
end $$;
grant execute on function api.public_page(text) to anon,authenticated;

create function api.reserve_upload(p_animal_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
grant execute on function api.reserve_upload(uuid) to authenticated;

create function api.upload_manifest(p_asset_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.actor();
begin
  if not exists(select 1 from private.media_assets where id=p_asset_id and profile_id=actor and state='reserved' and expires_at>now()) then raise exception 'NOT_FOUND'; end if;
  return (select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) from private.media_objects where asset_id=p_asset_id);
end $$;
grant execute on function api.upload_manifest(uuid) to authenticated;

create function api.complete_upload(p_asset_id uuid,p_actor uuid,p_objects jsonb) returns void language plpgsql security definer set search_path='' as $$
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
end $$;
grant execute on function api.complete_upload(uuid,uuid,jsonb) to service_role;

create function api.attach_photo(p_asset_id uuid,p_expected bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.lock_profile(p_expected); a private.media_assets;
begin
  perform private.check_writes();
  select * into a from private.media_assets where id=p_asset_id and profile_id=actor and state='ready' and expires_at>now() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.animal_photos where asset_id=a.id) then raise exception 'ALREADY_ATTACHED'; end if;
  insert into public.animal_photos(profile_id,animal_id,asset_id,sort_order) values(actor,a.animal_id,a.id,coalesce((select max(sort_order)+1 from public.animal_photos where animal_id=a.animal_id),0));
  update private.media_assets set expires_at=null where id=a.id;
  return jsonb_build_object('revision',private.bump(actor));
end $$;
grant execute on function api.attach_photo(uuid,bigint) to authenticated;

create function api.media_access(p_asset_id uuid,p_variant text,p_actor uuid default null) returns text language sql stable security definer set search_path='' as $$
 select o.object_path from private.media_objects o join private.media_assets m on m.id=o.asset_id
 join public.animal_photos ph on ph.asset_id=m.id join public.animals a on a.id=ph.animal_id join public.profiles p on p.id=a.profile_id
 where m.id=p_asset_id and o.variant=p_variant and m.state='ready' and o.state='stored' and private.active(p.id)
 and (p.id=p_actor or (p.is_published and a.is_public));
$$;
grant execute on function api.media_access(uuid,text,uuid) to service_role;

-- New functions are opt-in; helpers remain unreachable from the REST schema.
create function api.set_profile_public(p_public boolean,p_expected bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  if p_public then perform private.check_writes(); end if;
  actor:=private.lock_profile(p_expected);
  update public.profiles set is_published=p_public,first_published_at=case when p_public then coalesce(first_published_at,now()) else first_published_at end,updated_at=now() where id=actor;
  return jsonb_build_object('revision',private.bump(actor));
end $$;
grant execute on function api.set_profile_public(boolean,bigint) to authenticated;

create function api.cleanup_manifest(p_asset_id uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.media_assets;
begin
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  select * into a from private.media_assets where id=p_asset_id and profile_id=p_actor for update;
  if not found or exists(select 1 from public.animal_photos where asset_id=p_asset_id) then raise exception 'NOT_FOUND'; end if;
  update private.media_assets set state='delete_pending' where id=p_asset_id;
  return (select jsonb_agg(object_path) from private.media_objects where asset_id=p_asset_id);
end $$;
grant execute on function api.cleanup_manifest(uuid,uuid) to service_role;

create function api.finish_cleanup(p_asset_id uuid) returns void language plpgsql security definer set search_path='' as $$
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
end $$;
grant execute on function api.finish_cleanup(uuid) to service_role;

create function api.expired_uploads() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'profile_id',m.profile_id)),'[]'::jsonb) from
 (select id,profile_id from private.media_assets where state='delete_pending' or expires_at<now() order by created_at limit 50) m;
$$;
grant execute on function api.expired_uploads() to service_role;

revoke all on all functions in schema private from public;
revoke all on all functions in schema api from public;
revoke all on all tables in schema private from anon,authenticated;

-- Issue #3: additive general-field editing; review snapshot only, never replay this file on a migrated DB.
-- Additive only: existing animals keep a NULL birthday and all photo/public settings.
alter table public.animals add column birth_date date;

create function private.validate_animal_birth_date() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.birth_date is not null and
    (not isfinite(new.birth_date) or new.birth_date < date '0001-01-01'
     or new.birth_date > (statement_timestamp() at time zone 'Asia/Seoul')::date) then
    raise exception 'VALIDATION_FAILED';
  end if;
  return new;
end $$;
revoke all on function private.validate_animal_birth_date() from public, anon, authenticated;
create trigger animal_birth_date_valid before insert or update of birth_date on public.animals
for each row execute function private.validate_animal_birth_date();

create function api.update_animal(p_animal_id uuid, p_data jsonb, p_expected bigint, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  receipt private.mutation_receipts;
  request_hash text;
  result jsonb;
  field text;
  animal_name text;
  animal_species text;
  animal_morph text;
  animal_description text;
  birthday date;
begin
  perform private.check_writes();
  actor := private.actor();
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  -- Match existing owner commands: serialize profile, receipts and revision together.
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id = actor
      and document_version = 'local-preview-v1' and document_kind in ('terms','privacy')) <> 2 then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if not exists(select 1 from public.animals where id = p_animal_id and profile_id = actor) then
    raise exception 'NOT_FOUND';
  end if;
  request_hash := md5(jsonb_build_object('animal_id', p_animal_id, 'data', p_data)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'update_animal' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
  if not (p_data ?& array['name','species','morph','sex','birth_date','description','listing_status'])
     or (p_data - array['name','species','morph','sex','birth_date','description','listing_status']) <> '{}'::jsonb then
    raise exception 'VALIDATION_FAILED';
  end if;
  foreach field in array array['name','species','morph','sex','description','listing_status'] loop
    if jsonb_typeof(p_data -> field) is distinct from 'string' then raise exception 'VALIDATION_FAILED'; end if;
  end loop;
  animal_name := regexp_replace(p_data->>'name', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  animal_species := regexp_replace(p_data->>'species', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  animal_morph := regexp_replace(p_data->>'morph', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  animal_description := regexp_replace(p_data->>'description', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if length(animal_name) not between 1 and 40 or length(animal_species) not between 1 and 80
     or length(animal_morph) > 120 or length(animal_description) > 500
     or (p_data->>'sex') not in ('unknown','male','female')
     or (p_data->>'listing_status') not in ('not_listed','available','reserved','rehomed') then
    raise exception 'VALIDATION_FAILED';
  end if;
  if jsonb_typeof(p_data->'birth_date') = 'null' then birthday := null;
  elsif jsonb_typeof(p_data->'birth_date') = 'string' and (p_data->>'birth_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      birthday := (p_data->>'birth_date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'VALIDATION_FAILED';
    end;
  else raise exception 'VALIDATION_FAILED';
  end if;
  update public.animals set name = animal_name, species = animal_species, morph = animal_morph,
    sex = p_data->>'sex', birth_date = birthday, description = animal_description,
    listing_status = p_data->>'listing_status', updated_at = now()
    where id = p_animal_id and profile_id = actor;
  result := jsonb_build_object('id', p_animal_id, 'revision', private.bump(actor));
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'update_animal',request_hash,result);
  return result;
end $$;
revoke all on function api.update_animal(uuid,jsonb,bigint,uuid) from public, anon;
grant execute on function api.update_animal(uuid,jsonb,bigint,uuid) to authenticated;

-- Explicit public field list; never serialize an entire management row here.
create or replace function api.public_page(p_slug text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where slug=p_slug and is_published;
  if not found then return null; end if;
  return jsonb_build_object('profile',jsonb_build_object('slug',p.slug,'display_name',p.display_name,'bio',p.bio,'tagline',p.tagline,'theme_token',p.theme_token),
    'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'species',a.species,'morph',a.morph,'sex',a.sex,'birth_date',a.birth_date,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public),'[]'::jsonb));
end $$;
notify pgrst, 'reload schema';

-- Follow-up Unicode input normalization; review snapshot only.
-- Match browser trim for Unicode BOM/zero-width no-break space (U+FEFF).
create or replace function api.update_animal(p_animal_id uuid, p_data jsonb, p_expected bigint, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  receipt private.mutation_receipts;
  request_hash text;
  result jsonb;
  field text;
  animal_name text;
  animal_species text;
  animal_morph text;
  animal_description text;
  birthday date;
begin
  perform private.check_writes();
  actor := private.actor();
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  -- Match existing owner commands: serialize profile, receipts and revision together.
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id = actor
      and document_version = 'local-preview-v1' and document_kind in ('terms','privacy')) <> 2 then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if not exists(select 1 from public.animals where id = p_animal_id and profile_id = actor) then
    raise exception 'NOT_FOUND';
  end if;
  request_hash := md5(jsonb_build_object('animal_id', p_animal_id, 'data', p_data)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'update_animal' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
  if not (p_data ?& array['name','species','morph','sex','birth_date','description','listing_status'])
     or (p_data - array['name','species','morph','sex','birth_date','description','listing_status']) <> '{}'::jsonb then
    raise exception 'VALIDATION_FAILED';
  end if;
  foreach field in array array['name','species','morph','sex','description','listing_status'] loop
    if jsonb_typeof(p_data -> field) is distinct from 'string' then raise exception 'VALIDATION_FAILED'; end if;
  end loop;
  animal_name := regexp_replace(p_data->>'name', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_species := regexp_replace(p_data->>'species', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_morph := regexp_replace(p_data->>'morph', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_description := regexp_replace(p_data->>'description', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  if length(animal_name) not between 1 and 40 or length(animal_species) not between 1 and 80
     or length(animal_morph) > 120 or length(animal_description) > 500
     or (p_data->>'sex') not in ('unknown','male','female')
     or (p_data->>'listing_status') not in ('not_listed','available','reserved','rehomed') then
    raise exception 'VALIDATION_FAILED';
  end if;
  if jsonb_typeof(p_data->'birth_date') = 'null' then birthday := null;
  elsif jsonb_typeof(p_data->'birth_date') = 'string' and (p_data->>'birth_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      birthday := (p_data->>'birth_date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'VALIDATION_FAILED';
    end;
  else raise exception 'VALIDATION_FAILED';
  end if;
  update public.animals set name = animal_name, species = animal_species, morph = animal_morph,
    sex = p_data->>'sex', birth_date = birthday, description = animal_description,
    listing_status = p_data->>'listing_status', updated_at = now()
    where id = p_animal_id and profile_id = actor;
  result := jsonb_build_object('id', p_animal_id, 'revision', private.bump(actor));
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'update_animal',request_hash,result);
  return result;
end $$;
revoke all on function api.update_animal(uuid,jsonb,bigint,uuid) from public, anon;
grant execute on function api.update_animal(uuid,jsonb,bigint,uuid) to authenticated;

notify pgrst, 'reload schema';


-- F-03 collection apply: CLI migration 20261028170427 (local, additive).
create function api.apply_animal_collection(p_items jsonb, p_expected bigint, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.actor();
  receipt private.mutation_receipts;
  request_hash text;
  item jsonb;
  owned_count integer;
  result jsonb;
  revision bigint;
begin
  if p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id = actor
      and document_version = 'local-preview-v1' and document_kind in ('terms','privacy')) <> 2 then
    raise exception 'CONSENT_REQUIRED';
  end if;
  request_hash := md5(jsonb_build_object('items',p_items)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'apply_animal_collection' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'VALIDATION_FAILED'; end if;
  if jsonb_array_length(p_items) > 20 then raise exception 'VALIDATION_FAILED'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
    if not (item ?& array['id','is_public']) or (item - array['id','is_public']) <> '{}'::jsonb
       or jsonb_typeof(item->'id') is distinct from 'string'
       or jsonb_typeof(item->'is_public') is distinct from 'boolean' then
      raise exception 'VALIDATION_FAILED';
    end if;
    if (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION_FAILED';
    end if;
  end loop;
  select count(*) into owned_count from public.animals where profile_id = actor;
  if owned_count <> jsonb_array_length(p_items)
     or (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_items)) <> owned_count
     or (select count(*) from public.animals a join jsonb_array_elements(p_items) i on a.id = (i.value->>'id')::uuid
         where a.profile_id = actor) <> owned_count then
    raise exception 'VALIDATION_FAILED';
  end if;
  -- Existing privacy policy: hiding remains possible while nonessential writes are paused.
  if exists(select 1 from jsonb_array_elements(p_items) with ordinality i(value,position)
      join public.animals a on a.id = (i.value->>'id')::uuid and a.profile_id = actor
      where a.sort_order <> i.position - 1 or (not a.is_public and (i.value->>'is_public')::boolean)) then
    perform private.check_writes();
  end if;
  set constraints public.animals_profile_id_sort_order_key deferred;
  update public.animals a set sort_order = i.position - 1, is_public = (i.value->>'is_public')::boolean, updated_at = now()
    from jsonb_array_elements(p_items) with ordinality i(value,position)
    where a.id = (i.value->>'id')::uuid and a.profile_id = actor
      and (a.sort_order is distinct from i.position - 1 or a.is_public is distinct from (i.value->>'is_public')::boolean);
  if found then revision := private.bump(actor);
  else select p.revision into revision from public.profiles p where id = actor;
  end if;
  result := jsonb_build_object('revision',revision);
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'apply_animal_collection',request_hash,result);
  return result;
end $$;
revoke all on function api.apply_animal_collection(jsonb,bigint,uuid) from public, anon;
grant execute on function api.apply_animal_collection(jsonb,bigint,uuid) to authenticated;
notify pgrst, 'reload schema';

-- Issue #10 photo edit/cleanup review snapshot; additive migration is the execution source.
SET local check_function_bodies = off;

ALTER TABLE "private"."media_assets"
  DROP CONSTRAINT "media_assets_reservation_bytes_check";

ALTER TABLE "private"."media_assets"
  ADD COLUMN "cleanup_after" timestamp WITH time zone;

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
  if a.cleanup_after>now() then return null; end if;
  return (select jsonb_agg(object_path) from private.media_objects where asset_id=p_asset_id);
end $function$;

CREATE OR REPLACE FUNCTION api.expired_uploads()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'profile_id',m.profile_id)),'[]'::jsonb) from
 (select id,profile_id from private.media_assets where (state='delete_pending' or expires_at<now()) and (cleanup_after is null or cleanup_after<=now()) order by created_at limit 50) m;
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
  if a.cleanup_after>now() then raise exception 'CLEANUP_PENDING'; end if;
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

CREATE OR REPLACE FUNCTION api.register_upload_lease (
  p_asset_id uuid,
  p_actor    uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare a private.media_assets; extra bigint;
begin
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  select * into a from private.media_assets where id=p_asset_id and profile_id=p_actor and state='reserved' and expires_at>now() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  extra:=greatest(450560-a.reservation_bytes,0);
  if exists(select 1 from private.storage_usage where profile_id=p_actor and reserved_bytes+stored_bytes+extra>limit_bytes)
    or exists(select 1 from private.project_budget where id=1 and media_reserved_bytes+media_stored_bytes+extra>media_limit_bytes) then raise exception 'QUOTA_EXCEEDED'; end if;
  update private.storage_usage set reserved_bytes=reserved_bytes+extra where profile_id=p_actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes+extra where id=1;
  update private.media_assets set reservation_bytes=reservation_bytes+extra,cleanup_after=greatest(coalesce(cleanup_after,now()),clock_timestamp()+interval '2 hours 5 minutes') where id=a.id;
end $function$;

CREATE OR REPLACE FUNCTION api.reserve_photo_edit (
  p_animal_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor(); asset uuid:=gen_random_uuid(); budget bigint:=450560; manifest jsonb;
begin
  perform private.check_writes();
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  perform 1 from public.profiles where id=actor for update;
  if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.media_assets where profile_id=actor and state='reserved')>=2 then raise exception 'QUOTA_EXCEEDED'; end if;
  if (select count(*) from private.media_assets m where m.animal_id=p_animal_id and m.state<>'delete_pending' and not exists(select 1 from public.animal_photos p where p.asset_id=m.id))>=3 then raise exception 'QUOTA_EXCEEDED'; end if;
  if exists(select 1 from private.storage_usage where profile_id=actor and reserved_bytes+stored_bytes+budget>limit_bytes) or exists(select 1 from private.project_budget where id=1 and media_reserved_bytes+media_stored_bytes+budget>media_limit_bytes) then raise exception 'QUOTA_EXCEEDED'; end if;
  if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
  insert into private.media_assets(id,profile_id,animal_id,reservation_bytes,cleanup_after) values(asset,actor,p_animal_id,budget,clock_timestamp()+interval '2 hours 5 minutes');
  insert into private.media_objects(asset_id,profile_id,variant,object_path,byte_size)
    values(asset,actor,'original_display',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',225280),
          (asset,actor,'thumbnail',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',81920);
  update private.storage_usage set reserved_bytes=reserved_bytes+budget where profile_id=actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes+budget where id=1;
  select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) into manifest from private.media_objects where asset_id=asset;
  return jsonb_build_object('asset_id',asset,'objects',manifest);
end $function$;

CREATE OR REPLACE FUNCTION api.save_animal_edit (
  p_animal_id  uuid,
  p_data       jsonb,
  p_assets     jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid;
  receipt private.mutation_receipts;
  request_hash text;
  result jsonb;
  field text;
  animal_name text;
  animal_species text;
  animal_morph text;
  animal_description text;
  birthday date;
  assets uuid[];
  previous_assets uuid[];
begin
  perform 1 from private.project_budget where id=1 for update;
  actor := private.actor();
  perform 1 from private.storage_usage where profile_id=actor for update;
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  -- Match existing owner commands: serialize profile, receipts and revision together.
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id = actor
      and document_version = 'local-preview-v1' and document_kind in ('terms','privacy')) <> 2 then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if not exists(select 1 from public.animals where id = p_animal_id and profile_id = actor) then
    raise exception 'NOT_FOUND';
  end if;
  request_hash := md5(jsonb_build_object('animal_id', p_animal_id, 'data', p_data, 'assets', p_assets)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'save_animal_edit' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
  if not (p_data ?& array['name','species','morph','sex','birth_date','description','listing_status'])
     or (p_data - array['name','species','morph','sex','birth_date','description','listing_status']) <> '{}'::jsonb then
    raise exception 'VALIDATION_FAILED';
  end if;
  foreach field in array array['name','species','morph','sex','description','listing_status'] loop
    if jsonb_typeof(p_data -> field) is distinct from 'string' then raise exception 'VALIDATION_FAILED'; end if;
  end loop;
  animal_name := regexp_replace(p_data->>'name', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_species := regexp_replace(p_data->>'species', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_morph := regexp_replace(p_data->>'morph', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  animal_description := regexp_replace(p_data->>'description', ('^[[:space:]' || chr(65279) || ']+|[[:space:]' || chr(65279) || ']+$'), '', 'g');
  if length(animal_name) not between 1 and 40 or length(animal_species) not between 1 and 80
     or length(animal_morph) > 120 or length(animal_description) > 500
     or (p_data->>'sex') not in ('unknown','male','female')
     or (p_data->>'listing_status') not in ('not_listed','available','reserved','rehomed') then
    raise exception 'VALIDATION_FAILED';
  end if;
  if jsonb_typeof(p_data->'birth_date') = 'null' then birthday := null;
  elsif jsonb_typeof(p_data->'birth_date') = 'string' and (p_data->>'birth_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      birthday := (p_data->>'birth_date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'VALIDATION_FAILED';
    end;
  else raise exception 'VALIDATION_FAILED';
  end if;
  if jsonb_typeof(p_assets) is distinct from 'array' or jsonb_array_length(p_assets)>3 then raise exception 'VALIDATION_FAILED'; end if;
  if exists(select 1 from jsonb_array_elements(p_assets) x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'VALIDATION_FAILED'; end if;
  select coalesce(array_agg(x::uuid order by ord),'{}'::uuid[]) into assets from jsonb_array_elements_text(p_assets) with ordinality as e(x,ord);
  if cardinality(assets)<>(select count(distinct x) from unnest(assets) x) then raise exception 'VALIDATION_FAILED'; end if;
  -- Upload and cleanup lock assets after the profile/budget locks. No external IO here.
  perform 1 from private.media_assets where id=any(assets) order by id for update;
  if exists(select 1 from unnest(assets) x where not exists(select 1 from private.media_assets m
    where m.id=x and m.profile_id=actor and m.animal_id=p_animal_id and m.purpose='animal' and m.state='ready'
      and m.verified_at is not null and (m.expires_at is null or m.expires_at>now())
      and (select count(*) from private.media_objects o where o.asset_id=m.id and o.state='stored')=2)) then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(asset_id order by sort_order),'{}'::uuid[]) into previous_assets from public.animal_photos where animal_id=p_animal_id and profile_id=actor;
  if not (select writes_enabled from private.project_budget where id=1) then
    if assets is distinct from array(select x from unnest(previous_assets) x where x=any(assets))
      or not exists(select 1 from public.animals a where a.id=p_animal_id and a.profile_id=actor
        and a.name=animal_name and a.species=animal_species and a.morph=animal_morph
        and a.sex=p_data->>'sex' and a.birth_date is not distinct from birthday
        and a.description=animal_description and a.listing_status=p_data->>'listing_status')
    then raise exception 'SERVICE_UNAVAILABLE'; end if;
  end if;
  delete from public.animal_photos where animal_id=p_animal_id and profile_id=actor;
  insert into public.animal_photos(profile_id,animal_id,asset_id,sort_order)
    select actor,p_animal_id,x,(ord-1)::integer from unnest(assets) with ordinality as e(x,ord);
  update private.media_assets set expires_at=null where id=any(assets);
  update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where id=any(previous_assets) and not(id=any(assets));
  update public.animals set name = animal_name, species = animal_species, morph = animal_morph,
    sex = p_data->>'sex', birth_date = birthday, description = animal_description,
    listing_status = p_data->>'listing_status', updated_at = now()
    where id = p_animal_id and profile_id = actor;
  result := jsonb_build_object('id', p_animal_id, 'revision', private.bump(actor));
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'save_animal_edit',request_hash,result);
  return result;
end $function$;

ALTER TABLE "private"."media_assets"
  ADD CONSTRAINT "media_assets_reservation_bytes_check" CHECK (((reservation_bytes >= 1) AND (reservation_bytes <= 450560)));

REVOKE ALL ON FUNCTION "api"."register_upload_lease"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."register_upload_lease"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."reserve_photo_edit"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."reserve_photo_edit"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."save_animal_edit"(uuid, jsonb, jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."save_animal_edit"(uuid, jsonb, jsonb, bigint, uuid) TO "authenticated";

-- Review snapshot: animal deletion, CLI migration 20261029042650. Do not replay against a migrated database.
SET local check_function_bodies = off;

DROP POLICY "animal_read" ON "public"."animals";

ALTER TABLE "public"."animals"
  DROP CONSTRAINT "animals_profile_id_sort_order_key";

CREATE TABLE "private"."animal_deletions" (
  "animal_id"    uuid                     NOT NULL,
  "profile_id"   uuid                     NOT NULL,
  "animal_name"  text                     NOT NULL,
  "request_id"   uuid                     NOT NULL,
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "animal_deletions_pkey" PRIMARY KEY (animal_id)
);

ALTER TABLE "private"."animal_deletions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."animals"
  ADD COLUMN "deleted_at" timestamp WITH time zone;

ALTER TABLE "public"."animals"
  ADD COLUMN "active_sort_order" integer GENERATED ALWAYS AS (
CASE
    WHEN (deleted_at IS NULL) THEN sort_order
    ELSE NULL::integer
END) STORED;

CREATE OR REPLACE FUNCTION api.animal_deletion_assets (
  p_animal_id uuid,
  p_actor     uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not exists(select 1 from private.animal_deletions where animal_id=p_animal_id and profile_id=p_actor)
    and not exists(select 1 from private.mutation_receipts where actor_id=p_actor and operation='delete_animal' and result_ref->>'id'=p_animal_id::text) then raise exception 'NOT_FOUND'; end if;
  return (select coalesce(jsonb_agg(id),'[]'::jsonb) from private.media_assets where animal_id=p_animal_id and profile_id=p_actor);
end $function$;

CREATE OR REPLACE FUNCTION api.apply_animal_collection (
  p_items      jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid := private.actor();
  receipt private.mutation_receipts;
  request_hash text;
  item jsonb;
  owned_count integer;
  result jsonb;
  revision bigint;
begin
  if p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id = actor
      and document_version = 'local-preview-v1' and document_kind in ('terms','privacy')) <> 2 then
    raise exception 'CONSENT_REQUIRED';
  end if;
  request_hash := md5(jsonb_build_object('items',p_items)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'apply_animal_collection' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'VALIDATION_FAILED'; end if;
  if jsonb_array_length(p_items) > 20 then raise exception 'VALIDATION_FAILED'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
    if not (item ?& array['id','is_public']) or (item - array['id','is_public']) <> '{}'::jsonb
       or jsonb_typeof(item->'id') is distinct from 'string'
       or jsonb_typeof(item->'is_public') is distinct from 'boolean' then
      raise exception 'VALIDATION_FAILED';
    end if;
    if (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION_FAILED';
    end if;
  end loop;
  select count(*) into owned_count from public.animals where profile_id = actor and deleted_at is null;
  if owned_count <> jsonb_array_length(p_items)
     or (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_items)) <> owned_count
     or (select count(*) from public.animals a join jsonb_array_elements(p_items) i on a.id = (i.value->>'id')::uuid
         where a.profile_id = actor and a.deleted_at is null) <> owned_count then
    raise exception 'VALIDATION_FAILED';
  end if;
  -- Existing privacy policy: hiding remains possible while nonessential writes are paused.
  if exists(select 1 from jsonb_array_elements(p_items) with ordinality i(value,position)
      join public.animals a on a.id = (i.value->>'id')::uuid and a.profile_id = actor and a.deleted_at is null
      where a.sort_order <> i.position - 1 or (not a.is_public and (i.value->>'is_public')::boolean)) then
    perform private.check_writes();
  end if;
  set constraints public.animals_profile_id_sort_order_key deferred;
  update public.animals a set sort_order = i.position - 1, is_public = (i.value->>'is_public')::boolean, updated_at = now()
    from jsonb_array_elements(p_items) with ordinality i(value,position)
    where a.id = (i.value->>'id')::uuid and a.profile_id = actor and a.deleted_at is null
      and (a.sort_order is distinct from i.position - 1 or a.is_public is distinct from (i.value->>'is_public')::boolean);
  if found then revision := private.bump(actor);
  else select p.revision into revision from public.profiles p where id = actor;
  end if;
  result := jsonb_build_object('revision',revision);
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'apply_animal_collection',request_hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION api.delete_animal (
  p_animal_id  uuid,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor(); receipt private.mutation_receipts; hash text; a public.animals; result jsonb;
begin
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  perform 1 from public.profiles where id=actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
  hash:=md5(jsonb_build_object('animal_id',p_animal_id)::text);
  select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.operation<>'delete_animal' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
    if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  select * into a from public.animals where id=p_animal_id and profile_id=actor and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform private.lock_profile(p_expected);
  update public.animals set deleted_at=now(),is_public=false,updated_at=now() where id=a.id;
  delete from public.animal_photos where animal_id=a.id and profile_id=actor;
  update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where animal_id=a.id and profile_id=actor;
  insert into private.animal_deletions(animal_id,profile_id,animal_name,request_id) values(a.id,actor,a.name,p_request_id);
  result:=jsonb_build_object('id',a.id,'revision',private.bump(actor));
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'delete_animal',hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION api.finish_animal_deletion (
  p_animal_id uuid,
  p_actor     uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  perform 1 from public.profiles where id=p_actor for update;
  perform 1 from private.animal_deletions where animal_id=p_animal_id and profile_id=p_actor for update;
  if not found then
    if exists(select 1 from private.mutation_receipts where actor_id=p_actor and operation='delete_animal' and result_ref->>'id'=p_animal_id::text) then return true; end if;
    raise exception 'NOT_FOUND';
  end if;
  if exists(select 1 from private.media_assets where animal_id=p_animal_id and profile_id=p_actor) then return false; end if;
  delete from public.animals where id=p_animal_id and profile_id=p_actor and deleted_at is not null;
  if not found then raise exception 'NOT_FOUND'; end if;
  return true;
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
 where m.id=p_asset_id and o.variant=p_variant and m.state='ready' and o.state='stored' and a.deleted_at is null and private.active(p.id)
 and (p.id=p_actor or (p.is_published and a.is_public));
$function$;

CREATE OR REPLACE FUNCTION api.my_dashboard()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  return jsonb_build_object(
    'account_status',(select status from private.account_state where user_id=actor),
    'profile',(select to_jsonb(p) from public.profiles p where id=actor and private.active(actor)),
    'animals',coalesce((select jsonb_agg((to_jsonb(a)-array['deleted_at','active_sort_order'])||jsonb_build_object('photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where profile_id=actor and a.deleted_at is null and private.active(actor)),'[]'::jsonb),
    'pending_deletions',coalesce((select jsonb_agg(jsonb_build_object('id',animal_id,'name',animal_name,'requested_at',requested_at) order by requested_at) from private.animal_deletions where profile_id=actor),'[]'::jsonb),
    'usage',(select jsonb_build_object('stored_bytes',stored_bytes,'reserved_bytes',reserved_bytes,'limit_bytes',limit_bytes) from private.storage_usage where profile_id=actor));
end $function$;

CREATE OR REPLACE FUNCTION api.pending_animal_deletions()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',animal_id,'profile_id',profile_id)),'[]'::jsonb) from
 (select animal_id,profile_id from private.animal_deletions order by requested_at limit 50) j;
$function$;

CREATE OR REPLACE FUNCTION private.protect_deleted_animal()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if old.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.require_live_animal()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not exists(select 1 from public.animals where id=new.animal_id and profile_id=new.profile_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  return new;
end $function$;

ALTER TABLE "private"."animal_deletions"
  ADD CONSTRAINT "animal_deletions_animal_id_profile_id_fkey" FOREIGN KEY (animal_id, profile_id) REFERENCES public.animals(id, profile_id) ON DELETE CASCADE;

ALTER TABLE "private"."animal_deletions"
  ADD CONSTRAINT "animal_deletions_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."animals"
  ADD CONSTRAINT "animals_profile_id_sort_order_key" UNIQUE (profile_id, active_sort_order) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX animal_deletions_owner_idx ON private.animal_deletions USING btree (profile_id, requested_at);

CREATE TRIGGER media_live_animal
  BEFORE INSERT ON private.media_assets
  FOR EACH ROW
  EXECUTE FUNCTION private.require_live_animal();

CREATE TRIGGER photo_live_animal
  BEFORE INSERT OR UPDATE ON public.animal_photos
  FOR EACH ROW
  EXECUTE FUNCTION private.require_live_animal();

CREATE TRIGGER protect_deleted_animal
  BEFORE UPDATE ON public.animals
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_deleted_animal();

CREATE POLICY "animal_read" ON "public"."animals"
  FOR SELECT
  TO "anon", "authenticated"
  USING (((deleted_at IS NULL) AND private.active(profile_id) AND ((profile_id = ( SELECT auth.uid() AS uid)) OR (is_public AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = animals.profile_id) AND p.is_published)))))));

REVOKE ALL ON FUNCTION "api"."animal_deletion_assets"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."animal_deletion_assets"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."delete_animal"(uuid, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."delete_animal"(uuid, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."finish_animal_deletion"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."finish_animal_deletion"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "api"."pending_animal_deletions"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."pending_animal_deletions"() TO "service_role";

REVOKE ALL ON FUNCTION "private"."protect_deleted_animal"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."require_live_animal"() FROM PUBLIC;

-- Review snapshot: visibility applies after deletion gaps, CLI migration 20261029053239.
SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION api.apply_animal_collection (
  p_items      jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid := private.actor();
  receipt private.mutation_receipts;
  request_hash text;
  item jsonb;
  owned_count integer;
  result jsonb;
  revision bigint;
begin
  if p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.consents where user_id = actor
      and document_version = 'local-preview-v1' and document_kind in ('terms','privacy')) <> 2 then
    raise exception 'CONSENT_REQUIRED';
  end if;
  request_hash := md5(jsonb_build_object('items',p_items)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'apply_animal_collection' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'VALIDATION_FAILED'; end if;
  if jsonb_array_length(p_items) > 20 then raise exception 'VALIDATION_FAILED'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
    if not (item ?& array['id','is_public']) or (item - array['id','is_public']) <> '{}'::jsonb
       or jsonb_typeof(item->'id') is distinct from 'string'
       or jsonb_typeof(item->'is_public') is distinct from 'boolean' then
      raise exception 'VALIDATION_FAILED';
    end if;
    if (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION_FAILED';
    end if;
  end loop;
  select count(*) into owned_count from public.animals where profile_id = actor and deleted_at is null;
  if owned_count <> jsonb_array_length(p_items)
     or (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_items)) <> owned_count
     or (select count(*) from public.animals a join jsonb_array_elements(p_items) i on a.id = (i.value->>'id')::uuid
         where a.profile_id = actor and a.deleted_at is null) <> owned_count then
    raise exception 'VALIDATION_FAILED';
  end if;
  -- Existing privacy policy: hiding remains possible while nonessential writes are paused.
  if exists(select 1 from jsonb_array_elements(p_items) with ordinality i(value,position)
      join (select id,is_public,row_number() over(order by sort_order,id) as position
            from public.animals where profile_id=actor and deleted_at is null) a
        on a.id = (i.value->>'id')::uuid
      where a.position <> i.position or (not a.is_public and (i.value->>'is_public')::boolean)) then
    perform private.check_writes();
  end if;
  set constraints public.animals_profile_id_sort_order_key deferred;
  update public.animals a set sort_order = i.position - 1, is_public = (i.value->>'is_public')::boolean, updated_at = now()
    from jsonb_array_elements(p_items) with ordinality i(value,position)
    where a.id = (i.value->>'id')::uuid and a.profile_id = actor and a.deleted_at is null
      and (a.sort_order is distinct from i.position - 1 or a.is_public is distinct from (i.value->>'is_public')::boolean);
  if found then revision := private.bump(actor);
  else select p.revision into revision from public.profiles p where id = actor;
  end if;
  result := jsonb_build_object('revision',revision);
  insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref)
    values(actor,p_request_id,'apply_animal_collection',request_hash,result);
  return result;
end $function$;

-- Review snapshot: animal growth, CLI migration 20261029060006.
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

-- Review snapshot: growth conflict ownership, CLI migration 20261029061558.
SET local check_function_bodies = off;

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
   on conflict(id) do update set measured_on=excluded.measured_on,weight_g=excluded.weight_g,updated_at=now()
    where growth_records.profile_id=actor and growth_records.animal_id=a.id;
  if not found then raise exception 'NOT_FOUND'; end if;
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

-- External links: generated from verified local schema, 20261029070658.
SET local check_function_bodies = off;

CREATE TABLE "public"."external_links" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "profile_id"  uuid                     NOT NULL,
  "title"       text                     NOT NULL,
  "url"         text                     NOT NULL,
  "color_token" text                     NOT NULL,
  "is_public"   boolean                  NOT NULL DEFAULT false,
  "sort_order"  integer                  NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "external_links_color_token_check"
    CHECK
    ((color_token = ANY (ARRAY['black'::text, 'gray'::text, 'blue'::text, 'mint'::text, 'green'::text, 'light-pink'::text, 'pink'::text, 'red'::text, 'purple'::text,
    'yellow'::text, 'orange'::text]))),
  CONSTRAINT "external_links_pkey" PRIMARY KEY (id),
  CONSTRAINT "external_links_profile_id_sort_order_key" UNIQUE (profile_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "external_links_sort_order_check" CHECK ((sort_order >= 0)),
  CONSTRAINT "external_links_title_check" CHECK ((((length(title) >= 1) AND (length(title) <= 40)) AND (title !~ '^[[:space:]]*$'::text)))
);

ALTER TABLE "public"."external_links"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION api.apply_external_links (
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
  if receipt.operation<>'apply_external_links' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;return receipt.result_ref;
 end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_remove) is distinct from 'array' then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_array_length(p_items)>10 or jsonb_array_length(p_remove)>10 then raise exception 'VALIDATION_FAILED'; end if;
 for r in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(r) is distinct from 'object' or not(r?&array['id','is_public']) or r-array['id','is_public']<>'{}'::jsonb or jsonb_typeof(r->'id') is distinct from 'string' or (r->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(r->'is_public') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r->>'id')::uuid;if rid=any(ids) then raise exception 'VALIDATION_FAILED'; end if;ids:=array_append(ids,rid);
 end loop;
 for r in select value from jsonb_array_elements(p_remove) loop
  if jsonb_typeof(r) is distinct from 'string' or (r#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'VALIDATION_FAILED'; end if;
  rid:=(r#>>'{}')::uuid;if rid=any(ids) or rid=any(removed) then raise exception 'VALIDATION_FAILED'; end if;removed:=array_append(removed,rid);
 end loop;
 if (select count(*) from public.external_links where profile_id=actor)<>cardinality(ids)+cardinality(removed)
 or (select count(*) from public.external_links where profile_id=actor and id=any(ids||removed))<>cardinality(ids)+cardinality(removed) then raise exception 'VALIDATION_FAILED'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) with ordinality i(value,position)
  join(select id,is_public,row_number() over(order by sort_order,id) as position from public.external_links where profile_id=actor and not(id=any(removed))) l on l.id=(i.value->>'id')::uuid
  where l.position<>i.position or (not l.is_public and (i.value->>'is_public')::boolean)) then perform private.check_writes(); end if;
 delete from public.external_links where profile_id=actor and id=any(removed);changed:=found;
 set constraints public.external_links_profile_id_sort_order_key deferred;
 update public.external_links l set sort_order=i.position-1,is_public=(i.value->>'is_public')::boolean,updated_at=now() from jsonb_array_elements(p_items) with ordinality i(value,position)
  where l.profile_id=actor and l.id=(i.value->>'id')::uuid and (l.sort_order is distinct from i.position-1 or l.is_public is distinct from (i.value->>'is_public')::boolean);
 if changed or found then revision:=private.bump(actor);else select p.revision into revision from public.profiles p where id=actor;end if;
 result:=jsonb_build_object('revision',revision);
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'apply_external_links',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION api.my_external_links()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();begin
 if not exists(select 1 from public.profiles where id=actor) then raise exception 'NOT_FOUND'; end if;
 return jsonb_build_object('revision',(select revision from public.profiles where id=actor),'links',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'url',url,'color_token',color_token,'is_public',is_public,'sort_order',sort_order) order by sort_order,id) from public.external_links where profile_id=actor),'[]'::jsonb));
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
    'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'url',l.url,'color_token',l.color_token) order by l.sort_order,l.id) from public.external_links l where l.profile_id=p.id and l.is_public),'[]'::jsonb),'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'species',a.species,'morph',a.morph,'sex',a.sex,'birth_date',a.birth_date,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.save_external_link (
  p_link_id    uuid,
  p_data       jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();receipt private.mutation_receipts;hash text;result jsonb;link_id uuid;title_value text;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND'; end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in ('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED'; end if;
 hash:=md5(jsonb_build_object('link_id',p_link_id,'data',p_data)::text);
 select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_external_link' or receipt.request_hash<>hash then raise exception 'REQUEST_CONFLICT'; end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;return receipt.result_ref;
 end if;
 if p_link_id is not null and not exists(select 1 from public.external_links where id=p_link_id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
 perform private.lock_profile(p_expected);perform private.check_writes();
 if jsonb_typeof(p_data) is distinct from 'object' or not(p_data?&array['title','url','color_token']) or p_data-array['title','url','color_token']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
 if jsonb_typeof(p_data->'title') is distinct from 'string' or jsonb_typeof(p_data->'url') is distinct from 'string' or jsonb_typeof(p_data->'color_token') is distinct from 'string' then raise exception 'VALIDATION_FAILED'; end if;
 title_value:=regexp_replace(p_data->>'title',('^[[:space:]'||chr(65279)||']+|[[:space:]'||chr(65279)||']+$'),'','g');
 if length(title_value) not between 1 and 40 or not private.valid_https_url(p_data->>'url') or p_data->>'color_token' not in ('black','gray','blue','mint','green','light-pink','pink','red','purple','yellow','orange') then raise exception 'VALIDATION_FAILED'; end if;
 if p_link_id is null then
  if (select count(*) from public.external_links where profile_id=actor)>=10 then raise exception 'QUOTA_EXCEEDED'; end if;
  insert into public.external_links(profile_id,title,url,color_token,sort_order) values(actor,title_value,p_data->>'url',p_data->>'color_token',coalesce((select max(sort_order)+1 from public.external_links where profile_id=actor),0)) returning id into link_id;
 else
  update public.external_links set title=title_value,url=p_data->>'url',color_token=p_data->>'color_token',updated_at=now() where id=p_link_id and profile_id=actor returning id into link_id;
  if not found then raise exception 'NOT_FOUND'; end if;
 end if;
 result:=jsonb_build_object('id',link_id,'revision',private.bump(actor));
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_external_link',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION private.valid_https_url (
  p_url text
)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare authority text;parts text[];hostname text;last_label text;address inet;
begin
 if p_url is null or length(p_url)>2048 or p_url !~ '^https://' or p_url !~ '^[!-~]+$' or position(chr(92) in p_url)>0 then return false; end if;
 if position('%' in regexp_replace(p_url,'%[0-9a-fA-F]{2}','','g'))>0 then return false; end if;
 authority:=substring(p_url from '^https://([^/?#]+)');
 if authority is null or position('@' in authority)>0 then return false; end if;
 if left(authority,1)='[' then
  parts:=regexp_match(authority,'^\[([0-9a-fA-F:.]+)\](:([0-9]{1,5}))?$');
  if parts is null then return false; end if;
  address:=parts[1]::inet;if family(address)<>6 then return false; end if;
 else
  parts:=regexp_match(authority,'^([a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*\.?)(:([0-9]{1,5}))?$');
  if parts is null then return false; end if;
  hostname:=regexp_replace(parts[1],'\.$','');
  if length(hostname)>253 or exists(select 1 from unnest(string_to_array(hostname,'.')) label where length(label)>63) then return false; end if;
  last_label:=split_part(hostname,'.',-1);
  if last_label ~* '^([0-9]+|0x[0-9a-f]+)$' then
   if hostname !~ '^([0-9]{1,3}\.){3}[0-9]{1,3}$' then return false; end if;
   address:=hostname::inet;if family(address)<>4 then return false; end if;
  end if;
  parts:=array[parts[1],parts[3],parts[4]];
 end if;
 if parts[3] is not null and parts[3]::integer>65535 then return false; end if;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $function$;

ALTER TABLE "public"."external_links"
  ADD CONSTRAINT "external_links_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE POLICY "link_read" ON "public"."external_links"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((private.active(profile_id) AND ((profile_id = ( SELECT auth.uid() AS uid)) OR (is_public AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = external_links.profile_id) AND p.is_published)))))));

REVOKE ALL ON FUNCTION "api"."apply_external_links"(jsonb, jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."apply_external_links"(jsonb, jsonb, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."my_external_links"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_external_links"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."save_external_link"(uuid, jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."save_external_link"(uuid, jsonb, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."valid_https_url"(text) FROM PUBLIC;

REVOKE ALL ON TABLE "public"."external_links" FROM "anon";

REVOKE ALL ("color_token") ON TABLE "public"."external_links" FROM "anon";

GRANT SELECT ("color_token") ON TABLE "public"."external_links" TO "anon";

REVOKE ALL ("id") ON TABLE "public"."external_links" FROM "anon";

GRANT SELECT ("id") ON TABLE "public"."external_links" TO "anon";

REVOKE ALL ("is_public") ON TABLE "public"."external_links" FROM "anon";

GRANT SELECT ("is_public") ON TABLE "public"."external_links" TO "anon";

REVOKE ALL ("profile_id") ON TABLE "public"."external_links" FROM "anon";

GRANT SELECT ("profile_id") ON TABLE "public"."external_links" TO "anon";

REVOKE ALL ("sort_order") ON TABLE "public"."external_links" FROM "anon";

GRANT SELECT ("sort_order") ON TABLE "public"."external_links" TO "anon";

REVOKE ALL ("title") ON TABLE "public"."external_links" FROM "anon";

GRANT SELECT ("title") ON TABLE "public"."external_links" TO "anon";

REVOKE ALL ("url") ON TABLE "public"."external_links" FROM "anon";

GRANT SELECT ("url") ON TABLE "public"."external_links" TO "anon";

REVOKE ALL ON TABLE "public"."external_links" FROM "authenticated";

REVOKE ALL ("color_token") ON TABLE "public"."external_links" FROM "authenticated";

GRANT SELECT ("color_token") ON TABLE "public"."external_links" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."external_links" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."external_links" TO "authenticated";

REVOKE ALL ("is_public") ON TABLE "public"."external_links" FROM "authenticated";

GRANT SELECT ("is_public") ON TABLE "public"."external_links" TO "authenticated";

REVOKE ALL ("profile_id") ON TABLE "public"."external_links" FROM "authenticated";

GRANT SELECT ("profile_id") ON TABLE "public"."external_links" TO "authenticated";

REVOKE ALL ("sort_order") ON TABLE "public"."external_links" FROM "authenticated";

GRANT SELECT ("sort_order") ON TABLE "public"."external_links" TO "authenticated";

REVOKE ALL ("title") ON TABLE "public"."external_links" FROM "authenticated";

GRANT SELECT ("title") ON TABLE "public"."external_links" TO "authenticated";

REVOKE ALL ("url") ON TABLE "public"."external_links" FROM "authenticated";

GRANT SELECT ("url") ON TABLE "public"."external_links" TO "authenticated";

REVOKE ALL ON TABLE "public"."external_links" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."external_links" TO "postgres";

REVOKE ALL ON TABLE "public"."external_links" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."external_links" TO "service_role";

ALTER TABLE "public"."external_links"
  ADD CONSTRAINT "external_links_url_check" CHECK (private.valid_https_url(url));

-- SNS links: verified local schema, generated20261029072955.
SET local check_function_bodies = off;

CREATE TABLE "public"."social_links" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" uuid                     NOT NULL,
  "platform"   text                     NOT NULL,
  "url"        text                     NOT NULL,
  "is_public"  boolean                  NOT NULL DEFAULT false,
  "sort_order" integer                  NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "social_links_check"
    CHECK ((sort_order = (array_position(ARRAY['band'::text, 'instagram'::text, 'facebook'::text, 'youtube'::text, 'kakao'::text, 'naver_blog'::text], platform) - 1))),
  CONSTRAINT "social_links_pkey" PRIMARY KEY (id),
  CONSTRAINT "social_links_platform_check" CHECK ((platform = ANY (ARRAY['band'::text, 'instagram'::text, 'facebook'::text, 'youtube'::text, 'kakao'::text, 'naver_blog'::text]))),
  CONSTRAINT "social_links_profile_id_platform_key" UNIQUE (profile_id, platform),
  CONSTRAINT "social_links_profile_id_sort_order_key" UNIQUE (profile_id, sort_order),
  CONSTRAINT "social_links_url_check" CHECK (private.valid_https_url(url))
);

ALTER TABLE "public"."social_links"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION api.my_social_links()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();begin
 if not exists(select 1 from public.profiles where id=actor) then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('revision',(select revision from public.profiles where id=actor),'links',coalesce((select jsonb_agg(jsonb_build_object('platform',platform,'url',url,'is_public',is_public) order by sort_order) from public.social_links where profile_id=actor),'[]'::jsonb));
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
    'socials',coalesce((select jsonb_agg(jsonb_build_object('platform',s.platform,'url',s.url) order by s.sort_order) from public.social_links s where s.profile_id=p.id and s.is_public),'[]'::jsonb),'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'url',l.url,'color_token',l.color_token) order by l.sort_order,l.id) from public.external_links l where l.profile_id=p.id and l.is_public),'[]'::jsonb),'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'species',a.species,'morph',a.morph,'sex',a.sex,'birth_date',a.birth_date,'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph where ph.animal_id=a.id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.save_social_links (
  p_items      jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();receipt private.mutation_receipts;hash text;result jsonb;r jsonb;platforms text[]:=array['band','instagram','facebook','youtube','kakao','naver_blog'];seen text[]:='{}'::text[];url_value text;platform_value text;changed boolean:=false;revision bigint;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED';end if;
 hash:=md5(p_items::text);
 select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_social_links' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;return receipt.result_ref;
 end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'VALIDATION_FAILED';end if;
 if jsonb_array_length(p_items)<>6 then raise exception 'VALIDATION_FAILED';end if;
 for r in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(r) is distinct from 'object' or not(r?&array['platform','url','is_public']) or r-array['platform','url','is_public']<>'{}'::jsonb or jsonb_typeof(r->'platform') is distinct from 'string' or jsonb_typeof(r->'url') is distinct from 'string' or jsonb_typeof(r->'is_public') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED';end if;
  platform_value:=r->>'platform';url_value:=r->>'url';
  if not(platform_value=any(platforms)) or platform_value=any(seen) or (url_value='' and (r->>'is_public')::boolean) or (url_value<>'' and not private.valid_https_url(url_value)) then raise exception 'VALIDATION_FAILED';end if;
  seen:=array_append(seen,platform_value);
  if url_value<>'' and not exists(select 1 from public.social_links l where l.profile_id=actor and l.platform=platform_value and l.url=url_value and (l.is_public or not(r->>'is_public')::boolean)) then perform private.check_writes();end if;
 end loop;
 delete from public.social_links l using jsonb_array_elements(p_items) as input(value) where l.profile_id=actor and l.platform=input.value->>'platform' and input.value->>'url'='';changed:=found;
 for r in select value from jsonb_array_elements(p_items) where value->>'url'<>'' loop
  insert into public.social_links(profile_id,platform,url,is_public,sort_order) values(actor,r->>'platform',r->>'url',(r->>'is_public')::boolean,array_position(platforms,r->>'platform')-1)
   on conflict(profile_id,platform) do update set url=excluded.url,is_public=excluded.is_public,updated_at=now()
    where social_links.url is distinct from excluded.url or social_links.is_public is distinct from excluded.is_public;
  changed:=changed or found;
 end loop;
 if changed then revision:=private.bump(actor);else select p.revision into revision from public.profiles p where id=actor;end if;
 result:=jsonb_build_object('revision',revision);
 insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_social_links',hash,result);return result;
end $function$;

ALTER TABLE "public"."social_links"
  ADD CONSTRAINT "social_links_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE POLICY "social_read" ON "public"."social_links"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((private.active(profile_id) AND ((profile_id = ( SELECT auth.uid() AS uid)) OR (is_public AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = social_links.profile_id) AND p.is_published)))))));

REVOKE ALL ON FUNCTION "api"."my_social_links"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_social_links"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."save_social_links"(jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."save_social_links"(jsonb, bigint, uuid) TO "authenticated";

REVOKE ALL ON TABLE "public"."social_links" FROM "anon";

REVOKE ALL ("is_public") ON TABLE "public"."social_links" FROM "anon";

GRANT SELECT ("is_public") ON TABLE "public"."social_links" TO "anon";

REVOKE ALL ("platform") ON TABLE "public"."social_links" FROM "anon";

GRANT SELECT ("platform") ON TABLE "public"."social_links" TO "anon";

REVOKE ALL ("profile_id") ON TABLE "public"."social_links" FROM "anon";

GRANT SELECT ("profile_id") ON TABLE "public"."social_links" TO "anon";

REVOKE ALL ("sort_order") ON TABLE "public"."social_links" FROM "anon";

GRANT SELECT ("sort_order") ON TABLE "public"."social_links" TO "anon";

REVOKE ALL ("url") ON TABLE "public"."social_links" FROM "anon";

GRANT SELECT ("url") ON TABLE "public"."social_links" TO "anon";

REVOKE ALL ON TABLE "public"."social_links" FROM "authenticated";

REVOKE ALL ("is_public") ON TABLE "public"."social_links" FROM "authenticated";

GRANT SELECT ("is_public") ON TABLE "public"."social_links" TO "authenticated";

REVOKE ALL ("platform") ON TABLE "public"."social_links" FROM "authenticated";

GRANT SELECT ("platform") ON TABLE "public"."social_links" TO "authenticated";

REVOKE ALL ("profile_id") ON TABLE "public"."social_links" FROM "authenticated";

GRANT SELECT ("profile_id") ON TABLE "public"."social_links" TO "authenticated";

REVOKE ALL ("sort_order") ON TABLE "public"."social_links" FROM "authenticated";

GRANT SELECT ("sort_order") ON TABLE "public"."social_links" TO "authenticated";

REVOKE ALL ("url") ON TABLE "public"."social_links" FROM "authenticated";

GRANT SELECT ("url") ON TABLE "public"."social_links" TO "authenticated";

REVOKE ALL ON TABLE "public"."social_links" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."social_links" TO "postgres";

REVOKE ALL ON TABLE "public"."social_links" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."social_links" TO "service_role";

-- Schedules: verified local schema, generated20261029080057.
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
