-- La comprobación de existencia de la partición miraba `to_regclass(nombre)`,
-- que resuelve contra el `search_path` completo. Compartiendo Postgres con otro
-- proyecto —que es justo para lo que existe `DB_SCHEMA`— encontraba una
-- partición homónima en `public`, se saltaba la creación, y el insert fallaba
-- con "no partition of relation found for row".
--
-- La existencia se comprueba ahora en el esquema actual y nada más.

-- +migrate up

create or replace function ensure_mention_event_partition(p_at timestamptz)
returns void language plpgsql as $$
declare
  start_ts date := date_trunc('month', p_at at time zone 'UTC')::date;
  end_ts   date := (date_trunc('month', p_at at time zone 'UTC') + interval '1 month')::date;
  part     text := format('mention_event_%s', to_char(start_ts, 'YYYYMM'));
begin
  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relname = part and n.nspname = current_schema()
  ) then
    execute format(
      'create table %I.%I partition of %I.mention_event for values from (%L) to (%L)',
      current_schema(), part, current_schema(), start_ts, end_ts);
  end if;
end $$;

-- +migrate down

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
