-- Ranking ATC · columnas que faltan para WhatsApp y para el idioma.
-- Se puede ejecutar varias veces sin problema: si una columna ya existe, la salta.

-- Idioma de cada jugador (app y emails): 'es' o 'en'.
alter table players add column if not exists lang text not null default 'es';

-- WhatsApp: móvil y consentimiento expreso para los avisos.
alter table players add column if not exists phone          text;
alter table players add column if not exists wa_consent     boolean not null default false;
alter table players add column if not exists wa_consent_at  timestamptz;
alter table players add column if not exists wa_consent_src text;

-- Recordatorio del día antes del partido (para no repetirlo cada hora).
alter table challenges add column if not exists day_reminded boolean not null default false;

-- El alta ya no pide email: solo usuario, PIN y móvil de WhatsApp.
alter table players alter column email drop not null;
create unique index if not exists players_phone_uniq on players (phone) where phone is not null;

-- El nivel se recoloca en la banda de su Máster al publicar los cuadros (nunca baja).
alter table players add column if not exists band_bonus numeric(5,2) not null default 0;

-- Cómo quiere aparecer cada uno en su tarjeta (si está vacío, se calcula del nombre).
alter table players add column if not exists card_name text;

-- Cuándo miró cada uno el tablón por última vez (para el aviso del menú).
alter table players add column if not exists feed_seen_at timestamptz not null default now();
