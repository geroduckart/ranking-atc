-- ════════════════════════════════════════════════════════════════════
--  Ranking ATC — esquema de base de datos (Supabase / PostgreSQL)
--  Pégalo entero en Supabase → SQL Editor → New query → Run.
--  Se puede ejecutar más de una vez sin romper nada.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists citext;

-- Temporada (una sola fila)
create table if not exists season (
  id           int primary key default 1 check (id = 1),
  name         text not null default 'Temporada 1',
  starts_on    date not null default current_date,
  ends_on      date not null default (current_date + 59),   -- fin de la fase regular (60 días)
  masters_end  date not null default (current_date + 73),  -- Másters: 2 semanas después
  phase        text not null default 'regular' check (phase in ('regular','masters','closed')),
  min_matches  int  not null default 5
);
insert into season (id) values (1) on conflict (id) do nothing;

-- Jugadores
create table if not exists players (
  id              uuid primary key default gen_random_uuid(),
  username        citext unique not null check (username ~ '^[a-z0-9._]{3,20}$'),
  full_name       text not null check (char_length(full_name) between 3 and 60),
  email           citext unique not null,
  pin_hash        text not null,
  session_v       int  not null default 1,
  birth_date      date not null,
  hand            text not null default 'diestro' check (hand in ('diestro','zurdo')),
  backhand        text not null default 'dos'     check (backhand in ('una','dos')),
  attrs           jsonb not null,               -- valoración inicial: derecha, reves, slice, saque, velocidad
  start_level     numeric(5,2) not null,        -- media inicial (la puede corregir el admin)
  level           numeric(5,2) not null,        -- nivel actual (lo recalcula la app)
  photo           text,                         -- foto pequeña (data URL)
  photo_v         int not null default 0,
  is_admin        boolean not null default false,
  active          boolean not null default true,
  muted           boolean not null default false,  -- no puede comentar en el tablón
  notify          jsonb not null default '{}'::jsonb,
  last_drop_mail  date,
  failed_logins   int not null default 0,
  locked_until    timestamptz,
  reset_hash      text,
  reset_expires   timestamptz,
  created_at      timestamptz not null default now()
);

-- Retos
create table if not exists challenges (
  id           bigserial primary key,
  challenger   uuid not null references players(id) on delete cascade,
  challenged   uuid not null references players(id) on delete cascade,
  play_at      timestamp not null,          -- hora local del club (Madrid)
  proposed_by  uuid not null references players(id) on delete cascade,
  counters     int not null default 0,
  message      text,
  status       text not null default 'pending'
               check (status in ('pending','accepted','rejected','expired','cancelled','done')),
  responded_by uuid references players(id) on delete set null,
  walkover     boolean not null default false,
  token        text,
  reminded     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (challenger <> challenged)
);
create index if not exists challenges_open on challenges (status);

-- Cuadros de los Másters (un nodo = un partido del cuadro)
create table if not exists masters (
  id      bigserial primary key,
  tier    text not null check (tier in ('oro','plata','bronce','challenger')),
  round   int  not null,         -- 1 = primera ronda
  slot    int  not null,
  p1      uuid references players(id) on delete set null,
  p2      uuid references players(id) on delete set null,
  seed1   int,
  seed2   int,
  winner  uuid references players(id) on delete set null,
  unique (tier, round, slot)
);

-- Partidos (resultados)
create table if not exists matches (
  id           bigserial primary key,
  challenge_id bigint references challenges(id) on delete set null,
  master_id    bigint references masters(id) on delete set null,
  p1           uuid not null references players(id) on delete cascade,
  p2           uuid not null references players(id) on delete cascade,
  sets         jsonb not null,           -- [[6,4],[7,5]] desde el punto de vista de p1
  winner       uuid not null references players(id) on delete cascade,
  walkover     boolean not null default false,
  reported_by  uuid references players(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending','confirmed','disputed','annulled')),
  token        text,
  played_on    date not null default current_date,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  -- calculados por la app al confirmar
  p1_before numeric(5,2), p1_after numeric(5,2),
  p2_before numeric(5,2), p2_after numeric(5,2),
  p1_pts int, p2_pts int
);
create index if not exists matches_status on matches (status);

-- Tablón
create table if not exists feed (
  id         bigserial primary key,
  kind       text not null,             -- new_player, challenge, accepted, result, walkover, admin, masters
  actor      uuid references players(id) on delete set null,
  target     uuid references players(id) on delete set null,
  data       jsonb not null default '{}'::jsonb,
  body       text,
  created_at timestamptz not null default now()
);
create table if not exists comments (
  id         bigserial primary key,
  post_id    bigint not null references feed(id) on delete cascade,
  author     uuid references players(id) on delete set null,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists comments_post on comments (post_id);
create table if not exists likes (
  post_id    bigint not null references feed(id) on delete cascade,
  player     uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, player)
);

-- Seguridad: nadie entra a las tablas desde fuera. Solo la app (desde Netlify) con la conexión directa.
alter table season     enable row level security;
alter table players    enable row level security;
alter table challenges enable row level security;
alter table masters    enable row level security;
alter table matches    enable row level security;
alter table feed       enable row level security;
alter table comments   enable row level security;
alter table likes      enable row level security;

-- Cartas antiguas (1.er y 2.º servicio) → servicio + velocidad, sin cambiar el nivel.
update players set attrs = (attrs - 'saque1' - 'saque2') || jsonb_build_object(
    'saque', round(((attrs->>'saque1')::numeric + (attrs->>'saque2')::numeric) / 2),
    'velocidad', least(99, greatest(30, (attrs->>'saque1')::int + (attrs->>'saque2')::int - round(((attrs->>'saque1')::numeric + (attrs->>'saque2')::numeric) / 2)::int)))
  where attrs ? 'saque1';

-- Idioma de cada jugador (app y emails): 'es' o 'en'.
alter table players add column if not exists lang text not null default 'es';
