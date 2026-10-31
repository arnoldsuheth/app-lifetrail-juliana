select cron.schedule(
'lifetrail-juliana-push-every-minute',
'* * * * *',
$job$
select net.http_post(
 url:='https://mgqwzaizkllkqqqbbcna.supabase.co/functions/v1/lifetrail-juliana-push/dispatch',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select cron_token from lifetrail_push.config where id=true)),
 body:='{}'::jsonb,
 timeout_milliseconds:=30000
);
$job$);
select net.http_post(
 url:='https://mgqwzaizkllkqqqbbcna.supabase.co/functions/v1/lifetrail-juliana-push/dispatch',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select cron_token from lifetrail_push.config where id=true)),
 body:='{}'::jsonb,
 timeout_milliseconds:=30000
) as verification_request;
