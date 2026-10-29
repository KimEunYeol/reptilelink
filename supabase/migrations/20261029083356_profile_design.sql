SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION api.my_design()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();p public.profiles;begin
 select * into p from public.profiles where id=actor;if not found then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('revision',p.revision,'profile',jsonb_build_object('display_name',p.display_name,'tagline',p.tagline,'bio',p.bio),'links',(api.my_social_links()->'links'));
end $function$;

CREATE OR REPLACE FUNCTION api.save_design (
  p_profile    jsonb,
  p_items      jsonb,
  p_expected   bigint,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.actor();p public.profiles;receipt private.mutation_receipts;hash text;result jsonb;name_value text;tagline_value text;bio_value text;profile_changed boolean;social_changed boolean;revision bigint;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED';end if;
 select * into p from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED';end if;
 hash:=md5(jsonb_build_object('profile',p_profile,'items',p_items)::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_design' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;return receipt.result_ref;
 end if;
 perform private.lock_profile(p_expected);
 if jsonb_typeof(p_profile) is distinct from 'object' or not(p_profile?&array['display_name','tagline','bio']) or p_profile-array['display_name','tagline','bio']<>'{}'::jsonb then raise exception 'VALIDATION_FAILED';end if;
 if jsonb_typeof(p_profile->'display_name') is distinct from 'string' or jsonb_typeof(p_profile->'tagline') is distinct from 'string' or jsonb_typeof(p_profile->'bio') is distinct from 'string' then raise exception 'VALIDATION_FAILED';end if;
 name_value:=private.trim_profile_text(p_profile->>'display_name');tagline_value:=private.trim_profile_text(p_profile->>'tagline');bio_value:=private.trim_profile_text(p_profile->>'bio');
 if length(name_value) not between 1 and 40 or length(tagline_value)>80 or length(bio_value)>300 or name_value~('[[:cntrl:]]|['||chr(8232)||chr(8233)||']') or tagline_value~('[[:cntrl:]]|['||chr(8232)||chr(8233)||']') then raise exception 'VALIDATION_FAILED';end if;
 profile_changed:=p.display_name is distinct from name_value or p.tagline is distinct from tagline_value or p.bio is distinct from bio_value;
 if profile_changed then perform private.check_writes();end if;
 social_changed:=private.apply_social_values(actor,p_items);
 if profile_changed then update public.profiles set display_name=name_value,tagline=tagline_value,bio=bio_value where id=actor;end if;
 if profile_changed or social_changed then revision:=private.bump(actor);else revision:=p.revision;end if;
 result:=jsonb_build_object('revision',revision);insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_design',hash,result);return result;
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
  if p_name is null or p_bio is null then raise exception 'VALIDATION_FAILED';end if;
  p_name:=private.trim_profile_text(p_name);p_bio:=private.trim_profile_text(p_bio);
  if length(p_name) not between 1 and 40 or length(p_bio)>300 or p_name~('[[:cntrl:]]|['||chr(8232)||chr(8233)||']') then raise exception 'VALIDATION_FAILED';end if;
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
declare actor uuid:=private.actor();receipt private.mutation_receipts;hash text;result jsonb;changed boolean;revision bigint;
begin
 if p_request_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if (select count(*) from private.consents where user_id=actor and document_version='local-preview-v1' and document_kind in('terms','privacy'))<>2 then raise exception 'CONSENT_REQUIRED';end if;
 hash:=md5(p_items::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'save_social_links' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;return receipt.result_ref;
 end if;
 perform private.lock_profile(p_expected);changed:=private.apply_social_values(actor,p_items);
 if changed then revision:=private.bump(actor);else select p.revision into revision from public.profiles p where id=actor;end if;
 result:=jsonb_build_object('revision',revision);insert into private.mutation_receipts(actor_id,request_id,operation,request_hash,result_ref) values(actor,p_request_id,'save_social_links',hash,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION private.apply_social_values (
  p_actor uuid,
  p_items jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare actor uuid:=p_actor;r jsonb;platforms text[]:=array['band','instagram','facebook','youtube','kakao','naver_blog'];seen text[]:='{}'::text[];url_value text;platform_value text;changed boolean:=false;
begin
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

return changed;end $function$;

CREATE OR REPLACE FUNCTION private.trim_profile_text (
  p_value text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path TO ''
  AS $function$
 select btrim(p_value,E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$function$;

REVOKE ALL ON FUNCTION "api"."my_design"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."my_design"() TO "authenticated";

REVOKE ALL ON FUNCTION "api"."save_design"(jsonb, jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."save_design"(jsonb, jsonb, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."apply_social_values"(uuid, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."trim_profile_text"(text) FROM PUBLIC;
