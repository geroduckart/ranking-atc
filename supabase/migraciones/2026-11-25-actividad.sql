-- Ranking ATC · Actividad de los jugadores (cuándo entran en la app)
-- Ejecutar en Supabase (SQL Editor) ANTES de subir. Se puede ejecutar varias veces.
alter table players add column if not exists last_seen timestamptz;
create table if not exists player_days (
  player uuid not null references players(id) on delete cascade,
  day    date not null,
  primary key (player, day)
);
alter table player_days enable row level security;
