-- Ranking ATC · Nacionalidad en la tarjeta
-- Ejecutar en Supabase (SQL Editor) ANTES de subir los archivos nuevos.
alter table players add column if not exists nationality text;
