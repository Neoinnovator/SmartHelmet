# CMI Command Center · Piramid Solutions — PRD

## Problema original
Archivo monolítico `index.html` de dashboard minero con MQTT real + Leaflet + SVG. Usuario pidió: analiza y mejora integral, separa archivos, cambia look & feel, mantén dark/light, mantén integración MQTT real.

## Arquitectura resultante (app estática)
- `/app/index.html` (15 KB) — HTML semántico + ARIA + data-testid
- `/app/styles.css` (32 KB) — Sistema "Industrial Amber", dark/light, responsive
- `/app/app.js` (49 KB) — IIFE modular: State/Prefs/Render/Schema/Leaflet/MQTT/UI/Sparks/Audio/Demo
- `/app/assets/` — `piramid.png` + `ilumintech.png` + `helmet.webp` (logos + foto casco reales)
- `/app/dist/cmi-standalone.html` (166 KB) — All-in-one con assets base64 embebidos
- `/app/package.json` + `.eslintrc.json` — ESLint setup (0 errores)
- `/app/original/index.html` — Archivo original del usuario (preservado)

## Integración MQTT (REAL, sin mock)
Broker HiveMQ Cloud TLS del usuario. Topics `cmi/helmet/001/{sensor|status|gps}` sub, `cmi/helmet/001/cmd` pub. Verificado conectado en vivo.

## Implementado
### v14.0 (16-Abr-2026)
- 5 vistas (Operaciones · Mapa · Twin · Seguridad · Plataforma), sidebar navigation
- Tema dark/light persistente, keyboard shortcuts, toast notifications
- Fleet con avatar/battery/pill/búsqueda, click-to-twin multi-helmet
- Mapas SVG (underground + open-pit) + Leaflet satelital
- Reconocer Man-Down, evacuación masiva, reconexión MQTT automática
- ARIA completo, responsive hasta 520px

### v14.1 (16-Abr-2026) — esta iteración
- **Assets reales**: logos Piramid + Ilumintech en sidebar, foto del casco real en Digital Twin con anillo animado
- **Sparklines** (60 samples) para batería / accel / pitch en Digital Twin, canvas con línea+área+dot+valor en vivo
- **Modo DEMO** — simulador scripted de telemetría con escenarios (geofence breach tick 8, man-down tick 14, recover tick 22). Toggle púrpura en topbar
- **Alertas sonoras Web Audio API** (3-tone sweep en man-down), toggle en topbar, persistente
- **Keyboard shortcuts extendidos**: S (sound), D (demo), T (theme), 1-5 (views), / (search)
- **ESLint** configurado (0 errores), `yarn lint` disponible

## Stack
Figtree + JetBrains Mono · paleta amber/midnight · mqtt.js 4.3.8 · Leaflet 1.9.4 · ESLint 8

## Servicio
`python3 -m http.server 3000` (background) en `/app/`

## Backlog
- P1 Replay histórico con TDengine
- P1 Sparklines en más métricas (yaw, temperatura ambiente)
- P2 Export DS594 a PDF
- P2 Alerta sonora diferenciada por tipo de evento
- P3 Multi-usuario con auth + roles (supervisor/operador)
- P3 Configuración de umbrales desde UI
- P3 Tests E2E con Playwright

## v14.2 (16-Abr-2026) — Deployment-ready
- Reestructurado a `/app/frontend/` + `/app/backend/` como espera Emergent
- **Backend FastAPI mínimo**: `/api/config` sirve credenciales MQTT desde env (resuelve blocker de secrets hardcoded), `/api/health` para checks
- **Frontend** servido con `serve` npm package via `yarn start` (supervisor-managed en puerto 3000)
- `app.js` ahora hace `fetch('/api/config')` en runtime antes de conectar MQTT
- Supervisor: backend + frontend + mongodb todos RUNNING, preview URL live
- Lista para botón Deploy de Emergent (50 créditos/mes, redeploys ilimitados)

## v14.3 (17-Abr-2026) — Analítica IA + Google Maps + i18n
- **Casco transparente**: Nano Banana (gemini-3.1-flash-image-preview) removió el fondo negro → `helmet-transparent.png` (369KB) en `/app/frontend/public/assets/`
- **Google Maps tiles**: reemplazó ESRI por `mt0.google.com/vt/lyrs=s|y|m|p` en Leaflet. 4 capas: Satélite, Satélite+Etiquetas (hybrid), Calles, Terreno
- **Geofence subterráneo**: nueva zona restringida animada en Nivel-4 ("COLAPSO NIVEL-4 · NO-GO · TURNO-SUP") con hatch rojo y stroke pulsante
- **Geofence satelital**: círculo rojo 250m radio con popup en el mapa GPS
- **i18n actividades**: `walking→caminando`, `driving→conduciendo`, `still→quieto`, `unknown→desconocido`, `sos→sos` en TODOS los sitios (fleet, twin, demo, schema, MQTT handler)
- **Tab Analítica IA (6º)** con:
  - 4 KPIs: Horas Op, Incidentes 24h, Exposición alta, Score HSE (calculado por Gemini)
  - Chart stacked bars 24h (Caminando/Conduciendo/Quieto)
  - Chart incidentes por zona (7 días)
  - Selector trabajador → sparklines de batería/accel/pitch (144 puntos, 10-min granularity)
  - Lista incidentes por trabajador
  - Botón "Generar reporte HSE con IA" → Gemini 2.5 Flash
