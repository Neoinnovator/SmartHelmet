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
