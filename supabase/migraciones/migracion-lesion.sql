-- Ranking ATC · opción «Lesionado»
-- Pégalo en Supabase > SQL Editor y pulsa Run. Se puede ejecutar más de una vez.
alter table players add column if not exists injured_until date;

-- Comprobación: debe salir 0
select count(*) as lesionados from players where injured_until is not null;
