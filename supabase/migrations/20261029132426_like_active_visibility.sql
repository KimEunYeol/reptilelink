SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION api.my_existing_profile_like (
  p_slug text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 SELECT jsonb_build_object('liked',private.active(auth.uid()) AND EXISTS(SELECT 1 FROM private.profile_likes l JOIN public.profiles p ON p.id=l.profile_id WHERE l.actor_id=auth.uid() AND p.slug=p_slug),'can_cancel',coalesce(private.activity_member(auth.uid()),false),'signed_in',auth.uid() IS NOT NULL);
$function$;

CREATE OR REPLACE FUNCTION api.public_profile_likes (
  p_slug text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE p public.profiles;actor uuid:=auth.uid();BEGIN
 SELECT * INTO p FROM public.profiles WHERE slug=p_slug AND is_published AND private.active(id);IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('count',(SELECT count(*) FROM private.profile_likes WHERE profile_id=p.id),'liked',private.active(actor) AND EXISTS(SELECT 1 FROM private.profile_likes WHERE profile_id=p.id AND actor_id=actor),'ready',coalesce(private.activity_member(actor),false),'signed_in',actor IS NOT NULL,'is_owner',coalesce(actor=p.id,false));
END $function$;
