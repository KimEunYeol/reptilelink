-- Data-only upgrade: the schema diff cannot carry existing invitation bindings.
-- Lock referenced Auth users first, matching signup/final Auth deletion order.
WITH existing_invites AS MATERIALIZED (
  SELECT u.id, a.normalized_email
  FROM auth.users u
  JOIN private.signup_allowlist a ON a.normalized_email = lower(trim(u.email))
  WHERE a.invited_user_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM auth.users other_user
      WHERE other_user.id <> u.id
        AND lower(trim(other_user.email)) = a.normalized_email
    )
  FOR KEY SHARE OF u
)
UPDATE private.signup_allowlist a
SET invited_user_id = existing_invites.id
FROM existing_invites
WHERE a.normalized_email = existing_invites.normalized_email
  AND a.invited_user_id IS NULL;
