# ATC Ranking — Estado del proyecto
**Última actualización:** 13 noviembre 2026, 21:15

## Qué es
App web (SPA) de ranking de tenis para el Almuñécar Tennis Club. Temporada 1 arranca el **19 de noviembre de 2026**. Liga Elo con bandas (Oro/Plata/Bronce/Challenger), retos entre jugadores, Másters por banda, y notificaciones por WhatsApp.

## Stack
- **Frontend:** Vanilla JS, un solo `public/index.html` (~235 KB), i18n ES/EN integrado
- **Backend:** Netlify Functions (`netlify/functions/api.mjs` ~88 KB)
- **BD:** Supabase Postgres
- **Hosting:** Netlify (atcranking.netlify.app)
- **Repo:** GitHub (geroduck/ranking-atc)

## Archivos clave
| Archivo | Qué hace |
|---------|----------|
| `public/index.html` | Toda la app (SPA, CSS, JS, i18n) |
| `public/_redirects` | Redirect de `/privacy` → `index.html` para Meta |
| `netlify/functions/api.mjs` | API completa (auth, retos, resultados, admin, Elo) |
| `netlify/lib/rules.mjs` | Reglas Elo, bandas, bonus de Másters |
| `netlify/lib/i18n.mjs` | i18n para WhatsApp (fechas, nombres de banda) |
| `migracion-whatsapp.sql` | SQL idempotente para columnas nuevas |

## Qué se hizo en las últimas sesiones (12-13 nov)

### Pantalla "Cómo funciona" (#/como-funciona)
- Nueva pantalla pública con explicación completa de la liga en ambos idiomas
- Tres ejemplos con números reales (Puntos, Nivel, Másters) verificados contra `rules.mjs`
- Accesible desde login, registro, perfil y la pantalla de privacidad
- CSS dedicado: `.howbox`, `.pts3`, `.ej`, `.how-link`

### Auditoría completa de textos (ES + EN)
- 11 traducciones EN que decían "email" cuando ya es WhatsApp — corregidas
- Bug en placeholder `$4` inexistente — corregido
- Standings medio traducidos ("Nivel # · Tú") — 11+ strings nuevas añadidas
- Política de privacidad con bandas incorrectas (82-99 vs 81-99) — corregida
- Gendered "¡Bienvenido!" → neutro "Ya estás dentro."
- Hints de WhatsApp movidos debajo del campo de teléfono
- Tres mensajes de error duplicados unificados

### Eslogan
- **"por amor al tenis"** / **"for the love of tennis"**
- Login: cursiva, minúscula, sin punto, `rgba(255,255,255,.6)`
- Share card (canvas 1080×1920): cursiva, color peach, debajo de la URL

### Admin
- Botones `mailto:` muertos → enlaces `wa.me/` con el teléfono del jugador
- API: `a.email as e1` → `a.phone as e1` en la consulta de agenda admin

### Diagnóstico mejorado
- Ping ahora comprueba `band_bonus`, `card_name`, `feed_seen_at`
- Error 500 con 42703/42P01 muestra el mensaje de Postgres + aviso "falta ejecutar SQL"

### Meta / WhatsApp Business API (13 nov)
- App "ATC Ranking Avisos" configurada en Meta Developers (ID: 239978252080767)
- URL de privacidad: `https://atcranking.netlify.app/#/privacidad`
- URL de eliminación de datos: `https://almunecartennisclub.com`
- Categoría: Ocio
- **App lista para publicar** (configuración obligatoria completa)
- `_redirects` + snippet de redirect sin hash preparados para futuro deploy
- **Gero ya tiene el número DIGI** para WhatsApp

## Lo que FALTA hacer (por orden de urgencia)

### 🔴 Crítico antes del 19 nov
1. **Ejecutar `migracion-whatsapp.sql` en Supabase** — sin esto Ajustes da error 42703
2. **Publicar la app en Meta** (botón Publicar ya listo)
3. **Hacer deploy en Netlify** del nuevo `index.html` + `_redirects` + `api.mjs`
4. **Configurar el número DIGI en WhatsApp Business API:**
   - Meta Business Suite → WhatsApp → Configuración → Añadir número
   - Verificar con SMS/llamada
   - Guardar en Netlify env vars: `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_ID`
5. **Crear template `partido_confirmado` en inglés** en Meta (el español ya existe)
6. **Esperar aprobación** del template + verificación del negocio

### 🟡 Importante
7. **Revisar la ficha de Gonzalo** (nivel auto-reportado 95) antes del 19 nov
8. **Decidir sobre el bonus por edad** — propuesta analizada y rechazada con argumentos:
   - +0.25/partido × 12 partidos = 1 victoria gratis; la diferencia entre puesto 4 y 10 es ~6-10 pts
   - Alternativas: (a) filtro por franja de edad, (b) premios fin de temporada, (c) handicap en pista
   - **Gero no ha respondido**
9. **Decidir si retrasar el 19 nov** si WhatsApp no está live a tiempo

### 🟢 Opcional
10. Renombrar "Jugador eliminado" → "Cuenta eliminada" (BD + api.mjs:1163)
11. Re-renderizar los 2 vídeos y 40 slides con el eslogan
12. Cambiar URL de eliminación de datos a `/privacy` tras deploy del `_redirects`

## Sistema Elo — referencia rápida
```
expected(me, rival) = 1 / (1 + 10^((rival - me) / 20))
K_PROV = 12, K_NORMAL = 4, PROV_MATCHES = 5
WIN_WEIGHT = 0.75, GAMES_WEIGHT = 0.25
lvl = Math.round(Number(n))

Bandas (rules.mjs):
  Oro:        81–99
  Plata:      71–80
  Bronce:     61–70
  Challenger: 50–60
```

## i18n — cómo funciona
- Diccionario `EN = {...}` (~740 entradas) compilado en `I18N_EXACT` (Map) + `I18N_RULES` (regex)
- `#` en clave → número (`[+−±–-]?\d+(?:[.,]\d+)?`)
- `*` en clave → wildcard (`.+?`), valores usan `$1`/`$2`
- MutationObserver traduce `textContent` + `placeholder`/`aria-label`/`alt`/`title`
- Test: `tr(texto,'en')` en consola
- Textos de admin: solo español (a propósito)

## Seguridad
- WhatsApp token → env vars de Netlify, NUNCA en código
- Campo `phone` solo visible en `selfView` (perfil propio) y payload admin
- `ADMIN_USERNAME` en Netlify decide quién es admin al registrarse
- PIN temporal 7314 de `arreglar-acceso.sql` → cambiar inmediatamente tras usarlo
