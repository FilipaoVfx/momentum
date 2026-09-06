-- Esquema inicial de Momentum.
--
-- Tres invariantes que se aplican aquí y no por convención (ARD §6):
--   1. El crudo se guarda junto al computado: `source_snapshot` con hash y
--      timestamp de captura (ADR-007, M§9, M§18).
--   2. Ninguna fila producida existe sin `score_version` (FR-051).
--   3. Ninguna métrica existe sin el camino de vuelta a sus insumos (M§7).

-- +migrate up

create table narrative (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  name               text not null,
  status             text not null default 'active' check (status in ('active', 'retired')),
  dictionary_version text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table narrative_entity (
  id           uuid primary key default gen_random_uuid(),
  narrative_id uuid not null references narrative (id) on delete cascade,
  kind         text not null check (kind in ('defillama_protocol', 'subreddit', 'polymarket_tag', 'ticker')),
  value        text not null,
  unique (narrative_id, kind, value)
);
create index narrative_entity_kind_idx on narrative_entity (kind, value);

-- Corridas del plano frío. El estado vive en Postgres, no en memoria del worker.
create table run (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('ingest', 'replay', 'outcomes', 'discovery')),
  mode          text not null check (mode in ('live', 'replay')),
  score_version text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running', 'ok', 'failed'))
);

-- Toda respuesta de fuente que llegamos a recibir se guarda sin transformar.
-- Es lo que hace posible el replay y el modo sombra sin volver a pagar las APIs.
create table source_snapshot (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null,
  endpoint           text not null,
  request_key        text not null,
  http_status        int,
  latency_ms         int not null,
  payload            jsonb not null,
  content_hash       bytea not null,
  fetched_at         timestamptz not null,
  source_reliability char(1) not null check (source_reliability in ('A','B','C','D','E','F')),
  data_credibility   smallint not null check (data_credibility between 1 and 6),
  -- La corrida a la que perteneció. Es lo que permite al replay reconstruir las
  -- mismas ventanas que produjo la corrida original, en vez de inventarse otras.
  run_id             uuid references run (id) on delete set null
);
create index source_snapshot_source_time_idx on source_snapshot (source, fetched_at desc);
create index source_snapshot_request_idx on source_snapshot (request_key, fetched_at desc);
create index source_snapshot_run_idx on source_snapshot (run_id);

-- Tabla de eventos: crece rápido, se particiona por tiempo desde el día uno
-- (ARD §6). `root_origin_key` es la clave de deduplicación por origen (M§17).
create table mention_event (
  id                 uuid not null default gen_random_uuid(),
  narrative_id       uuid not null references narrative (id) on delete cascade,
  source             text not null,
  signal_kind        text not null check (signal_kind in ('prediction_market_position', 'reddit_post', 'reddit_comment')),
  root_origin_key    text not null,
  replicator_key     text not null,
  observed_at        timestamptz not null,
  author_has_history boolean,          -- null = no lo sabemos; nunca se rellena
  magnitude          numeric not null default 0,
  snapshot_id        uuid not null references source_snapshot (id),
  primary key (id, observed_at),
  unique (narrative_id, source, replicator_key, observed_at)
) partition by range (observed_at);

create index mention_event_origin_idx on mention_event (narrative_id, observed_at desc, root_origin_key);

-- Crea la partición mensual que contenga `p_at` si aún no existe.
create or replace function ensure_mention_event_partition(p_at timestamptz)
returns void language plpgsql as $$
declare
  start_ts date := date_trunc('month', p_at at time zone 'UTC')::date;
  end_ts   date := (date_trunc('month', p_at at time zone 'UTC') + interval '1 month')::date;
  part     text := format('mention_event_%s', to_char(start_ts, 'YYYYMM'));
begin
  if to_regclass(part) is null then
    execute format(
      'create table %I partition of mention_event for values from (%L) to (%L)',
      part, start_ts, end_ts);
  end if;
end $$;

