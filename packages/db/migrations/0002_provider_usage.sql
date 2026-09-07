-- Presupuesto de consumo por proveedor (NFR-061).
--
-- El contador vive en Postgres y no en memoria porque un presupuesto que se
-- olvida al reiniciar el worker no es un presupuesto: bastaría un despliegue
-- para gastar el doble de la cuota diaria sin enterarse.

-- +migrate up

create table provider_usage (
  provider   text not null,
  usage_day  date not null,
  calls      bigint not null default 0,
  -- Hasta cuándo el proveedor nos pidió no volver (Retry-After de un 429).
  cooldown_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (provider, usage_day)
);

-- Suma una llamada al día en curso y devuelve el total resultante. Atómico:
-- dos corridas solapadas no pueden leer el mismo contador y escribir el mismo
-- valor.
create or replace function bump_provider_usage(p_provider text, p_day date)
returns bigint language plpgsql as $$
declare
  total bigint;
begin
  insert into provider_usage (provider, usage_day, calls)
       values (p_provider, p_day, 1)
  on conflict (provider, usage_day) do update
       set calls = provider_usage.calls + 1, updated_at = now()
    returning calls into total;
  return total;
end $$;

-- +migrate down

drop function if exists bump_provider_usage(text, date);
drop table if exists provider_usage;