- **Backend endpoints nuevos**:
  - `GET /api/history/{helmet_id}?hours=24` — historial sintético determinístico
  - `POST /api/analytics/report` — reporte HSE en markdown español (Gemini 2.5 Flash con system prompt experto en DS594/Ley 16.744/ICMM)
- **Emergent LLM key** agregada a `/app/backend/.env`
- **Shortcut keyboard** extendido: `1-6` para views (antes 1-5)

## v14.3 verified working
- Backend /api/analytics/report → 200 OK, 2800 chars markdown, Score 95/100
- Google Maps tiles cargan en satelital híbrido con calles en español
- Casco PNG transparente con drop-shadow
- Gráficos canvas (actividad + zonas + sparklines) renderizan correctamente

## v14.4 (17-Abr-2026) — Chat IA + Sub-tabs + Casco fix + GPS Luis
- **Casco PNG con alpha real** (`helmet-clean.png`, 108KB): Pillow chroma-key sobre el negro, fade suave en bordes — fondo 100% transparente, integra perfecto con hero del Twin
- **Logos sidebar simétricos**: brand-stack vertical con Piramid (blanco) + Ilumintech (negro) en cards consistentes (40px alto, padding uniforme)
- **6 sub-tabs en Analítica**: 📊 Estadísticas · 🔮 Predictiva · ⚡ Prescriptiva · 📜 Logs históricos · 💬 Chat IA · 📄 Reporte HSE
- **Chat IA con Gemini 2.5 Flash** (`POST /api/chat`):
  - Conversational con history en frontend
  - Context inline: snapshot completo de flota + evac state + MQTT status
  - 4 sugerencias rápidas (¿Dónde está Luis? · Incidentes urgentes · Baterías bajas · Resumen 24h)
  - Typing indicator animado
  - Markdown light (negritas, listas, code)
- **Analítica Predictiva** (`POST /api/analytics/predictive`): forecast 8h con probabilidad de incidente (canvas chart con gradient + escala 0-100%), pico de riesgo, trabajador en riesgo, % confianza, lista de patrones detectados con impacto (alto/medio/bajo)
- **Analítica Prescriptiva** (`POST /api/analytics/prescriptive`): 5-7 acciones recomendadas por Gemini con prioridad (alta/media/baja), responsable y plazo
- **Logs históricos 30 días**: 150-240 eventos sintéticos categorizados por tipo (cr/wr/ok/bl) con filtro
- **GPS Luis Campusano**: lat=-27.35762, lon=-70.35330 (Depto. Geología UDA Copiapó), gF=true, sats=12, HDOP=0.8, 142 fixes
- **Mapa centrado** en UDA Copiapó (-27.35762, -70.35330)
- **Mejoras responsive**: brand-stack escala mejor en móvil, log-entry colapsa a 1 columna, chat-card altura adaptativa, subtabs scroll horizontal en móvil

## Backend endpoints actuales
- `GET /api/health` `GET /api/config` `GET /api/history/{id}`
- `POST /api/analytics/report` (HSE markdown completo)
- `POST /api/analytics/predictive` (JSON forecast + patterns)
- `POST /api/analytics/prescriptive` (JSON acciones priorizadas)
- `POST /api/chat` (conversational con context fleet)

Todos lint-clean (Python ruff + JS ESLint = 0 errors).

## v14.5 (17-Abr-2026) — Flota 20 · SOS · Icons SVG · 90 días históricos
- **Evacuación = SOS directo**: elimina toggle masivo de flota, publica `sos` al `cmi/helmet/001/cmd`. Feedback visual: label "SOS ENVIADO · HH:MM:SS" pulsante 4s, MODO pill rojo urgent, audio alerta, auto-revert a STANDBY
- **20 trabajadores** con nombres/roles/zonas realistas de minería chilena. Solo CMI-001 (Luis) tiene `re: true` y recibe MQTT real en vivo. 1 man-down (Andrés) + 3 warnings (Pedro/Matías/Nicolás) hardcoded para demo realista
- **Icons SVG profesionales** en 6 sub-tabs de Analítica: bar-chart (Estadísticas) · trending-up (Predictiva) · lightning (Prescriptiva) · document (Logs) · chat-bubble (Chat IA) · doc-lines (Reporte HSE) — sin emojis
- **Histórico 3 meses** con granularidad adaptativa:
  - ≤48h → 10-min (144 pts)
  - ≤168h → 1h (168 pts)
  - ≤720h → 3h (240 pts)
  - ≤2160h → 6h (360 pts)
  Selector de período en Analítica: 24h / 7d / 30d / 90d
- **Endpoint `/api/fleet-summary?days=90&ids=...`**: stats agregados por casco (avg/min/max de batería/accel/pitch, % por actividad, incidentes por tipo/zona) — payload ligero para contexto de Gemini
- **Chat con contexto histórico**: `Chat.snapshot()` incluye `historico_90dias` pre-cargado. SYSTEM_PROMPT actualizado para que Gemini sepa la estructura del contexto. Ahora responde preguntas tipo "¿cuál fue la tendencia de batería de X en el último mes?" usando datos reales
