# Life Trail Juliana — Web Push

Backend: Supabase project mgqwzaizkllkqqqbbcna; isolated private schema lifetrail_push.
Frontend remains on GitHub Pages. No service key or VAPID private key is shipped to the browser.
The function authenticates device calls using a random per-device token (only its hash is stored).
A one-use, expiring enrollment code is issued administratively. Disabled devices require a new enrollment.

Deploy the schema once using backend/schema.sql and the Edge Function from
supabase/functions/lifetrail-juliana-push/index.js (verify_jwt=false: the function checks its own tokens).
Enable the scheduled job using backend/schedule.sql.
Postgres connection URL comes from the Supabase built-in SUPABASE_DB_URL environment variable.
Pinned runtime dependencies: postgres 3.4.5 and web-push 3.6.7.

VAPID keys are generated once by the server and stored only in the private schema.
Notification text is encrypted with a device key stored in IndexedDB. The server sees schedules
and opaque ciphertext, not appointment names. Do not clear site storage without backing up app data.

To issue a new activation code, run this SQL privately (do not commit the returned code):
WITH code AS MATERIALIZED (SELECT encode(extensions.gen_random_bytes(8),'hex') AS value)
UPDATE lifetrail_push.config
SET pair_hash=encode(extensions.digest((SELECT value FROM code),'sha256'),'hex'),
    pair_until=now()+interval '7 days'
WHERE id=true
RETURNING (SELECT value FROM code) AS activation_code;

Schedule sync happens after edits, after cloud state renders and every minute while the app is open.
Recurring routine/habit/water templates continue on the server with the app closed. Completed items
are skipped once the change has synchronized. Upcoming appointments include a 30-minute lead.
The dispatcher runs every minute, retries failed sends with leases and rejects unsafe push endpoints.
Messages have a ten-minute TTL and are not sent more than ten minutes late.
Delivery can be delayed by connectivity, Focus mode or OS settings. The app must be installed on the
Home Screen on iOS 16.4+ and notification permission must be granted by the device user.
No browser-only timer is claimed to work with the app closed.

Verification:
node tests/push.test.cjs
Also verify key/dispatch HTTP responses, private-schema grants and the active cron job.
End-to-end delivery requires an enrolled physical device: Perfil -> test -> close app -> wait up to 3 minutes.
