-- Drain every eligible category in 500-row transactions; keep the hourly job.
SELECT cron.schedule('reptilelink-activity-retention','17 * * * *',$job$
DO $retention$
DECLARE cleanup_actor uuid := NULL; result jsonb;
BEGIN
 LOOP
  PERFORM pg_catalog.set_config('search_path','',true);
  result := private.prune_activity(cleanup_actor);
  COMMIT;
  EXIT WHEN (result->>'comments')::integer < 500
    AND (result->>'notifications')::integer < 500
    AND (result->>'reports')::integer < 500
    AND (result->>'buckets')::integer < 500;
 END LOOP;
 IF cleanup_actor IS NULL THEN
  DELETE FROM cron.job_run_details
  WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='reptilelink-activity-retention')
    AND end_time < pg_catalog.now()-interval '7 days';
  COMMIT;
 END IF;
END $retention$;
$job$);
