create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists lifetrail_push;
revoke all on schema lifetrail_push from public,anon,authenticated;
create table lifetrail_push.config (
 id boolean primary key default true check(id),
 vapid jsonb,
 cron_token text not null default encode(extensions.gen_random_bytes(32),'hex'),
 pair_hash text,
 pair_until timestamptz
);
insert into lifetrail_push.config(id) values(true);
create table lifetrail_push.devices (
 id uuid primary key,
 token_hash text not null,
 subscription jsonb not null,
 timezone text not null default 'America/Sao_Paulo',
 schedule jsonb not null default '[]',
 updated_at timestamptz not null default now(),
 active boolean not null default true
);
create table lifetrail_push.deliveries (
 device uuid not null references lifetrail_push.devices(id) on delete cascade,
 event text not null,
 day text not null,
 state text not null default 'sending',
 attempts int not null default 1,
 lease_until timestamptz not null default now()+interval '90 seconds',
 sent_at timestamptz,
 error_code int,
 primary key(device,event,day)
);
create table lifetrail_push.tests (
 id uuid primary key default gen_random_uuid(),
 device uuid not null references lifetrail_push.devices(id) on delete cascade,
 due timestamptz not null default now()+interval '2 minutes',
 payload jsonb not null,
 sent boolean not null default false
);
create table lifetrail_push.rates (
 bucket text primary key,
 count int not null default 1,
 expires timestamptz not null
);
alter table lifetrail_push.config enable row level security;
alter table lifetrail_push.devices enable row level security;
alter table lifetrail_push.deliveries enable row level security;
alter table lifetrail_push.tests enable row level security;
alter table lifetrail_push.rates enable row level security;
revoke all on all tables in schema lifetrail_push from public,anon,authenticated;
