-- Ranking ATC · Valoración rápida después del partido + avisos privados al club
-- Ejecutar en Supabase (SQL Editor) ANTES de subir los archivos nuevos. Se puede ejecutar varias veces.
create table if not exists match_feedback (
  id         bigserial primary key,
  match_id   bigint not null references matches(id) on delete cascade,
  rater      uuid references players(id) on delete cascade,
  ratee      uuid references players(id) on delete cascade,
  tags       text[] not null default '{}',               -- fair · punctual · vibe · great
  level_cmp  text check (level_cmp in ('higher','same','lower')),   -- solo lo ve el club
  created_at timestamptz not null default now(),
  unique (match_id, rater)
);
create index if not exists match_feedback_ratee on match_feedback (ratee);
alter table match_feedback enable row level security;

create table if not exists club_reports (
  id           bigserial primary key,
  match_id     bigint references matches(id) on delete set null,
  challenge_id bigint references challenges(id) on delete set null,
  reporter     uuid references players(id) on delete set null,
  about        uuid references players(id) on delete set null,
  body         text not null check (char_length(body) between 1 and 1000),
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table club_reports enable row level security;
