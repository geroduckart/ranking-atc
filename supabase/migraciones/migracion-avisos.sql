-- Ranking ATC · registro de WhatsApp, empujones y copia de seguridad
-- Pégalo en Supabase > SQL Editor y pulsa Run. Se puede ejecutar más de una vez.
create table if not exists wa_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  to_phone  text,
  template  text not null,
  lang      text,
  ok        boolean not null,
  error     text
);
create index if not exists wa_log_at on wa_log (at desc);

alter table players add column if not exists last_nudge date;
alter table season  add column if not exists last_backup_at timestamptz;

-- Comprobación: debe salir 0
select count(*) as wa_log from wa_log;
