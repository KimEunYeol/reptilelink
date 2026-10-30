BEGIN;
INSERT INTO private.recovery_settings DEFAULT VALUES ON CONFLICT(id)DO NOTHING;
INSERT INTO private.account_withdrawals(user_id,requested_at) SELECT user_id,requested_at FROM private.account_deletions ON CONFLICT(user_id)DO NOTHING;
DO $cron_update$
DECLARE stored text; job bigint; marker text:='  EXIT WHEN (result->>''receipts'')::integer < 500;';
BEGIN
 SELECT jobid,command INTO STRICT job,stored FROM cron.job WHERE jobname='reptilelink-activity-retention';
 IF strpos(stored,'''withdrawals''')>0 THEN RETURN; END IF;
 IF strpos(stored,marker)=0 THEN RAISE EXCEPTION 'Unexpected receipt retention command'; END IF;
 stored:=replace(stored,marker,'  EXIT WHEN (result->>''receipts'')::integer < 500 AND (result->>''withdrawals'')::integer < 500;');
 PERFORM cron.alter_job(job,command:=stored);
END $cron_update$;
COMMIT;
