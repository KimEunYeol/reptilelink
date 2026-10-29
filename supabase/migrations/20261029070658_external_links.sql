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
