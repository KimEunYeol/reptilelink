SET local check_function_bodies = off;

ALTER TABLE "private"."media_assets"
  ADD COLUMN "animal_role" text NOT NULL DEFAULT 'self'::text;

ALTER TABLE "public"."animals"
  ADD COLUMN "adoption_date" date;

ALTER TABLE "public"."animals"
  ADD COLUMN "father_asset_id" uuid;

ALTER TABLE "public"."animals"
  ADD COLUMN "mother_asset_id" uuid;

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
  select * into a from private.media_assets where id=p_asset_id and profile_id=actor and purpose='animal' and animal_role='self' and state='ready' and expires_at>now() for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.animal_photos where asset_id=a.id) then raise exception 'ALREADY_ATTACHED'; end if;
  insert into public.animal_photos(profile_id,animal_id,asset_id,sort_order) values(actor,a.animal_id,a.id,coalesce((select max(sort_order)+1 from public.animal_photos where animal_id=a.animal_id),0));
  update private.media_assets set expires_at=null where id=a.id;
  return jsonb_build_object('revision',private.bump(actor));
end $function$;

CREATE OR REPLACE FUNCTION api.cancel_parent_photo_request (
  p_animal_id  uuid,
  p_role       text,
  p_request_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.policy_actor();receipt private.mutation_receipts;hash text;asset uuid;
begin
 if p_request_id is null or p_role is null or p_role not in('father','mother') or p_animal_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor) then raise exception 'NOT_FOUND';end if;
 hash:=md5(jsonb_build_object('animal',p_animal_id,'role',p_role)::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if not found then
  -- An unknown in-flight reservation must not be created after explicit cancellation wins the profile lock.
  perform private.record_receipt(actor,p_request_id,'cancel_parent_photo_request',hash,'{}'::jsonb);return null;
 end if;
 if receipt.request_hash is distinct from hash or receipt.operation not in('reserve_parent_photo','cancel_parent_photo_request') then raise exception 'REQUEST_CONFLICT';end if;
 if receipt.operation='cancel_parent_photo_request' then return null;end if;
 asset:=(receipt.result_ref->>'id')::uuid;
 perform 1 from private.media_assets where id=asset and profile_id=actor and purpose='animal' and animal_id=p_animal_id and animal_role=p_role for update;if not found then return null;end if;
 if private.asset_bound(asset) then raise exception 'NOT_FOUND';end if;
 update private.media_assets set state='delete_pending' where id=asset;return asset;
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
  if exists(select 1 from private.account_deletions where user_id=p_actor and sessions_revoked_at is null) then raise exception 'CLEANUP_PENDING';end if;
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=p_actor for update;
  select * into a from private.media_assets where id=p_asset_id and profile_id=p_actor for update;
  if not found or private.asset_bound(p_asset_id) then raise exception 'NOT_FOUND'; end if;
  update private.media_assets set state='delete_pending' where id=p_asset_id;
  if a.cleanup_after>now() then return null; end if;
  return (select jsonb_agg(object_path) from private.media_objects where asset_id=p_asset_id);
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
  actor:=private.write_actor();
  -- Serializing by profile also serializes receipt checks and item quota checks.
  perform 1 from public.profiles where id=actor for update;
  select * into old_receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
  if found then
    if old_receipt.operation<>'create_animal' or old_receipt.request_hash<>md5(p_data::text) then raise exception 'REQUEST_CONFLICT'; end if;
    return old_receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if (select count(*) from public.animals where profile_id=actor)>=20 then raise exception 'QUOTA_EXCEEDED'; end if;
  insert into public.animals(profile_id,name,species,morph,sex,description,is_public,listing_status,sort_order,birth_date,adoption_date)
  values(actor,trim(p_data->>'name'),trim(p_data->>'species'),coalesce(p_data->>'morph',''),coalesce(p_data->>'sex','unknown'),coalesce(p_data->>'description',''),coalesce((p_data->>'is_public')::boolean,false),coalesce(p_data->>'listing_status','not_listed'),coalesce((select max(sort_order)+1 from public.animals where profile_id=actor),0),private.animal_date(coalesce(p_data->'birth_date','null'::jsonb)),private.animal_date(coalesce(p_data->'adoption_date','null'::jsonb)))
  returning id into animal_id;
  result:=jsonb_build_object('id',animal_id,'revision',private.bump(actor));
  perform private.record_receipt(actor,p_request_id,'create_animal',md5(p_data::text),result);
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
declare actor uuid:=private.write_actor(); receipt private.mutation_receipts; hash text; a public.animals; result jsonb;
begin
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  perform 1 from public.profiles where id=actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not private.has_required_consents(actor) then raise exception 'CONSENT_REQUIRED'; end if;
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
  update public.animals set deleted_at=now(),is_public=false,father_asset_id=null,mother_asset_id=null,updated_at=now() where id=a.id;
  delete from public.animal_photos where animal_id=a.id and profile_id=actor;
  update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where animal_id=a.id and profile_id=actor;
  insert into private.animal_deletions(animal_id,profile_id,animal_name,request_id) values(a.id,actor,a.name,p_request_id);
  result:=jsonb_build_object('id',a.id,'revision',private.bump(actor));
  perform private.record_receipt(actor,p_request_id,'delete_animal',hash,result);
  return result;
end $function$;

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
  if exists(select 1 from private.account_deletions where user_id=(select profile_id from private.media_assets where id=p_asset_id) and sessions_revoked_at is null) then raise exception 'CLEANUP_PENDING';end if;
  perform 1 from private.project_budget where id=1 for update;
  select * into a from private.media_assets where id=p_asset_id and state='delete_pending';
  if not found then return; end if;
  if private.asset_bound(p_asset_id) then raise exception 'NOT_FOUND'; end if;
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
 where m.id=p_asset_id and o.variant=p_variant and m.state='ready' and m.animal_role='self' and o.state='stored' and a.deleted_at is null and private.active(p.id)
 and (p.id=p_actor or (p.is_published and a.is_public))
 union all
 select o.object_path from private.media_objects o join private.media_assets m on m.id=o.asset_id
 join public.profiles p on p.id=m.profile_id and ((m.purpose='avatar' and p.avatar_asset_id=m.id) or (m.purpose='cover' and p.cover_asset_id=m.id))
 where m.id=p_asset_id and o.variant=p_variant and m.state='ready' and o.state='stored' and private.active(p.id) and (p.id=p_actor or p.is_published)
 union all
 select o.object_path from private.media_objects o join private.media_assets m on m.id=o.asset_id
 join public.animals a on a.id=m.animal_id and a.profile_id=m.profile_id and ((m.animal_role='father' and a.father_asset_id=m.id) or (m.animal_role='mother' and a.mother_asset_id=m.id))
 join public.profiles p on p.id=a.profile_id
 where m.id=p_asset_id and m.purpose='animal' and o.variant=p_variant and m.state='ready' and o.state='stored' and a.deleted_at is null and private.active(p.id) and (p.id=p_actor or (p.is_published and a.is_public));
$function$;

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
    'socials',coalesce((select jsonb_agg(jsonb_build_object('platform',s.platform,'url',s.url) order by s.sort_order) from public.social_links s where s.profile_id=p.id and s.is_public),'[]'::jsonb),'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'url',l.url,'color_token',l.color_token) order by l.sort_order,l.id) from public.external_links l where l.profile_id=p.id and l.is_public),'[]'::jsonb),'animals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'comment_count',api.public_comment_count(a.id),'species',a.species,'morph',a.morph,'sex',a.sex,'birth_date',a.birth_date,'adoption_date',a.adoption_date,
 'father_asset_id',(select m.id from private.media_assets m where m.id=a.father_asset_id and m.profile_id=a.profile_id and m.animal_id=a.id and m.purpose='animal' and m.animal_role='father' and m.state='ready'),
 'mother_asset_id',(select m.id from private.media_assets m where m.id=a.mother_asset_id and m.profile_id=a.profile_id and m.animal_id=a.id and m.purpose='animal' and m.animal_role='mother' and m.state='ready'),'description',a.description,'listing_status',a.listing_status,'photos',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ph.asset_id,'sort_order',ph.sort_order) order by ph.sort_order) from public.animal_photos ph join private.media_assets m on m.id=ph.asset_id and m.profile_id=ph.profile_id and m.animal_id=ph.animal_id and m.purpose='animal' and m.animal_role='self' and m.state='ready' where ph.animal_id=a.id and ph.profile_id=a.profile_id),'[]'::jsonb)) order by a.sort_order,a.id) from public.animals a where a.profile_id=p.id and a.is_public and a.deleted_at is null),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.request_account_deletion (
  p_expected   bigint,
  p_request_id uuid,
  p_confirm    text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=auth.uid();p public.profiles;r private.mutation_receipts;hash text:=md5('withdrawal:confirmed');result jsonb;
begin
 if actor is null then raise exception 'UNAUTHENTICATED';end if;
 if p_request_id is null or p_confirm is distinct from '탈퇴' then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.account_state where user_id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 select * into r from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if r.operation<>'delete_account' or r.request_hash<>hash then raise exception 'REQUEST_CONFLICT';end if;
  return api.my_account_deletion();
 end if;
 perform 1 from private.account_deletions where user_id=actor;
 if found then raise exception 'REQUEST_CONFLICT';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;
 select * into p from public.profiles where id=actor for update;
 if (found and p.revision is distinct from p_expected) or (not found and p_expected is not null) then raise exception 'VERSION_CONFLICT';end if;
 update private.account_state set status='deleting' where user_id=actor;
 insert into private.account_deletions(user_id,request_id) values(actor,p_request_id);
 update public.profiles set is_published=false,avatar_asset_id=null,cover_asset_id=null,revision=revision+1,updated_at=now() where id=actor;
 update public.animals set is_public=false,deleted_at=coalesce(deleted_at,now()),father_asset_id=null,mother_asset_id=null,updated_at=now() where profile_id=actor and deleted_at is null;
 delete from private.profile_likes where actor_id=actor;
 update public.comments set body=null,status='deleted',deleted_at=coalesce(deleted_at,now()),updated_at=now() where author_id=actor and status<>'deleted';
 delete from public.animal_photos where profile_id=actor;
 update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where profile_id=actor;
 -- Bind invitations at signup so a later email change cannot revive the original invitation.
 delete from private.signup_allowlist where invited_user_id=actor or normalized_email=(select lower(trim(email)) from auth.users where id=actor);
 result:=api.my_account_deletion();
 perform private.record_receipt(actor,p_request_id,'delete_account',hash,jsonb_build_object('requested',true));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION api.reserve_parent_photo (
  p_animal_id  uuid,
  p_role       text,
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor();asset uuid;budget bigint:=450560;a private.media_assets;receipt private.mutation_receipts;hash text;manifest jsonb;
begin
 if p_request_id is null or p_role is null or p_role not in('father','mother') or p_animal_id is null then raise exception 'VALIDATION_FAILED';end if;
 perform 1 from private.project_budget where id=1 for update;
 perform 1 from private.storage_usage where profile_id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from public.profiles where id=actor for update;if not found then raise exception 'NOT_FOUND';end if;
 if not private.has_required_consents(actor) then raise exception 'CONSENT_REQUIRED';end if;
 if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor and deleted_at is null) then raise exception 'NOT_FOUND';end if;
 hash:=md5(jsonb_build_object('animal',p_animal_id,'role',p_role)::text);select * into receipt from private.mutation_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.operation<>'reserve_parent_photo' or receipt.request_hash is distinct from hash then raise exception 'REQUEST_CONFLICT';end if;
  if receipt.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;
  asset:=(receipt.result_ref->>'id')::uuid;
  select * into a from private.media_assets where id=asset and profile_id=actor and purpose='animal' and animal_id=p_animal_id and animal_role=p_role for update;
  if not found or a.state not in('reserved','ready') or not(coalesce(a.expires_at>now(),false) or (a.state='ready' and private.asset_bound(a.id))) then raise exception 'REQUEST_EXPIRED';end if;
 else
  perform private.check_writes();
  if (select count(*) from private.media_assets where profile_id=actor and state='reserved')>=2 then raise exception 'QUOTA_EXCEEDED';end if;
  if (select count(*) from private.media_assets m where m.profile_id=actor and m.purpose='animal' and m.animal_id=p_animal_id and m.animal_role=p_role and m.state<>'delete_pending' and not private.asset_bound(m.id))>=1 then raise exception 'QUOTA_EXCEEDED';end if;
  if exists(select 1 from private.storage_usage where profile_id=actor and reserved_bytes+stored_bytes+budget>limit_bytes) or exists(select 1 from private.project_budget where id=1 and media_reserved_bytes+media_stored_bytes+budget>media_limit_bytes) then raise exception 'QUOTA_EXCEEDED';end if;
  asset:=gen_random_uuid();
  insert into private.media_assets(id,profile_id,animal_id,purpose,animal_role,reservation_bytes,cleanup_after) values(asset,actor,p_animal_id,'animal',p_role,budget,clock_timestamp()+interval '2 hours 5 minutes') returning * into a;
  insert into private.media_objects(asset_id,profile_id,variant,object_path,byte_size) values(asset,actor,'original_display',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',225280),(asset,actor,'thumbnail',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',81920);
  update private.storage_usage set reserved_bytes=reserved_bytes+budget where profile_id=actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes+budget where id=1;
  perform private.record_receipt(actor,p_request_id,'reserve_parent_photo',hash,jsonb_build_object('id',asset));
 end if;
 if a.state='reserved' then perform private.check_writes();end if;
 select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) into manifest from private.media_objects where asset_id=asset;
 return jsonb_build_object('asset_id',asset,'objects',manifest,'ready',a.state='ready','expires_at',a.expires_at,'server_now',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION api.reserve_photo_edit (
  p_animal_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor(); asset uuid:=gen_random_uuid(); budget bigint:=450560; manifest jsonb;
begin
  perform private.check_writes();
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  perform 1 from public.profiles where id=actor for update;
  if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.media_assets where profile_id=actor and state='reserved')>=2 then raise exception 'QUOTA_EXCEEDED'; end if;
  if (select count(*) from private.media_assets m where m.animal_id=p_animal_id and m.animal_role='self' and m.state<>'delete_pending' and not exists(select 1 from public.animal_photos p where p.asset_id=m.id))>=3 then raise exception 'QUOTA_EXCEEDED'; end if;
  if exists(select 1 from private.storage_usage where profile_id=actor and reserved_bytes+stored_bytes+budget>limit_bytes) or exists(select 1 from private.project_budget where id=1 and media_reserved_bytes+media_stored_bytes+budget>media_limit_bytes) then raise exception 'QUOTA_EXCEEDED'; end if;
  if not private.has_required_consents(actor) then raise exception 'CONSENT_REQUIRED'; end if;
  insert into private.media_assets(id,profile_id,animal_id,reservation_bytes,cleanup_after) values(asset,actor,p_animal_id,budget,clock_timestamp()+interval '2 hours 5 minutes');
  insert into private.media_objects(asset_id,profile_id,variant,object_path,byte_size)
    values(asset,actor,'original_display',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',225280),
          (asset,actor,'thumbnail',actor||'/'||asset||'/'||gen_random_uuid()||'.webp',81920);
  update private.storage_usage set reserved_bytes=reserved_bytes+budget where profile_id=actor;
  update private.project_budget set media_reserved_bytes=media_reserved_bytes+budget where id=1;
  select jsonb_agg(jsonb_build_object('path',object_path,'variant',variant)) into manifest from private.media_objects where asset_id=asset;
  return jsonb_build_object('asset_id',asset,'objects',manifest);
end $function$;

CREATE OR REPLACE FUNCTION api.reserve_upload (
  p_animal_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=private.write_actor(); asset uuid:=gen_random_uuid(); budget bigint:=307200; manifest jsonb;
begin
  perform private.check_writes();
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  perform 1 from public.profiles where id=actor for update;
  if not exists(select 1 from public.animals where id=p_animal_id and profile_id=actor) then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from private.media_assets where profile_id=actor and state='reserved')>=2 then raise exception 'QUOTA_EXCEEDED'; end if;
  if (select count(*) from private.media_assets where animal_id=p_animal_id and animal_role='self' and state<>'delete_pending')>=3 then raise exception 'QUOTA_EXCEEDED'; end if;
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

CREATE OR REPLACE FUNCTION api.save_animal_details (
  p_animal_id  uuid,
  p_data       jsonb,
  p_assets     jsonb,
  p_parents    jsonb,
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
  adopted date; father uuid;mother uuid;old_father uuid;old_mother uuid;parents uuid[]; key text;
begin
  actor := private.write_actor();
  perform 1 from private.project_budget where id=1 for update;
  perform 1 from private.storage_usage where profile_id=actor for update;
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  -- Match existing owner commands: serialize profile, receipts and revision together.
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not private.has_required_consents(actor) then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if not exists(select 1 from public.animals where id = p_animal_id and profile_id = actor) then
    raise exception 'NOT_FOUND';
  end if;
  request_hash := md5(jsonb_build_object('animal_id', p_animal_id, 'data', p_data, 'assets', p_assets, 'parents',p_parents)::text);
  select * into receipt from private.mutation_receipts where actor_id = actor and request_id = p_request_id;
  if found then
    if receipt.operation <> 'save_animal_details' or receipt.request_hash <> request_hash then
      raise exception 'REQUEST_CONFLICT';
    end if;
    if receipt.expires_at <= now() then raise exception 'REQUEST_EXPIRED'; end if;
    return receipt.result_ref;
  end if;
  perform private.lock_profile(p_expected);
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
  if not (p_data ?& array['name','species','morph','sex','birth_date','adoption_date','description','listing_status'])
     or (p_data - array['name','species','morph','sex','birth_date','adoption_date','description','listing_status']) <> '{}'::jsonb then
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
  adopted:=private.animal_date(p_data->'adoption_date');
  if adopted is not null and birthday is not null and adopted<birthday then raise exception 'VALIDATION_FAILED';end if;
  if jsonb_typeof(p_parents) is distinct from 'object' or not(p_parents?&array['father','mother']) or (p_parents-array['father','mother'])<>'{}'::jsonb then raise exception 'VALIDATION_FAILED';end if;
  foreach key in array array['father','mother'] loop
   if jsonb_typeof(p_parents->key) is distinct from 'null' and (jsonb_typeof(p_parents->key) is distinct from 'string' or (p_parents->>key)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'VALIDATION_FAILED';end if;
  end loop;
  father:=(p_parents->>'father')::uuid;mother:=(p_parents->>'mother')::uuid;parents:=array_remove(array[father,mother],null);
  select father_asset_id,mother_asset_id into old_father,old_mother from public.animals where id=p_animal_id and profile_id=actor;
  if jsonb_typeof(p_assets) is distinct from 'array' or jsonb_array_length(p_assets)>3 then raise exception 'VALIDATION_FAILED'; end if;
  if exists(select 1 from jsonb_array_elements(p_assets) x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'VALIDATION_FAILED'; end if;
  select coalesce(array_agg(x::uuid order by ord),'{}'::uuid[]) into assets from jsonb_array_elements_text(p_assets) with ordinality as e(x,ord);
  if cardinality(assets)<>(select count(distinct x) from unnest(assets) x) then raise exception 'VALIDATION_FAILED'; end if;
  -- Upload and cleanup lock assets after the profile/budget locks. No external IO here.
  perform 1 from private.media_assets where id=any(assets||parents) order by id for update;
  if exists(select 1 from unnest(assets) x where not exists(select 1 from private.media_assets m
    where m.id=x and m.profile_id=actor and m.animal_id=p_animal_id and m.purpose='animal' and m.animal_role='self' and m.state='ready'
      and m.verified_at is not null and (m.expires_at is null or m.expires_at>now())
      and (select count(*) from private.media_objects o where o.asset_id=m.id and o.state='stored')=2)) then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from (values(father,'father'),(mother,'mother')) as requested(asset,role) where requested.asset is not null and not exists(select 1 from private.media_assets m where m.id=requested.asset and m.profile_id=actor and m.animal_id=p_animal_id and m.purpose='animal' and m.animal_role=requested.role and m.state='ready' and m.verified_at is not null and (m.expires_at is null or m.expires_at>now()) and(select count(*)from private.media_objects o where o.asset_id=m.id and o.state='stored')=2)) then raise exception 'NOT_FOUND';end if;
  select coalesce(array_agg(asset_id order by sort_order),'{}'::uuid[]) into previous_assets from public.animal_photos where animal_id=p_animal_id and profile_id=actor;
  if not (select writes_enabled from private.project_budget where id=1) then
    if assets is distinct from array(select x from unnest(previous_assets) x where x=any(assets))
      or not exists(select 1 from public.animals a where a.id=p_animal_id and a.profile_id=actor
        and a.name=animal_name and a.species=animal_species and a.morph=animal_morph
        and a.sex=p_data->>'sex' and a.birth_date is not distinct from birthday
        and a.description=animal_description and a.listing_status=p_data->>'listing_status' and a.adoption_date is not distinct from adopted and (father is null or father is not distinct from old_father) and (mother is null or mother is not distinct from old_mother))
    then raise exception 'SERVICE_UNAVAILABLE'; end if;
  end if;
  delete from public.animal_photos where animal_id=p_animal_id and profile_id=actor;
  insert into public.animal_photos(profile_id,animal_id,asset_id,sort_order)
    select actor,p_animal_id,x,(ord-1)::integer from unnest(assets) with ordinality as e(x,ord);
  update private.media_assets set expires_at=null where id=any(assets||parents);
  update private.media_assets set state='delete_pending',expires_at=now(),cleanup_after=coalesce(cleanup_after,clock_timestamp()+interval '2 hours 5 minutes') where id=any(previous_assets||array_remove(array[old_father,old_mother],null)) and not(id=any(assets||parents));
  update public.animals set name = animal_name, species = animal_species, morph = animal_morph,
    sex = p_data->>'sex', birth_date = birthday, description = animal_description,
    listing_status = p_data->>'listing_status', adoption_date=adopted,father_asset_id=father,mother_asset_id=mother,updated_at = now()
    where id = p_animal_id and profile_id = actor;
  result := jsonb_build_object('id', p_animal_id, 'revision', private.bump(actor));
  perform private.record_receipt(actor,p_request_id,'save_animal_details',request_hash,result);
  return result;
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
  actor := private.write_actor();
  perform 1 from private.storage_usage where profile_id=actor for update;
  if p_animal_id is null or p_request_id is null then raise exception 'VALIDATION_FAILED'; end if;
  -- Match existing owner commands: serialize profile, receipts and revision together.
  perform 1 from public.profiles where id = actor for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not private.has_required_consents(actor) then
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
    where m.id=x and m.profile_id=actor and m.animal_id=p_animal_id and m.purpose='animal' and m.animal_role='self' and m.state='ready'
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
  perform private.record_receipt(actor,p_request_id,'save_animal_edit',request_hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION private.animal_date (
  value jsonb
)
  RETURNS date
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare result date;
begin
 if jsonb_typeof(value)='null' then return null;end if;
 if jsonb_typeof(value) is distinct from 'string' or (value#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'VALIDATION_FAILED';end if;
 begin result:=(value#>>'{}')::date;exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_FAILED';end;
 if not isfinite(result) or result<date '0001-01-01' or result>date '9999-12-31' or result>(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception 'VALIDATION_FAILED';end if;
 return result;
end$function$;

CREATE OR REPLACE FUNCTION private.asset_bound (
  asset uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select exists(select 1 from public.profiles where avatar_asset_id=asset or cover_asset_id=asset)
 or exists(select 1 from public.animal_photos where asset_id=asset)
 or exists(select 1 from public.animals where father_asset_id=asset or mother_asset_id=asset);
$function$;

CREATE OR REPLACE FUNCTION private.validate_animal_parents()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare asset uuid;role text;
begin
 perform private.animal_date(coalesce(to_jsonb(new.adoption_date),'null'::jsonb));
 if new.adoption_date is not null and new.birth_date is not null and new.adoption_date<new.birth_date then raise exception 'VALIDATION_FAILED';end if;
 for asset,role in select new.father_asset_id,'father' union all select new.mother_asset_id,'mother' loop
  if asset is not null and not exists(select 1 from private.media_assets m where m.id=asset and m.profile_id=new.profile_id and m.animal_id=new.id and m.purpose='animal' and m.animal_role=role and m.state='ready' and m.verified_at is not null and (m.expires_at is null or m.expires_at>now()) and (select count(*)from private.media_objects o where o.asset_id=m.id and o.state='stored')=2) then raise exception 'NOT_FOUND';end if;
 end loop;
 return new;
end$function$;

CREATE OR REPLACE FUNCTION private.validate_self_photo()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
 if not exists(select 1 from private.media_assets m where m.id=new.asset_id and m.profile_id=new.profile_id and m.animal_id=new.animal_id and m.purpose='animal' and m.animal_role='self') then raise exception 'NOT_FOUND';end if;
 return new;
end$function$;

ALTER TABLE "private"."media_assets"
  ADD CONSTRAINT "media_animal_role"
    CHECK (((animal_role = ANY (ARRAY['self'::text, 'father'::text, 'mother'::text])) AND ((purpose = 'animal'::text) OR (animal_role = 'self'::text))));

ALTER TABLE "public"."animals"
  ADD CONSTRAINT "animal_adoption_valid"
    CHECK
    (((adoption_date IS NULL) OR (isfinite(adoption_date) AND ((adoption_date >= '0001-01-01'::date) AND (adoption_date <= '9999-12-31'::date)) AND ((birth_date IS NULL) OR
    (adoption_date >= birth_date)))));

ALTER TABLE "public"."animals"
  ADD CONSTRAINT "animal_father_asset_owner" FOREIGN KEY (father_asset_id, profile_id) REFERENCES private.media_assets(id, profile_id) ON DELETE RESTRICT;

ALTER TABLE "public"."animals"
  ADD CONSTRAINT "animal_mother_asset_owner" FOREIGN KEY (mother_asset_id, profile_id) REFERENCES private.media_assets(id, profile_id) ON DELETE RESTRICT;

CREATE INDEX animal_father_asset_idx ON public.animals USING btree (father_asset_id)
  WHERE (father_asset_id IS NOT NULL);

CREATE INDEX animal_mother_asset_idx ON public.animals USING btree (mother_asset_id)
  WHERE (mother_asset_id IS NOT NULL);

CREATE TRIGGER photo_self_role
  BEFORE INSERT OR UPDATE ON public.animal_photos
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_self_photo();

CREATE TRIGGER animal_parent_adoption_valid
  BEFORE INSERT OR UPDATE OF adoption_date, birth_date, father_asset_id, mother_asset_id ON public.animals
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_animal_parents();

REVOKE ALL ON FUNCTION "api"."cancel_parent_photo_request"(uuid, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."cancel_parent_photo_request"(uuid, text, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."reserve_parent_photo"(uuid, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."reserve_parent_photo"(uuid, text, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "api"."save_animal_details"(uuid, jsonb, jsonb, jsonb, bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "api"."save_animal_details"(uuid, jsonb, jsonb, jsonb, bigint, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."animal_date"(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."asset_bound"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."validate_animal_parents"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."validate_self_photo"() FROM PUBLIC;