-- Eje de fundamento. Es a `metric_point` lo que `mention_event` al eje de
-- atención: la observación por entidad, con su snapshot, antes de agregar.
-- Volumen mucho menor que las menciones, así que no se particiona todavía.
create table fundamental_observation (
  id             uuid primary key default gen_random_uuid(),
  narrative_id   uuid not null references narrative (id) on delete cascade,
  source         text not null,
  entity         text not null,
  observed_at    timestamptz not null,
  tvl_usd        numeric,
  fees_24h_usd   numeric,
  volume_24h_usd numeric,
  snapshot_id    uuid not null references source_snapshot (id),
  unique (narrative_id, source, entity, observed_at)
);
create index fundamental_observation_series_idx
  on fundamental_observation (narrative_id, observed_at desc);

create table metric_point (
  id                 uuid primary key default gen_random_uuid(),
  narrative_id       uuid not null references narrative (id) on delete cascade,
  axis               text not null check (axis in ('attention', 'fundamental')),
  window_label       text not null check (window_label in ('1h', '24h', '7d')),
  observed_at        timestamptz not null,
  value              numeric not null,
  score_version      text not null,
  input_snapshot_ids uuid[] not null check (cardinality(input_snapshot_ids) > 0),
  computed_at        timestamptz not null default now(),
  unique (narrative_id, axis, window_label, observed_at, score_version)
);
create index metric_point_series_idx on metric_point (narrative_id, axis, window_label, score_version, observed_at desc);

create table quadrant_state (
  id                uuid primary key default gen_random_uuid(),
  narrative_id      uuid not null references narrative (id) on delete cascade,
  quadrant          text not null check (quadrant in ('confirmed', 'pure_narrative', 'quiet_build', 'dead')),
  attention_slope   numeric not null,
  fundamental_slope numeric not null,
  score_version     text not null,
  started_at        timestamptz not null,
  ended_at          timestamptz,
  check (ended_at is null or ended_at > started_at)
);
-- Un solo estado abierto por narrativa y versión de score.
create unique index quadrant_state_open_idx
  on quadrant_state (narrative_id, score_version) where ended_at is null;
create index quadrant_state_history_idx on quadrant_state (narrative_id, started_at desc);

create table outcome (
  id                 uuid primary key default gen_random_uuid(),
  quadrant_state_id  uuid not null references quadrant_state (id) on delete cascade,
  horizon_days       smallint not null check (horizon_days in (7, 14, 30)),
  verdict            text not null check (verdict in ('confirmed', 'refuted', 'inconclusive', 'insufficient_data')),
  attention_change   numeric,
  fundamental_change numeric,
  score_version      text not null,
  evaluated_at       timestamptz not null default now(),
  unique (quadrant_state_id, horizon_days, score_version)
);

-- Lo que no vimos, declarado (M§23, FR-014).
create table collection_gap (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references run (id) on delete cascade,
  source       text not null,
  narrative_id uuid references narrative (id) on delete cascade,
  reason       text not null check (reason in ('source_down', 'timeout', 'rate_limited', 'circuit_open', 'parse_failed', 'window_not_covered', 'not_configured')),
  detail       text not null,
  window_start timestamptz,
  window_end   timestamptz,
  created_at   timestamptz not null default now()
);
create index collection_gap_run_idx on collection_gap (run_id);

-- Un token sin narrativa se declara sin narrativa; no se le asigna la más
-- cercana (FR-007).
create table token (
  id                   uuid primary key default gen_random_uuid(),
  chain                text not null,
  address              text not null,
  symbol               text,
  narrative_id         uuid references narrative (id) on delete set null,
  narrative_resolution text not null check (narrative_resolution in ('resolved', 'unresolved')),
  updated_at           timestamptz not null default now(),
  unique (chain, address),
  check (
    (narrative_resolution = 'resolved' and narrative_id is not null) or
    (narrative_resolution = 'unresolved' and narrative_id is null)
  )
);

-- +migrate down

drop table if exists token;
drop table if exists collection_gap;
drop table if exists outcome;
drop table if exists quadrant_state;
drop table if exists metric_point;
drop table if exists fundamental_observation;
drop function if exists ensure_mention_event_partition(timestamptz);
drop table if exists mention_event;
drop table if exists source_snapshot;
drop table if exists run;
drop table if exists narrative_entity;
drop table if exists narrative;
