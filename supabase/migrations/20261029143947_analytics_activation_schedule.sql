-- Initial local rollout and the existing single retention job, no external calls.
insert into private.analytics_settings(id,enabled)values(1,true)on conflict(id)do nothing;
DO $configure$
DECLARE job_id bigint; stored text; marker text:=E' END LOOP;\n IF cleanup_actor IS NULL THEN';
BEGIN
 SELECT jobid,command INTO job_id,stored FROM cron.job WHERE jobname='reptilelink-activity-retention';
 IF job_id IS NULL OR strpos(stored,marker)=0 THEN RAISE EXCEPTION 'RETENTION_JOB_MISSING';END IF;
 stored:=replace(stored,marker,E' END LOOP;\n LOOP\n  PERFORM pg_catalog.set_config(''search_path'','''',true);\n  result := private.prune_analytics(cleanup_actor);\n  COMMIT;\n  EXIT WHEN (result->>''receipts'')::integer < 500 AND (result->>''daily'')::integer < 500;\n END LOOP;\n IF cleanup_actor IS NULL THEN');
 PERFORM cron.alter_job(job_id,command:=stored);
END $configure$;
