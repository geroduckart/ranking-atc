# Ranking ATC — Almuñécar Tennis Club

Web app del ranking del club: registro con usuario + PIN, carta de jugador, clasificación por puntos y por nivel, retos con email de un toque, resultados con confirmación, tablón con comentarios, Másters (Oro, Plata, Bronce y Challenger) y panel del club.

- `public/index.html`: la app (todas las pantallas).
- `netlify/functions/api.mjs`: la API (todo lo que pasa en el servidor).
- `netlify/functions/cron.mjs`: tareas automáticas cada hora (retos caducados, recordatorios, resultados sin confirmar en 48 h).
- `netlify/lib/rules.mjs`: las reglas (nivel, puntos, clasificación, cuadros). Si quieres cambiar un número (K, puntos, límites), está arriba de este archivo.
- `supabase/schema.sql`: la base de datos.

---

## Puesta en marcha (una sola vez, unos 30 minutos)

Necesitas tres cuentas gratuitas: **Supabase** (base de datos), **Netlify** (la web, la que ya usas) y **Resend** (emails).

### 1. Supabase: la base de datos

1. Entra en [supabase.com](https://supabase.com) → **New project**.
   - Nombre: `ranking-atc`.
   - **Database password**: invéntala y **guárdala**, la necesitas en el paso 3.
   - Región: **West EU (Ireland)** o **Central EU (Frankfurt)** (datos en la UE).
2. Cuando esté creado: menú izquierdo → **SQL Editor** → **New query**. Abre `supabase/schema.sql`, copia todo, pégalo y pulsa **Run**. Debe decir *Success*.
3. Arriba, botón **Connect** → pestaña **Connection string** → elige **Transaction pooler** (puerto 6543). Copia la dirección, que empieza por `postgresql://postgres.xxxx:[YOUR-PASSWORD]@...pooler.supabase.com:6543/postgres`, y cambia `[YOUR-PASSWORD]` por la contraseña del punto 1. Esa es tu `DATABASE_URL`.

### 2. Netlify: la web

1. Sube esta carpeta a un repositorio nuevo de GitHub (como hiciste con el Journal). Mejor privado.
2. En Netlify: **Add new site → Import an existing project** → elige el repositorio. No cambies nada de la configuración de build.
3. Antes de nada, ve a **Site configuration → Environment variables** y añade estas:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | La dirección de Supabase del paso 1.3 |
| `SESSION_SECRET` | Una frase larga inventada, de 30 caracteres o más (por ejemplo, tres palabras y unos números). No la compartas. |
| `ADMIN_USERNAME` | El usuario con el que te vas a registrar tú, por ejemplo `gero` |
| `RESEND_API_KEY` | La clave de Resend (paso 3) |
| `MAIL_FROM` | `Ranking ATC <avisos@almunecartennisclub.com>` |
| `MAIL_REPLY_TO` | `info@almunecartennisclub.com` |
| `SITE_URL` | Solo si usas un dominio propio (por ejemplo `https://ranking.almunecartennisclub.com`). Si no, déjala sin poner. |

4. **Deploys → Trigger deploy**. Cuando termine, abre la web.

### 3. Resend: los emails (con tu dominio de Hostinger)

1. Entra en [resend.com](https://resend.com), crea la cuenta → **Domains → Add Domain** → `almunecartennisclub.com`, región **Ireland (eu-west-1)**.
2. Resend te enseña 3 o 4 registros DNS (tipo, nombre y valor). Déjalos abiertos.
3. En **Hostinger**: hPanel → **Dominios** → `almunecartennisclub.com` → **DNS / Nameservers** → **Gestionar registros DNS**. Añade cada registro **exactamente** como lo muestra Resend (copia el contenido con el botón de copiar, no a mano):
   - **TXT**, nombre `resend._domainkey` (el valor largo que empieza por `p=`, el DKIM).
   - **CNAME**, nombre `rsend`.
   - **CNAME**, nombre `send`.
   - En "Nombre" pon solo eso (`send`, `rsend`…): Hostinger añade el dominio solo.
   - **No toques ni borres los registros que ya hay**, sobre todo los MX de `@`: son los de `info@`.
4. Vuelve a Resend y pulsa **Verify DNS Records**. Puede tardar de unos minutos a unas horas. Cuando salga **Verified**, ve a **API Keys → Create API Key** (permiso *Sending access*), cópiala en Netlify como `RESEND_API_KEY` y vuelve a hacer **Trigger deploy**.

Mientras no haya `RESEND_API_KEY`, la app funciona igual pero no envía emails.

### 4. Primeros pasos en la app

1. Regístrate con el usuario que pusiste en `ADMIN_USERNAME`: serás el administrador.
2. Perfil → **Panel del club** → **Temporada**: pon las fechas reales (inicio, fin de la fase regular y fin de los Másters) y guarda.
3. Haz una prueba con un segundo usuario (otro email tuyo): retaos, aceptad desde el email, poned un resultado y confirmadlo.
4. Si alguien quiere la app en el móvil: en Safari, **Compartir → Añadir a pantalla de inicio**.

---

## Cómo funciona (resumen de las reglas)

- **Nivel**: cada jugador se valora de 30 a 99 en derecha, revés, slice, 1.er y 2.º servicio; la media es su nivel de partida. Luego lo mueven los resultados (Elo): K = 12 en sus 5 primeros partidos, después 4; ×1,15 si el ganador cede 3 juegos o menos.
- **Puntos de temporada**: victoria 3, derrota 1, +1 si ganas a alguien con 5+ niveles más (si ninguno es provisional). Máximo 3 partidos que puntúan por semana y 2 por pareja en la temporada. Perder por rechazo da 0 puntos.
- **Retos**: a cualquiera. 7 días para responder (recordatorio a los 3). Hasta 3 cambios de hora. 2 rechazos libres al mes; el tercero cuenta como derrota 6-0 6-0. Máximo 5 retos esperando respuesta a la vez. Los retos con menores de 18 no llevan mensaje.
- **Resultados**: uno lo pone, el otro confirma (desde la app o el email). Sin respuesta en 48 h, se da por bueno. Si hay desacuerdo, te llega un email y lo resuelves en el panel.
- **Másters**: mínimo 5 partidos. Del panel, **Generar cuadros** cierra la fase regular y crea Oro (1–8), Plata (9–16), Bronce (17–24) y Challenger (25 en adelante, hasta 16). Mueven el nivel, no los puntos.
- **Seguridad**: el PIN se guarda cifrado; tras 5 PIN incorrectos, la cuenta se bloquea 15 minutos. Los botones de los emails piden un toque de confirmación, para que los filtros de correo que abren enlaces no acepten nada solos.
- **Datos**: el panel exporta jugadores y partidos en CSV. Haz una copia de vez en cuando: el plan gratuito de Supabase no incluye copias de seguridad descargables.
- **Supabase gratis** pausa los proyectos que pasan una semana sin uso. La tarea automática de cada hora consulta la base de datos, así que no debería pausarse.

## Cambiar cosas

- Textos y pantallas: `public/index.html`.
- Números de las reglas: arriba de `netlify/lib/rules.mjs` y de `netlify/functions/api.mjs`.
- Política de privacidad: en `public/index.html`, función `screenPrivacy`. Revísala antes de abrir la app: es un borrador.
