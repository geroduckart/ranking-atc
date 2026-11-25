-- Ranking ATC · Quién lleva bolas / quién reserva pista + chat de cada partido
-- Ejecutar en Supabase (SQL Editor) ANTES de subir los archivos nuevos.

-- Lo que pone quien reta: 'balls' = lleva bolas (el otro reserva pista) · 'court' = reserva pista (el otro lleva bolas)
alter table challenges add column if not exists duty text check (duty in ('balls','court'));
-- Hasta dónde ha leído cada uno el chat
alter table challenges add column if not exists seen_a timestamptz;   -- quien reta
alter table challenges add column if not exists seen_b timestamptz;   -- el retado

create table if not exists chat (
  id           bigserial primary key,
  challenge_id bigint not null references challenges(id) on delete cascade,
  sender       uuid references players(id) on delete set null,
  body         text not null check (char_length(body) between 1 and 500),
  created_at   timestamptz not null default now()
);
create index if not exists chat_challenge on chat (challenge_id, id);
alter table chat enable row level security;
