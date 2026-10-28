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
