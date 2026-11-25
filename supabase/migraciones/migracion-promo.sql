-- Ranking ATC · insignia «Pista y bolas gratis» en los 5 primeros retos aceptados
-- Pégalo en Supabase > SQL Editor y pulsa Run. Se puede ejecutar más de una vez sin problema.
alter table challenges add column if not exists promo boolean not null default false;

-- Comprobación: debe salir 0 (aún no hay retos aceptados)
select count(*) as retos_con_promo from challenges where promo;
