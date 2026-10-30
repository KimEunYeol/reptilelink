-- Existing single hourly retention job; data configuration is absent from schema diff.
DO $update_cron$
DECLARE stored text; job bigint;
BEGIN
 SELECT jobid,command INTO STRICT job,stored FROM cron.job WHERE jobname='reptilelink-activity-retention';
 IF position('private.prune_mutation_receipts' IN stored)>0 THEN
  IF (length(stored)-length(replace(stored,'COMMIT;','')))/7<>4 THEN RAISE EXCEPTION 'Unexpected receipt retention command'; END IF;
  RETURN;
 END IF;
 IF (length(stored)-length(replace(stored,'COMMIT;','')))/7<>3 THEN RAISE EXCEPTION 'Unexpected retention command'; END IF;
 stored:=replace(stored,' IF cleanup_actor IS NULL THEN',$receipt_cron$ LOOP
  PERFORM pg_catalog.set_config('search_path','',true);
  result := private.prune_mutation_receipts(cleanup_actor);
  COMMIT;
  EXIT WHEN (result->>'receipts')::integer < 500;
 END LOOP;
 IF cleanup_actor IS NULL THEN$receipt_cron$);
 IF position('private.prune_mutation_receipts' IN stored)=0 THEN RAISE EXCEPTION 'Retention marker missing'; END IF;
 PERFORM cron.alter_job(job,command:=stored);
END $update_cron$;
