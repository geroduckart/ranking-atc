-- Ranking ATC · Máximo 4 partidos a la vez (4 pistas) + motivo «no hay pista» al posponer
-- Ejecutar en Supabase (SQL Editor) ANTES de subir los archivos nuevos. Se puede ejecutar varias veces.
alter table challenges drop constraint if exists challenges_post_reason_check;
alter table challenges add constraint challenges_post_reason_check check (post_reason in ('weather','mutual','court'));
create index if not exists challenges_play_at_accepted on challenges (play_at) where status = 'accepted';
