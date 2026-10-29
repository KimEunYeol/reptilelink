-- Runs inside PostgreSQL; no external HTTP service or secret is required.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'reptilelink-activity-retention',
  '17 * * * *',
  $job$SELECT private.prune_activity();
  DELETE FROM cron.job_run_details
  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'reptilelink-activity-retention')
    AND end_time < now() - interval '7 days';$job$
);
