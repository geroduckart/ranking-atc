-- Ranking ATC · Posponer un partido (mal tiempo o acuerdo mutuo)
-- Ejecutar en Supabase (SQL Editor) ANTES de subir los archivos nuevos.
alter table challenges add column if not exists post_at timestamp;        -- nueva fecha propuesta (hora del club)
alter table challenges add column if not exists post_by uuid references players(id) on delete set null;
alter table challenges add column if not exists post_reason text check (post_reason in ('weather','mutual'));
