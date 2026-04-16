# CMI Command Center · Piramid Solutions — PRD

## Problema original
El usuario entregó un archivo monolítico `index.html` (143 KB, 415 líneas) de dashboard de monitoreo minero con MQTT real + Leaflet + SVG maps, y solicitó "analiza y mejora esta solución" de forma integral, separando archivos, cambiando look & feel y manteniendo dark/light + la integración MQTT real existente.

## Arquitectura resultante
Aplicación **estática pura** (sin backend) servida vía `python3 -m http.server 3000`. Separada en tres archivos:

- `/app/index.html` — HTML semántico con ARIA (tablist, tabpanels, aria-selected, aria-live), data-testid en todos los interactivos
- `/app/styles.css` — Sistema visual "Industrial Amber" (dark: midnight graphite + warm amber; light: warm stone), CSS vars, glass-morphism, micro-animaciones, responsive (sidebar → drawer en móvil)
- `/app/app.js` — IIFE modular: State / Prefs / Render / Schema / Leaflet / MQTT / UI. Event delegation, keyboard shortcuts, debounce
- `/app/dist/cmi-standalone.html` — Versión all-in-one embebida (82 KB) para despliegue fácil
- `/app/original/index.html` — Archivo original del usuario (preservado)

## Integración MQTT (SIN MOCK — real)
- Broker: `wss://11c2344a8d8b4107a6e0db681599d1a5.s1.eu.hivemq.cloud:8884/mqtt`
- User/Pass: `Piramid` / `Piramid2026` (provistos por el usuario en su archivo)
- Topics suscritos: `cmi/helmet/001/sensor|status|gps`
- Publish: `cmi/helmet/001/cmd` (default, signal, sos, off, recover, status, gps_on/off, gps_status, mandown_on/off, at+csq, cancel)
- Verificado conectado en vivo — datos reales del casco físico fluyendo (pitch, accel, battery, GPS)

## Implementado (16-Abr-2026)
- ✅ 5 vistas: Operaciones · Mapa Mina · Digital Twin · Seguridad · Plataforma
- ✅ Sidebar navigation con active indicator (antes: tabs horizontales)
- ✅ KPIs con accent coloreado
- ✅ Fleet list con avatar + battery bar + pill de estado + stats compactas
- ✅ Filtro/búsqueda de flota (tecla `/` o input)
- ✅ Click en casco → Digital Twin de ese casco específico (multi-helmet)
- ✅ Dark/Light theme cohesivos con paleta "Industrial Amber" (no purple-gradient slop)
- ✅ Persistencia localStorage: theme, última vista, mapView, schemaMode
- ✅ Toast notifications: MQTT conect/error, Man-down detectado, comandos enviados, evacuación
- ✅ Keyboard shortcuts: 1-5 (vistas), T (tema), / (búsqueda), Esc
- ✅ Mapa SVG: esquema subterráneo + open-pit con zonas inestables animadas
- ✅ Leaflet GPS map con capas satelital/calles, markers por estado, popups
- ✅ Sensores satelitales GNSS en vivo (GSV parsing)
- ✅ Evacuación masiva (publish 'sos' a todos los cascos)
- ✅ Reconocer Man-Down
- ✅ Reconexión MQTT automática con contador de intentos visible
- ✅ Accesibilidad: ARIA roles, aria-live para alertas/MQTT, focus-visible ring, prefers-reduced-motion
- ✅ data-testid en todos los elementos interactivos
- ✅ Responsive: 1920 → 520 px (sidebar → drawer en ≤860px)

## Stack / Tipografía
- Fuentes: **Figtree** (display/body, underused en dashboards industriales) + **JetBrains Mono** (data)
- Paleta signature: `--ac: #f5a524` (amber, referencia minera) sobre `--bg-0: #07090f` (graphite)
- Sin gradients purple-to-violet, sin fonts genéricas (Inter/Roboto)

## Servicio local
Servido en `http://localhost:3000/` por `python3 -m http.server 3000` (background).

## Backlog / Próximas mejoras sugeridas
- P1: Replay de datos históricos (TimescaleDB/TDengine)
- P1: Gráficos de tendencias (sparklines) en Digital Twin
- P2: Alertas sonoras opcionales para Man-Down
- P2: Exportar reporte DS594 a PDF
- P3: Control de turnos y multi-usuario con auth
- P3: Configuración de umbrales desde UI
