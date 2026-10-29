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
