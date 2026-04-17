/* ============================================================================
 * CMI Command Center · Piramid Solutions
 * Modular JS: State · MQTT · Render · Map · UI · Toasts · Persistence
 * ============================================================================ */
(() => {
  'use strict';

  // ---------------------------------------------------------------- Config --
  // MQTT credentials are loaded at runtime from /api/config (backend env).
  // Defaults below are fallbacks only (e.g. when running fully static).
  const CFG = {
    mqttUrl: '',
    mqttUser: '',
    mqttPass: '',
    topics: {
      sensor: 'cmi/helmet/001/sensor',
      status: 'cmi/helmet/001/status',
      gps:    'cmi/helmet/001/gps',
      cmd:    'cmi/helmet/001/cmd',
    },
    storageKey: 'cmi.prefs.v1',
    logMax: 80,
    mineCenter: { lat: -27.35762, lon: -70.35330 },  // UDA Geología, Copiapó (Luis)
  };

  async function loadRuntimeConfig() {
    try {
      const r = await fetch('/api/config', { cache: 'no-store' });
      if (!r.ok) throw new Error('status ' + r.status);
      const c = await r.json();
      CFG.mqttUrl  = c.mqttUrl  || CFG.mqttUrl;
      CFG.mqttUser = c.mqttUser || CFG.mqttUser;
      CFG.mqttPass = c.mqttPass || CFG.mqttPass;
      return true;
    } catch (e) {
      console.warn('[CMI] /api/config failed, MQTT will stay offline:', e.message);
      return false;
    }
  }

  const CMD_SUP = [
    { v: 'default', l: 'Default', cls: 'cmd-ok' },
    { v: 'signal',  l: 'Signal',  cls: 'cmd-wr' },
    { v: 'sos',     l: 'SOS',     cls: 'cmd-cr' },
    { v: 'off',     l: 'Off',     cls: '' },
    { v: 'recover', l: 'Recover', cls: 'cmd-bl' },
    { v: 'status',  l: 'Status',  cls: 'cmd-bl' },
    { v: 'gps_on',  l: 'GPS On',  cls: 'cmd-cy' },
    { v: 'gps_off', l: 'GPS Off', cls: '' },
  ];
  const CMD_TECH = [
    ...CMD_SUP,
    { v: 'gps_status',   l: 'GPS Loc',     cls: 'cmd-cy' },
    { v: 'mandown_on',   l: 'ManDown On',  cls: '' },
    { v: 'mandown_off',  l: 'ManDown Off', cls: '' },
    { v: 'at+csq',       l: 'AT+CSQ',      cls: 'cmd-bl' },
  ];

  const USE_CASES = [
    { n: 'GPS / GNSS',              p: 'l', d: 'Posición tiempo real via LTE Cat1', s: 'EG912U-GL' },
    { n: 'Control Remoto',          p: 'l', d: 'MQTT: default/signal/sos/off via 4N35', s: 'CodeCell C6' },
    { n: 'Man-Down / Impacto',      p: 'l', d: 'BNO085 pitch + accel + activity', s: 'BNO085' },
    { n: 'Monitoreo Ambiental',     p: 'l', d: 'VCNL4040 proximidad + luz', s: 'VCNL4040' },
    { n: 'LTE 4G Cat1',             p: 'l', d: 'Quectel EG912U-GL MQTT TLS', s: 'EG912U-GL' },
    { n: 'Dashboard Ops',           p: 'l', d: 'HMI v14 Command Center', s: 'Web MQTT' },
    { n: 'Geotecnia Integrada',     p: 'n', d: 'Zonas inestables → geofence → alerta', s: 'SSR Radar' },
    { n: 'Workflow Alertas',        p: 'n', d: 'Detectar → notificar → resolver', s: 'MQTT Engine' },
    { n: 'Trazabilidad Personal',   p: 'n', d: 'Historial posiciones y zonas por turno', s: 'TDengine' },
    { n: 'Geofence Dinámico',       p: 'r', d: 'No-go zones desde radar estabilidad', s: 'Hexagon' },
    { n: 'Evacuación Sector',       p: 'r', d: 'Alerta masiva zona/muster point', s: 'CMI-CB-02' },
    { n: 'DS594 Compliance',        p: 'r', d: 'Exposición temperatura/humedad', s: 'BMP388+Mic' },
    { n: 'Analytics Predictivo',    p: 'r', d: 'Patrones → anticipar incidentes', s: 'TDengine ML' },
    { n: 'TDengine DB',             p: 'r', d: '3000+ cascos, Super Tables, <3s', s: 'TDengine' },
  ];

  const VIEW_META = [
    { t: 'Operaciones',    s: 'Vista general de flota, alertas y comandos de supervisor' },
    { t: 'Mapa Mina',      s: 'Posición operacional: esquema subterráneo / open-pit / satelital Google' },
    { t: 'Digital Twin',   s: 'Vista detallada sensor-a-sensor del casco seleccionado' },
    { t: 'Seguridad',      s: 'Incidentes, exposición DS594 y estado de evacuación' },
    { t: 'Plataforma',     s: 'Casos de uso implementados, en desarrollo y roadmap' },
    { t: 'Analítica IA',   s: 'Tendencias, histórico por trabajador y reportes HSE generados por Gemini' },
  ];

  // Translate activity codes → Spanish label
  const ACT_ES = {
    walking: 'caminando', driving: 'conduciendo', still: 'quieto',
    running: 'corriendo', sos: 'sos', unknown: 'desconocido',
    caminando: 'caminando', conduciendo: 'conduciendo', quieto: 'quieto',
  };
  const actEs = (a) => ACT_ES[String(a || '').toLowerCase()] || a || '—';

  // ----------------------------------------------------------------- State --
  const State = {
    workers: [],
    currentView: 0,
    selectedWorker: 0,      // index in workers array (for Digital Twin)
    mqtt: { client: null, connected: false, attempts: 0 },
    mapView: 'schema',      // 'schema' | 'gps'
    schemaMode: 'underground', // 'underground' | 'openpit'
    leaflet: { map: null, markers: [] },
    log: [],                // event log (strings)
    evacActive: false,
    search: '',
  };

  // ------------------------------------------------------------- Utilities --
  const $  = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const h  = (str) => String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ago = (t) => {
    const s = Math.floor((Date.now() - t) / 1000);
    return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h';
  };

  const timeCL = () => new Date().toLocaleTimeString('es-CL');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // --------------------------------------------------------- Persistence --
  const Prefs = {
    load() {
      try { return JSON.parse(localStorage.getItem(CFG.storageKey) || '{}'); }
      catch { return {}; }
    },
    save(p) {
      try { localStorage.setItem(CFG.storageKey, JSON.stringify(p)); } catch {}
    },
    update(patch) { this.save({ ...this.load(), ...patch }); },
  };

  // ----------------------------------------------------------------- Log --
  function logPush(msg) {
    State.log.unshift(`${timeCL()} ${msg}`);
    if (State.log.length > CFG.logMax) State.log.length = CFG.logMax;
    const el = $('twLog');
    if (el) el.textContent = State.log.join('\n') || 'Esperando datos…';
  }

  // ---------------------------------------------------------- Seed fleet --
  function seedFleet() {
    const fleet = [
      { nm: 'Luis Campusano',   rl: 'Ing. Innovación',    zn: 'Z2' },  // único con MQTT real
      { nm: 'Carlos Muñoz',     rl: 'Op. Perforación',    zn: 'Z1' },
      { nm: 'Pedro Aravena',    rl: 'Geomecánico',        zn: 'Z4' },
      { nm: 'Jorge Tapia',      rl: 'Jefe de Turno',      zn: 'Z2' },
      { nm: 'Mario González',   rl: 'Op. Cargador',       zn: 'Z3' },
      { nm: 'Andrés Silva',     rl: 'Topógrafo',          zn: 'Z1' },
      { nm: 'Roberto Díaz',     rl: 'Op. CAEX',           zn: 'Z5' },
      { nm: 'Felipe Rojas',     rl: 'Mecánico Mina',      zn: 'Z2' },
      { nm: 'Sebastián Vera',   rl: 'Op. Perforación',    zn: 'Z3' },
      { nm: 'Cristián Pérez',   rl: 'Geólogo',            zn: 'Z4' },
      { nm: 'Matías Fuentes',   rl: 'Op. CAEX',           zn: 'Z1' },
      { nm: 'Rodrigo Contreras',rl: 'Electricista Mina',  zn: 'Z2' },
      { nm: 'Francisco Soto',   rl: 'Op. Bulldozer',      zn: 'Z5' },
      { nm: 'Javier Bravo',     rl: 'Jefe de Seguridad',  zn: 'Z1' },
      { nm: 'Nicolás Herrera',  rl: 'Op. Perforación',    zn: 'Z3' },
      { nm: 'Alejandro Muñoz',  rl: 'Op. CAEX',           zn: 'Z4' },
      { nm: 'Diego Castro',     rl: 'Paramédico',         zn: 'Z2' },
      { nm: 'Víctor Espinoza',  rl: 'Electromecánico',    zn: 'Z1' },
      { nm: 'Gonzalo Sandoval', rl: 'Topógrafo',          zn: 'Z5' },
      { nm: 'Ricardo Valdés',   rl: 'Op. Cargador',       zn: 'Z3' },
    ];
    const acts = ['caminando', 'conduciendo', 'quieto'];
    const luisLat = '-27.35762', luisLon = '-70.35330';
    // Indices of workers in critical/warning state (hardcoded for realistic demo)
    const criticalIdx = [5];         // Andrés Silva = man-down
    const warningIdx = [2, 10, 14];  // Pedro, Matías, Nicolás = warning

    State.workers = fleet.map((f, i) => {
      const isLuis = i === 0;
      const isCrit = criticalIdx.includes(i);
      const isWarn = warningIdx.includes(i);
      const st = isCrit ? 'cr' : (isWarn ? 'wr' : 'ok');
      return {
        id: `CMI-${String(i + 1).padStart(3, '0')}`,
        nm: f.nm, rl: f.rl, zn: f.zn,
        st,
        bat: isLuis ? 102 : (isCrit ? 38 : 40 + Math.floor(Math.random() * 55)),
        p: isLuis ? 0 : (isCrit ? 45 : 160 + Math.floor(Math.random() * 15)),
        r: 0, y: 0,
        ac: isLuis ? 0 : (isCrit ? 2.1 : 9.5 + Math.random()),
        act: isLuis ? 'desconocido' : (isCrit ? 'quieto' : acts[i % 3]),
        lat: isLuis ? luisLat : (-27.366 - i * 0.0018).toFixed(4),
        lon: isLuis ? luisLon : (-70.332 - i * 0.0012).toFixed(4),
        mdw: isCrit,
        gF: true,
        ts: Date.now() - (isCrit ? 30000 : Math.floor(Math.random() * 60000)),
        re: isLuis,
        fw: 'v11.0-C6',
        gS: isLuis ? '12' : String(5 + Math.floor(Math.random() * 7)),
        gH: isLuis ? '0.8' : '', gA: isLuis ? '385m' : '',
        gU: '', gFC: isLuis ? 142 : 0,
        mode: isLuis ? 'live' : 'seed',
        loc: isLuis ? 'Depto. Geología · UDA Copiapó' : `Mina · Zona ${f.zn}`,
      };
    });
  }

  // =========================================================================
  //                                 RENDER
  // =========================================================================

  function renderKPIs() {
    const w = State.workers;
    const online = w.filter((x) => x.st !== 'off').length;
    const md     = w.filter((x) => x.mdw).length;
    const gps    = w.filter((x) => x.gF).length;
    const mq     = State.mqtt.connected;

    const items = [
      { l: 'Personal online', v: `${online}/${w.length}`,       c: 'ok' },
      { l: 'Alertas activas', v: md,                             c: md ? 'cr' : 'ok' },
      { l: 'GPS fix',         v: `${gps}/${online}`,             c: 'cy' },
      { l: 'Man-down',        v: md,                             c: md ? 'cr' : 'ok' },
      { l: 'Conectividad',    v: mq ? 'LIVE' : 'OFF',            c: mq ? 'ok' : 'cr' },
    ];

    $('kpis').innerHTML = items.map((k) =>
      `<div class="card card-accent" data-accent="${k.c}"><div class="lbl">${h(k.l)}</div><div class="val" style="color:var(--${k.c})">${h(k.v)}</div></div>`
    ).join('');

    $('fleetCount').textContent  = w.length;
    $('fleetOnline').textContent = online;
    $('mdCount').textContent     = md;
    $('gpsCov').textContent      = Math.round(gps / w.length * 100) + '%';

    const badge = $('navBadge');
    if (md > 0) { badge.hidden = false; badge.textContent = md; }
    else { badge.hidden = true; }
  }

  function renderAlerts() {
    const alerts = State.workers.filter((w) => w.mdw || w.st === 'cr' || w.st === 'wr');
    $('alCount').textContent = `${alerts.length} activa${alerts.length !== 1 ? 's' : ''}`;

    if (!alerts.length) {
      $('alList').innerHTML = '<div class="empty-state">Sin alertas activas</div>';
      $('incidentList').innerHTML = '<div class="empty-state">Sin incidentes</div>';
      return;
    }

    const html = alerts.map((w) => `
      <div class="alert${w.mdw ? '' : ' alert-wr'}">
        <div class="alert-ty" style="color:var(--${w.mdw ? 'cr' : 'wr'})">${w.mdw ? 'MAN-DOWN' : 'ALERTA'}</div>
        <div class="alert-m">${h(w.nm)} — ${h(w.rl)}</div>
        <div class="alert-x">${h(w.id)} · Zona ${h(w.zn)} · hace ${ago(w.ts)}</div>
        ${w.mdw ? `<button class="alert-btn" data-ack="${h(w.id)}" data-testid="ack-${h(w.id)}">Reconocer</button>` : ''}
      </div>`
    ).join('');

    $('alList').innerHTML = html;

    const incHtml = State.workers.filter((w) => w.mdw).map((w) => `
      <div class="alert">
        <div class="alert-ty" style="color:var(--cr)">MAN-DOWN</div>
        <div class="alert-m">${h(w.nm)} (${h(w.id)})</div>
        <div class="alert-x">Zona ${h(w.zn)} · Pitch: ${w.p.toFixed(0)}° · hace ${ago(w.ts)}</div>
        <button class="alert-btn" data-ack="${h(w.id)}">Reconocer</button>
      </div>`
    ).join('');
    $('incidentList').innerHTML = incHtml || '<div class="empty-state">Sin incidentes activos</div>';
  }

  function renderFleet() {
    const q = State.search.trim().toLowerCase();
    const list = q
      ? State.workers.filter((w) => [w.nm, w.rl, w.id, w.zn].join(' ').toLowerCase().includes(q))
      : State.workers;

    if (!list.length) {
      $('fleet').innerHTML = '<div class="empty-state">Sin resultados para “' + h(State.search) + '”</div>';
      return;
    }

    $('fleet').innerHTML = list.map((w) => workerCard(w, true)).join('');
    $('zoneList').innerHTML = State.workers.map((w) => workerCard(w, false, true)).join('');
  }

  function workerCard(w, clickable = true, inZone = false) {
    const av = w.nm.split(' ').map((x) => x[0]).join('').slice(0, 2);
    const pill = w.mdw ? 'pill-cr' : (w.st === 'ok' ? '' : 'pill-wr');
    const label = w.mdw ? 'MAN-DOWN' : w.st.toUpperCase();
    const critClass = w.mdw ? ' is-critical' : '';
    const selClass = (clickable && State.selectedWorker === State.workers.indexOf(w)) ? ' is-selected' : '';
    const batColor = w.bat > 50 ? 'var(--ok)' : w.bat > 20 ? 'var(--wr)' : 'var(--cr)';

    const meta = inZone
      ? `${h(w.rl)} · Zona ${h(w.zn)} · ${w.lat ? `${h(w.lat)}, ${h(w.lon)}` : 'Sin GPS'}`
      : `${h(w.rl)} · ${h(w.id)} · Zona ${h(w.zn)}`;

    return `
      <button class="worker${critClass}${selClass}" data-select="${State.workers.indexOf(w)}" ${clickable ? '' : 'tabindex="-1"'}>
        <div class="w-avatar">${h(av)}</div>
        <div class="w-body">
          <div class="w-name">${h(w.nm)}${w.re ? '<span class="live-pill">LIVE</span>' : ''}</div>
          <div class="w-meta">${meta}</div>
        </div>
        <div class="w-right">
          <span class="pill ${pill}">${label}</span>
          <div class="w-stats">
            <span class="battery" title="Batería">
              <span class="battery-bar"><span class="battery-fill" style="width:${Math.min(w.bat, 100)}%;background:${batColor}"></span></span>
              ${w.bat}%
            </span>
            <span>${h(actEs(w.act))}</span>
            <span>${ago(w.ts)}</span>
          </div>
        </div>
      </button>`;
  }

  function renderCommands() {
    const build = (list) => list.map((c) =>
      `<button class="cmd ${c.cls}" data-cmd="${h(c.v)}" data-testid="cmd-${h(c.v)}">${h(c.l)}</button>`
    ).join('');
    $('cmdGrid').innerHTML = build(CMD_SUP);
    $('cmdGridTech').innerHTML = build(CMD_TECH);
  }

  function renderTwin() {
    const w = State.workers[State.selectedWorker] || State.workers[0];
    const mode = (w.act === 'desconocido' || w.act === 'unknown') ? 'OFF' : (w.mdw ? 'SOS' : 'DEFAULT');
    const modeState = w.mdw ? 'cr' : (mode === 'OFF' ? 'off' : 'ok');

    const initials = w.nm.split(' ').map((x) => x[0]).join('').slice(0, 2);
    // Keep helmet photo constant; initials kept only for accessibility fallback
    $('twName').innerHTML = `${h(w.nm)} <span class="live-pill">LIVE</span>`;
    $('twRole').textContent = `${w.rl} · ${w.id} · Piramid Solutions`;
    $('twHw').textContent = `FW ${w.fw} · CodeCell C6 (ESP32-C3) · Quectel EG912U-GL · BNO085 · VCNL4040`;
    $('twMode').textContent = mode;
    $('twMode').dataset.state = modeState;
    $('cmdTarget').textContent = w.id.replace('CMI-', '');

    const tile = (l, v, accent = '', smallV = false) =>
      `<div class="metric"${accent ? ` data-accent="${accent}"` : ''}>
         <div class="metric-v${smallV ? ' metric-v-sm' : ''}">${h(v)}</div>
         <div class="metric-l">${h(l)}</div>
       </div>`;

    $('twMetrics').innerHTML = [
      tile('Batería', w.bat + '%', w.bat < 20 ? 'cr' : 'ok'),
      tile('Actividad', actEs(w.act)),
      tile('Accel', w.ac.toFixed(1)),
      tile('Man-Down', w.mdw ? 'ACTIVO' : 'OK', w.mdw ? 'cr' : 'ok'),
      tile('GPS', w.gF ? 'FIX' : 'NO FIX', w.gF ? 'ok' : 'cr'),
      tile('Firmware', w.fw),
      tile('Uptime', ago(w.ts)),
      tile('Quectel', State.mqtt.connected ? 'Online' : '---', State.mqtt.connected ? 'ok' : 'cr'),
    ].join('');

    $('twImu').innerHTML = [
      tile('Pitch', w.p.toFixed(1) + '°', '', true),
      tile('Roll',  w.r.toFixed(1) + '°', '', true),
      tile('Yaw',   w.y.toFixed(1) + '°', '', true),
      tile('Accel', w.ac.toFixed(2) + ' m/s²', '', true),
      tile('Actividad', actEs(w.act), '', true),
      tile('Man-Down', w.mdw ? 'ACTIVO' : 'OK', w.mdw ? 'cr' : 'ok', true),
      tile('Proximidad', '---', '', true),
      tile('Luz', '---', '', true),
    ].join('');

    $('twGps').innerHTML = [
      tile('Lat',  w.lat || '---', '', true),
      tile('Lon',  w.lon || '---', '', true),
      tile('Sats', w.gS  || '0',   '', true),
      tile('HDOP', w.gH  || '---', '', true),
      tile('Alt',  w.gA  || '---', '', true),
      tile('UTC',  w.gU  || '---', '', true),
      tile('Activo', w.gF ? 'SÍ' : 'NO', w.gF ? 'ok' : 'cr', true),
      tile('Fixes', w.gFC || '---', '', true),
    ].join('');

    $('twConn').innerHTML = [
      tile('MQTT', State.mqtt.connected ? 'ONLINE' : 'OFFLINE', State.mqtt.connected ? 'ok' : 'cr', true),
      tile('WiFi', '---', 'bl', true),
      tile('LTE',  'EG912U-GL', 'cy', true),
      tile('Modo', mode, modeState === 'ok' ? 'ok' : 'cr', true),
    ].join('');
  }

  function renderDS() {
    const html = State.workers.map((w) => {
      const hrs = 2 + Math.floor(Math.random() * 6);
      const pct = Math.min(hrs / 8 * 100, 100);
      const c = pct > 80 ? 'var(--cr)' : pct > 60 ? 'var(--wr)' : 'var(--ok)';
      return `
        <div class="ds-row">
          <div class="ds-h">
            <span class="ds-n">${h(w.nm)}</span>
            <span class="ds-v" style="color:${c}">${hrs}h / 8h</span>
          </div>
          <div class="ds-bar"><div class="ds-fill" style="width:${pct}%;background:${c}"></div></div>
        </div>`;
    }).join('');
    $('dsList').innerHTML = html;
  }

  function renderUseCases() {
    const kinds = { l: 'LIVE', n: 'NUEVO', r: 'ROADMAP' };
    const tpl = (uc, k) => `
      <div class="uc">
        <div class="uc-b" data-kind="${k === 'l' ? 'lv' : k === 'n' ? 'nw' : 'rd'}">${kinds[k]}</div>
        <div class="uc-n">${h(uc.n)}</div>
        <div class="uc-d">${h(uc.d)}</div>
        <div class="uc-s">${h(uc.s)}</div>
      </div>`;
    $('ucLive').innerHTML = USE_CASES.filter((x) => x.p === 'l').map((x) => tpl(x, 'l')).join('');
    $('ucNew').innerHTML  = USE_CASES.filter((x) => x.p === 'n').map((x) => tpl(x, 'n')).join('');
    $('ucRoad').innerHTML = USE_CASES.filter((x) => x.p === 'r').map((x) => tpl(x, 'r')).join('');
  }

  function renderAll() {
    renderKPIs();
    renderAlerts();
    renderFleet();
    renderDS();
    if (State.currentView === 2) renderTwin();
    if (State.currentView === 1) {
      if (State.mapView === 'schema') { renderSchema(); }
      else { updateLeafletMarkers(); }
    }
  }

  const renderAllDebounced = debounce(renderAll, 60);

  // =========================================================================
  //                                SCHEMA MAP (SVG)
  // =========================================================================
  function renderSchema() {
    State.schemaMode === 'openpit' ? renderOpenPit() : renderUnderground();
  }

  function renderOpenPit() {
    const W = 900, H = 480, F = 'JetBrains Mono, monospace';
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vista Open Pit">`;
    s += `<defs><pattern id="gp" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0L0 0 0 30" fill="none" stroke="var(--bg-4)" stroke-width=".3"/></pattern></defs>`;
    s += `<rect width="${W}" height="${H}" fill="var(--bg-2)" rx="12"/>`;
    s += `<rect width="${W}" height="${H}" fill="url(#gp)" rx="12"/>`;
    s += `<text x="24" y="30" fill="var(--tx-2)" font-size="11" font-family="${F}" font-weight="500">OPEN PIT — VISTA PLANTA — MINA ATACAMA</text>`;
    s += `<text x="24" y="44" fill="var(--tx-3)" font-size="9" font-family="${F}">Elevación: 3,200 msnm · Profundidad: 480m · Diámetro: ~1.2km</text>`;
    const cx = 380, cy = 260;
    const benches = [
      { rx: 280, ry: 180, el: '+0m',   c: 'var(--tx-3)', o: .12 },
      { rx: 245, ry: 158, el: '-80m',  c: 'var(--tx-3)', o: .15 },
      { rx: 210, ry: 136, el: '-160m', c: 'var(--tx-3)', o: .18 },
      { rx: 175, ry: 114, el: '-240m', c: 'var(--wr)',   o: .22 },
      { rx: 140, ry: 92,  el: '-320m', c: 'var(--wr)',   o: .25 },
      { rx: 105, ry: 70,  el: '-400m', c: 'var(--or)',   o: .30 },
      { rx: 70,  ry: 48,  el: '-480m', c: 'var(--cr)',   o: .35 },
    ];
    benches.forEach((b, i) => {
      s += `<ellipse cx="${cx}" cy="${cy}" rx="${b.rx}" ry="${b.ry}" fill="${b.c}" fill-opacity="${b.o * .3}" stroke="${b.c}" stroke-width="${i === 6 ? 1 : .5}" stroke-opacity="${i > 4 ? .6 : .3}"/>`;
      if (i % 2 === 0) s += `<text x="${cx + b.rx + 6}" y="${cy + 4}" fill="${b.c}" font-size="8" font-family="${F}" opacity=".7">${b.el}</text>`;
    });
    // Haul road
    s += `<path d="M${cx + 280} ${cy - 20} Q${cx + 260} ${cy + 30} ${cx + 210} ${cy + 60} Q${cx + 150} ${cy + 90} ${cx + 120} ${cy + 50} Q${cx + 80} ${cy + 10} ${cx + 60} ${cy + 30} Q${cx + 20} ${cy + 60} ${cx - 10} ${cy + 20} Q${cx - 30} ${cy - 10} ${cx} ${cy}" fill="none" stroke="var(--wr)" stroke-width="3" stroke-opacity=".45" stroke-linecap="round" stroke-dasharray="8 4"/>`;
    s += `<text x="${cx + 240}" y="${cy + 75}" fill="var(--wr)" font-size="9" font-family="${F}" font-weight="500" opacity=".8">HAUL ROAD</text>`;

    // Buildings
    s += `<rect x="700" y="60" width="160" height="60" rx="6" fill="var(--ok-a)" stroke="var(--ok)" stroke-width=".8"/><text x="780" y="85" text-anchor="middle" fill="var(--ok)" font-size="10" font-family="${F}" font-weight="600">CHANCADOR</text><text x="780" y="100" text-anchor="middle" fill="var(--ok)" font-size="8" font-family="${F}" opacity=".7">Primario 60x89</text>`;
    s += `<rect x="720" y="380" width="140" height="60" rx="6" fill="var(--ok-a)" stroke="var(--ok)" stroke-width=".6" stroke-dasharray="3 2"/><text x="790" y="405" text-anchor="middle" fill="var(--ok)" font-size="10" font-family="${F}" font-weight="500">BOTADERO</text><text x="790" y="420" text-anchor="middle" fill="var(--tx-3)" font-size="8" font-family="${F}">Estéril Norte</text>`;
    s += `<ellipse cx="140" cy="400" rx="55" ry="30" fill="var(--cy-a)" stroke="var(--cy)" stroke-width=".6"/><text x="140" y="403" text-anchor="middle" fill="var(--cy)" font-size="9" font-family="${F}" font-weight="500">PISCINA</text><text x="140" y="417" text-anchor="middle" fill="var(--cy)" font-size="8" font-family="${F}" opacity=".7">Aguas claras</text>`;

    const zones = [
      { id: 'Z1', x: cx - 80, y: cy - 140, w: 120, h: 50, n: 'Pit Norte · N420',  c: 'var(--or)', da: false },
      { id: 'Z2', x: cx + 100, y: cy - 10, w: 100, h: 40, n: 'Rampa Principal',   c: 'var(--ok)', da: false },
      { id: 'Z3', x: cx - 40,  y: cy + 50, w: 130, h: 45, n: 'Frente Extracción B', c: 'var(--wr)', da: false },
      { id: 'Z4', x: cx - 200, y: cy + 30, w: 140, h: 55, n: 'Talud Sur · Inestable', c: 'var(--cr)', da: true },
    ];
    zones.forEach((z) => {
      if (z.da) {
        s += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="4" fill="${z.c}" fill-opacity=".05" stroke="${z.c}" stroke-width=".8" stroke-dasharray="5 3"><animate attributeName="stroke-opacity" values="1;.2;1" dur="1.5s" repeatCount="indefinite"/></rect>`;
      } else {
        s += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="4" fill="${z.c}" fill-opacity=".05" stroke="${z.c}" stroke-width=".6"/>`;
      }
      s += `<text x="${z.x + z.w / 2}" y="${z.y + z.h / 2 + 3}" text-anchor="middle" fill="${z.c}" font-size="10" font-weight="600" font-family="${F}">${z.n}</text>`;
    });

    const wpos = { Z1: [cx - 60, cy - 130], Z2: [cx + 115, cy], Z3: [cx - 20, cy + 60], Z4: [cx - 180, cy + 45], Z5: [735, 395] };
    State.workers.forEach((w, i) => {
      const pp = wpos[w.zn] || [cx, cy];
      const px = pp[0] + (i % 3) * 20;
      const py = pp[1] + Math.floor(i / 3) * 14;
      const c = w.mdw ? 'var(--cr)' : 'var(--ok)';
      if (w.mdw) s += `<circle cx="${px}" cy="${py}" r="10" fill="none" stroke="var(--cr)" stroke-width=".8"><animate attributeName="r" values="5;13;5" dur="1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0;.6" dur="1s" repeatCount="indefinite"/></circle>`;
      s += `<circle cx="${px}" cy="${py}" r="5" fill="${c}"/><circle cx="${px}" cy="${py}" r="2" fill="var(--bg-1)"/>`;
      s += `<text x="${px + 9}" y="${py + 3}" fill="var(--tx-2)" font-size="8" font-family="${F}">${i + 1}</text>`;
      if (w.re) s += `<circle cx="${px}" cy="${py - 8}" r="2.5" fill="var(--cy)"><animate attributeName="opacity" values="1;.3;1" dur="1s" repeatCount="indefinite"/></circle>`;
    });
    s += `</svg>`;
    $('schemaBox').innerHTML = s;
  }

  function renderUnderground() {
    const W = 900, H = 460, F = 'JetBrains Mono, monospace';
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mina subterránea">`;
    s += `<defs><pattern id="gu" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0L0 0 0 24" fill="none" stroke="var(--bg-4)" stroke-width=".3"/></pattern></defs>`;
    s += `<rect width="${W}" height="${H}" fill="var(--bg-2)" rx="12"/>`;
    s += `<rect width="${W}" height="${H}" fill="url(#gu)" rx="12"/>`;
    s += `<text x="24" y="32" fill="var(--tx-2)" font-size="11" font-family="${F}" font-weight="500">MINA SUBTERRÁNEA — PERFIL LONGITUDINAL</text>`;

    [{ y: 100, l: 'NIVEL-1 · -120m' }, { y: 200, l: 'NIVEL-2 · -220m' }, { y: 300, l: 'NIVEL-3 · -340m' }, { y: 400, l: 'NIVEL-4 · -480m' }].forEach((v) => {
      s += `<line x1="65" y1="${v.y}" x2="830" y2="${v.y}" stroke="var(--bg-4)" stroke-width="16" stroke-linecap="round" opacity=".4"/>`;
      s += `<line x1="65" y1="${v.y}" x2="830" y2="${v.y}" stroke="var(--bg-1)" stroke-width="12" stroke-linecap="round"/>`;
      s += `<text x="72" y="${v.y - 10}" fill="var(--tx-2)" font-family="${F}" font-size="10" letter-spacing="1.5" font-weight="500">${v.l}</text>`;
    });
    s += `<line x1="690" y1="85" x2="690" y2="415" stroke="var(--bg-4)" stroke-width="14" stroke-linecap="round" opacity=".4"/>`;
    s += `<line x1="690" y1="85" x2="690" y2="415" stroke="var(--bg-1)" stroke-width="10" stroke-linecap="round"/>`;
    s += `<text x="695" y="88" fill="var(--tx-2)" font-family="${F}" font-size="10" font-weight="500">RAMPA-N</text>`;
    s += `<line x1="780" y1="85" x2="780" y2="415" stroke="var(--bg-4)" stroke-width="14" stroke-linecap="round" opacity=".4"/>`;
    s += `<line x1="780" y1="85" x2="780" y2="415" stroke="var(--bg-1)" stroke-width="10" stroke-linecap="round"/>`;
    s += `<text x="785" y="88" fill="var(--tx-2)" font-family="${F}" font-size="10" font-weight="500">RAMPA-S</text>`;
    s += `<rect x="410" y="285" width="100" height="30" rx="4" fill="var(--cr-a)" stroke="var(--cr)" stroke-width=".8" stroke-dasharray="4 3"/>`;
    s += `<text x="418" y="299" fill="var(--cr)" font-family="${F}" font-size="10" font-weight="600">TRONADURA</text>`;
    s += `<text x="418" y="311" fill="var(--cr)" font-family="${F}" font-size="8" opacity=".6">NIVEL-3</text>`;

    // GEOFENCE RESTRINGIDA (nivel-4, zona colapso)
    s += `<g>`;
    s += `<rect x="520" y="375" width="230" height="55" rx="4" fill="none" stroke="var(--cr)" stroke-width="1.5" stroke-dasharray="6 4">`;
    s += `<animate attributeName="stroke-opacity" values="1;.3;1" dur="2s" repeatCount="indefinite"/></rect>`;
    s += `<rect x="520" y="375" width="230" height="55" rx="4" fill="url(#hatchR)" opacity=".35"/>`;
    s += `<defs><pattern id="hatchR" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`;
    s += `<line x1="0" y1="0" x2="0" y2="8" stroke="var(--cr)" stroke-width="1.5" opacity=".5"/></pattern></defs>`;
    s += `<text x="635" y="396" text-anchor="middle" fill="var(--cr)" font-family="${F}" font-size="10" font-weight="700" letter-spacing="1.5">⚠ ZONA RESTRINGIDA</text>`;
    s += `<text x="635" y="410" text-anchor="middle" fill="var(--cr)" font-family="${F}" font-size="8" opacity=".8">GEOFENCE · Colapso Nivel-4</text>`;
    s += `<text x="635" y="422" text-anchor="middle" fill="var(--cr)" font-family="${F}" font-size="7.5" opacity=".6">NO-GO · Autorización TURNO-SUP</text>`;
    s += `</g>`;

    const wp = [[140, 95], [270, 95], [420, 95], [570, 95], [140, 195], [270, 195], [420, 195], [170, 295]];
    State.workers.forEach((w, i) => {
      if (i >= wp.length) return;
      const [px, py] = wp[i];
      const c = w.mdw ? 'var(--cr)' : (w.st === 'wr' ? 'var(--wr)' : 'var(--ok)');
      if (w.mdw) s += `<circle cx="${px}" cy="${py}" r="10" fill="none" stroke="var(--cr)" stroke-width=".8"><animate attributeName="r" values="5;13;5" dur="1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0;.6" dur="1s" repeatCount="indefinite"/></circle>`;
      s += `<circle cx="${px}" cy="${py}" r="5.5" fill="${c}"/><circle cx="${px}" cy="${py}" r="2.5" fill="var(--bg-1)"/>`;
      s += `<text x="${px + 9}" y="${py + 4}" fill="var(--tx-2)" font-size="9" font-family="${F}">${w.id.replace('CMI-', '')}</text>`;
      if (w.re) s += `<circle cx="${px}" cy="${py - 9}" r="2.5" fill="var(--cy)"><animate attributeName="opacity" values="1;.3;1" dur="1s" repeatCount="indefinite"/></circle>`;
    });
    s += `</svg>`;
    $('schemaBox').innerHTML = s;
  }

  // =========================================================================
  //                                LEAFLET GPS
  // =========================================================================
  function initLeaflet() {
    if (typeof L === 'undefined') { setTimeout(initLeaflet, 300); return; }
    const { lat, lon } = CFG.mineCenter;
    const map = L.map('leafMap', { zoomControl: true, attributionControl: true }).setView([lat, lon], 15);

    // Google Maps tile layers (no key required for direct tile access — dev/demo use)
    // For production: recomendado migrar a Google Maps JS API con API key oficial
    const gSat = L.tileLayer(
      'https://mt0.google.com/vt/lyrs=s&hl=es&x={x}&y={y}&z={z}',
      { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google' }
    );
    const gHybrid = L.tileLayer(
      'https://mt0.google.com/vt/lyrs=y&hl=es&x={x}&y={y}&z={z}',
      { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google Hybrid' }
    );
    const gStreet = L.tileLayer(
      'https://mt0.google.com/vt/lyrs=m&hl=es&x={x}&y={y}&z={z}',
      { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google Maps' }
    );
    const gTerrain = L.tileLayer(
      'https://mt0.google.com/vt/lyrs=p&hl=es&x={x}&y={y}&z={z}',
      { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google Terrain' }
    );
    gHybrid.addTo(map);
    L.control.layers(
      { 'Satélite + Etiquetas': gHybrid, 'Satélite': gSat, 'Calles': gStreet, 'Terreno': gTerrain },
      null,
      { position: 'topright' }
    ).addTo(map);

    // Geofence circle: restricted zone near mine center (1km radius)
    L.circle([lat - 0.008, lon - 0.004], {
      radius: 250,
      color: '#ff5c6c',
      weight: 2,
      opacity: .75,
      fillColor: '#ff5c6c',
      fillOpacity: .18,
      dashArray: '6 4',
    }).addTo(map).bindPopup('<b>ZONA RESTRINGIDA</b><br>Talud sur inestable<br>Geofence activa');

    State.leaflet.map = map;
    setTimeout(() => map.invalidateSize(), 300);
    updateLeafletMarkers();
  }

  function updateLeafletMarkers() {
    const map = State.leaflet.map;
    if (!map) return;
    State.leaflet.markers.forEach((m) => map.removeLayer(m));
    State.leaflet.markers = [];

    let hasGps = false;
    State.workers.forEach((w) => {
      if (!w.lat || !w.lon) return;
      hasGps = true;
      const lat = parseFloat(w.lat), lon = parseFloat(w.lon);
      const col = w.mdw ? '#ff5c6c' : (w.st === 'ok' ? '#3cd4a6' : '#f5b83c');
      const icon = L.divIcon({
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: `<div style="width:22px;height:22px;border-radius:50%;background:${col};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#fff;font-family:'JetBrains Mono',monospace">${w.id.replace('CMI-', '')}</div>`,
      });
      const mk = L.marker([lat, lon], { icon }).addTo(map);
      mk.bindPopup(`<b>${h(w.nm)}</b><br>${h(w.rl)}<br>${h(w.id)}<br>Zona ${h(w.zn)}${w.mdw ? '<br><span style="color:red;font-weight:700">MAN-DOWN</span>' : ''}<br>Bat: ${w.bat}%<br>${h(actEs(w.act))}`);
      State.leaflet.markers.push(mk);
    });

    if (hasGps && State.leaflet.markers.length > 0) {
      const g = L.featureGroup(State.leaflet.markers);
      map.fitBounds(g.getBounds().pad(0.3));
    }
  }

  // =========================================================================
  //                                  MQTT
  // =========================================================================
  function setMqttStatus(state, label) {
    const pill = $('mqStatus');
    pill.dataset.state = state;
    $('mqLabel').textContent = label;
    State.mqtt.connected = state === 'on';
  }

  function connectMqtt() {
    if (typeof mqtt === 'undefined') { setTimeout(connectMqtt, 400); return; }

    State.mqtt.attempts++;
    setMqttStatus('retry', `CONECTANDO… (${State.mqtt.attempts})`);

    const client = mqtt.connect(CFG.mqttUrl, {
      username: CFG.mqttUser,
      password: CFG.mqttPass,
      rejectUnauthorized: false,
      reconnectPeriod: 5000,
    });

    client.on('connect', () => {
      setMqttStatus('on', 'LIVE');
      State.mqtt.attempts = 0;
      client.subscribe(CFG.topics.sensor);
      client.subscribe(CFG.topics.status);
      client.subscribe(CFG.topics.gps);
      logPush('MQTT conectado · suscrito a cmi/helmet/001/*');
      toast('ok', 'MQTT', 'Conectado a HiveMQ Cloud');
      renderAllDebounced();
    });

    client.on('error', (err) => {
      setMqttStatus('off', 'ERROR');
      logPush('MQTT error: ' + (err?.message || 'unknown'));
    });

    client.on('close', () => {
      setMqttStatus('off', 'OFFLINE');
      logPush('MQTT desconectado');
      renderAllDebounced();
    });

    client.on('reconnect', () => {
      setMqttStatus('retry', 'RECONECTANDO');
    });

    client.on('message', (topic, msg) => handleMessage(topic, msg));

    State.mqtt.client = client;
  }

  function handleMessage(topic, msg) {
    let d;
    try { d = JSON.parse(msg.toString()); } catch { return; }
    const w = State.workers[0]; // MQTT only streams CMI-001
    if (!w) return;

    if (topic.includes('/sensor')) {
      w.p = d.pitch ?? 0;
      w.r = d.roll ?? 0;
      w.y = d.yaw ?? 0;
      w.ac = d.accel ?? 0;
      w.act = actEs(d.activity || 'desconocido');
      w.bat = d.battery_pct ?? w.bat;
      w.lat = d.lat || '';
      w.lon = d.lon || '';
      if (d.mode) { w.mode = d.mode; updateHelmetMode(d.mode); }
      const wasMdw = w.mdw;
      w.mdw = d.man_down === true || d.man_down === 'true';
      w.gF = !!d.lat;
      w.ts = Date.now();
      w.st = w.mdw ? 'cr' : 'ok';
      if (d.gps_sats) w.gS = d.gps_sats;
      Sparks.push(w);
      if (State.currentView === 2) Sparks.renderAll();
      if (!wasMdw && w.mdw) { toast('cr', 'MAN-DOWN detectado', `${w.nm} (${w.id})`); Audio.alertManDown(); }
      logPush(`SNS p=${w.p.toFixed(1)} ac=${w.ac.toFixed(1)} ${w.act}`);
      renderAllDebounced();
    }
    else if (topic.includes('/status')) {
      const ev = d.event || d.mode || '';
      logPush('STS ' + ev);
      if (d.mode) { updateHelmetMode(d.mode); }
      if (ev) pushCmdFeedback('in', ev, true);
      if (d.alert === 'man_down') {
        const prev = w.mdw;
        w.mdw = true;
        w.st = 'cr';
        if (!prev) { toast('cr', 'MAN-DOWN', `${w.nm} (${w.id})`); Audio.alertManDown(); }
        renderAllDebounced();
      }
    }
    else if (topic.includes('/gps')) {
      w.lat = d.lat || w.lat;
      w.lon = d.lon || w.lon;
      w.gS = d.sats || w.gS;
      w.gH = d.hdop || '';
      w.gA = d.alt || '';
      w.gU = d.utc || '';
      w.gF = d.fix === true;
      if (d.fix_count !== undefined) w.gFC = d.fix_count;

      // Update satellite widgets
      if ($('satFix')) {
        $('satFix').textContent = w.gF ? 'SI' : 'NO';
        $('satFix').dataset.state = w.gF ? 'on' : 'off';
      }
      if ($('satCnt') && w.gFC !== undefined) $('satCnt').textContent = w.gFC;
      if (d.gsv) {
        const visMatch = String(d.gsv).match(/\$G.GSV,\d+,1,(\d+)/);
        if (visMatch && $('satVis')) $('satVis').textContent = visMatch[1];
        let snrCount = 0;
        const re = /,(\d{2,3})\*[0-9A-F]/g;
        let m;
        while ((m = re.exec(d.gsv)) !== null) if (parseInt(m[1]) > 0) snrCount++;
        if ($('satSig')) $('satSig').textContent = snrCount;
      }
      if (w.gS && $('satVis') && !d.gsv) $('satVis').textContent = w.gS;
      renderAllDebounced();
    }
  }

  function publishCmd(c) {
    const { client, connected } = State.mqtt;
    if (client && connected) client.publish(CFG.topics.cmd, c);
    logPush('CMD → ' + c);
    pushCmdFeedback('out', c, connected);
    // Visual ripple on the clicked button
    const btn = document.querySelector(`[data-cmd="${c}"]`);
    if (btn) { btn.classList.add('is-flash'); setTimeout(() => btn.classList.remove('is-flash'), 600); }
    toast(connected ? 'ok' : 'wr',
          connected ? 'Comando enviado' : 'Comando simulado',
          `${c}${connected ? ' → esperando ACK del casco...' : ' (MQTT offline)'}`);
  }

  function pushCmdFeedback(kind, cmd, ok = true) {
    const el = $('cmdFeedback');
    if (!el) return;
    const time = new Date().toLocaleTimeString('es-CL');
    let row = '';
    if (kind === 'out') {
      row = `<div class="fb-row fb-row-out"><span class="fb-time">${time}</span><span class="fb-arrow">→</span><span class="fb-cmd">${h(cmd)}</span><span class="fb-tag ${ok ? 'fb-tag-ok' : 'fb-tag-wr'}">${ok ? 'ENVIADO' : 'OFFLINE'}</span></div>`;
    } else {
      row = `<div class="fb-row fb-row-in"><span class="fb-time">${time}</span><span class="fb-arrow">←</span><span class="fb-cmd">${h(cmd)}</span><span class="fb-tag fb-tag-ack">ACK</span></div>`;
    }
    // Remove empty state if present
    const empty = el.querySelector('.cmd-feedback-empty');
    if (empty) empty.remove();
    el.insertAdjacentHTML('afterbegin', row);
    // Cap to 5 rows
    const rows = el.querySelectorAll('.fb-row');
    if (rows.length > 5) rows[rows.length - 1].remove();
  }

  function updateHelmetMode(mode) {
    const pill = $('modePill');
    const now = $('modeNow');
    if (!pill || !now) return;
    now.textContent = (mode || '—').toUpperCase();
    const state = mode === 'sos' ? 'cr'
              : mode === 'signal' ? 'wr'
              : mode === 'off' ? 'off'
              : mode === 'default' ? 'ok'
              : 'bl';
    pill.dataset.mode = state;
  }

  // =========================================================================
  //                                 UI / INPUT
  // =========================================================================
  function setView(n) {
    State.currentView = n;
    $$('.view').forEach((v, i) => {
      v.classList.toggle('is-active', i === n);
      v.hidden = i !== n;
    });
    $$('.nav-item').forEach((b, i) => {
      b.classList.toggle('is-active', i === n);
      b.setAttribute('aria-selected', i === n ? 'true' : 'false');
    });
    $('viewTitle').textContent = VIEW_META[n].t;
    $('viewSub').textContent = VIEW_META[n].s;
    Prefs.update({ view: n });

    if (n === 1) {
      if (State.mapView === 'schema') renderSchema();
      else if (State.leaflet.map) { setTimeout(() => { State.leaflet.map.invalidateSize(); updateLeafletMarkers(); }, 200); }
    }
    if (n === 2) { renderTwin(); setTimeout(() => Sparks.renderAll(), 50); }
    if (n === 5) { setTimeout(() => Analytics.render(), 80); }
    closeMobileSidebar();
  }

  function setMapView(v) {
    State.mapView = v;
    $('schemaWrap').hidden = v !== 'schema';
    $('gpsWrap').hidden = v !== 'gps';
    $('btnSchema').classList.toggle('is-on', v === 'schema');
    $('btnGps').classList.toggle('is-on', v === 'gps');
    if (v === 'gps') {
      if (!State.leaflet.map) initLeaflet();
      else { State.leaflet.map.invalidateSize(); updateLeafletMarkers(); }
    } else {
      renderSchema();
    }
    Prefs.update({ mapView: v });
  }

  function setSchemaMode(m) {
    State.schemaMode = m;
    $('btnUG').classList.toggle('is-on', m === 'underground');
    $('btnOP').classList.toggle('is-on', m === 'openpit');
    renderSchema();
    Prefs.update({ schemaMode: m });
  }

  function toggleTheme() {
    const d = document.documentElement;
    const t = d.dataset.theme === 'dark' ? 'light' : 'dark';
    d.dataset.theme = t;
    $('themeIco').innerHTML = t === 'dark'
      ? '<path fill="currentColor" d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/>'
      : '<path fill="currentColor" d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1m11.4-11.4 2.1-2.1"/>';
    Prefs.update({ theme: t });

    // Rebuild leaflet tiles if needed
    if (State.leaflet.map) {
      State.leaflet.map.remove();
      State.leaflet.map = null;
      State.leaflet.markers = [];
      if (State.mapView === 'gps' && State.currentView === 1) initLeaflet();
    }
  }

  function ackManDown(id) {
    State.workers.forEach((w) => {
      if (w.id === id) { w.mdw = false; w.st = 'ok'; w.p = 170; }
    });
    toast('ok', 'Reconocido', `Man-down de ${id} marcado como atendido`);
    logPush(`ACK Man-down ${id}`);
    renderAll();
  }

  function toggleEvac() {
    // Equivalente al botón SOS: publica 'sos' al casco. Sin toggle global de flota.
    publishCmd('sos');
    const btn = $('evacBtn');
    const lbl = btn.querySelector('.evac-lbl');
    btn.classList.add('is-active');
    lbl.textContent = '🚨 SOS ENVIADO · ' + new Date().toLocaleTimeString('es-CL');
    $('evacState').textContent = 'SOS ENVIADO';
    toast('cr', 'SOS ENVIADO', 'Comando de emergencia publicado al casco (CMI-001)');
    logPush('🚨 SOS via botón evacuación');
    Audio.alertManDown();
    // Revert label after 4s (UX feedback, no persistent state)
    setTimeout(() => {
      btn.classList.remove('is-active');
      lbl.textContent = 'ACTIVAR EVACUACIÓN (SOS)';
      $('evacState').textContent = 'STANDBY';
    }, 4000);
  }

  function selectWorker(i) {
    if (i < 0 || i >= State.workers.length) return;
    State.selectedWorker = i;
    renderFleet();
    setView(2);
  }

  function toggleMobileSidebar() { $('sidebar').classList.toggle('is-open'); }
  function closeMobileSidebar() { $('sidebar').classList.remove('is-open'); }

  // ------------------------------------------------------------- Toasts --
  function toast(kind, title, body) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.kind = kind;
    el.innerHTML = `<strong>${h(title)}</strong>${h(body)}`;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 280);
    }, 4000);
  }

  // ================================================================ BIND --
  function bind() {
    // Nav
    $$('.nav-item').forEach((b) => b.addEventListener('click', () => setView(+b.dataset.view)));
    // Menu
    $('menuBtn').addEventListener('click', toggleMobileSidebar);
    // Theme
    $('themeBtn').addEventListener('click', toggleTheme);
    // Search
    $('fleetSearch').addEventListener('input', debounce((e) => {
      State.search = e.target.value;
      renderFleet();
    }, 120));
    // Map segs
    $('btnSchema').addEventListener('click', () => setMapView('schema'));
    $('btnGps').addEventListener('click', () => setMapView('gps'));
    $('btnUG').addEventListener('click', () => setSchemaMode('underground'));
    $('btnOP').addEventListener('click', () => setSchemaMode('openpit'));
    // Evac
    $('evacBtn').addEventListener('click', toggleEvac);
    $('evacBtn2').addEventListener('click', toggleEvac);
    // Demo + Sound
    $('demoBtn').addEventListener('click', () => Demo.toggle());
    $('soundBtn').addEventListener('click', () => Audio.toggle());
    // Analytics report
    $('genReportBtn').addEventListener('click', () => Analytics.generateReport());
    // Subtabs
    $$('.subtab').forEach((b) => b.addEventListener('click', () => setSubtab(b.dataset.sub)));
    // Predictive / Prescriptive
    $('genPredBtn').addEventListener('click', () => Predictive.generate());
    $('genPrescBtn').addEventListener('click', () => Prescriptive.generate());
    // Logs filter
    $('logFilter').addEventListener('change', (e) => HistLogs.render(e.target.value));
    // Chat
    $('chatSendBtn').addEventListener('click', () => Chat.send($('chatInput').value));
    $('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); Chat.send(e.target.value); }
    });
    $('chatClearBtn').addEventListener('click', () => Chat.clear());
    $$('.chip-sug').forEach((b) => b.addEventListener('click', () => Chat.send(b.dataset.q)));

    // Event delegation for dynamic content
    document.body.addEventListener('click', (e) => {
      const cmdBtn = e.target.closest('[data-cmd]');
      if (cmdBtn) { publishCmd(cmdBtn.dataset.cmd); return; }
      const ack = e.target.closest('[data-ack]');
      if (ack) { ackManDown(ack.dataset.ack); return; }
      const wBtn = e.target.closest('[data-select]');
      if (wBtn) { selectWorker(+wBtn.dataset.select); return; }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key >= '1' && e.key <= '6') setView(+e.key - 1);
      else if (e.key.toLowerCase() === 't') toggleTheme();
      else if (e.key.toLowerCase() === 's') Audio.toggle();
      else if (e.key.toLowerCase() === 'd') Demo.toggle();
      else if (e.key === '/') { e.preventDefault(); $('fleetSearch').focus(); }
      else if (e.key === 'Escape') { $('fleetSearch').blur(); closeMobileSidebar(); }
    });

    // Clock
    setInterval(() => {
      $('clock').textContent = new Date().toLocaleString('es-CL');
    }, 1000);

    // Periodic re-render for "ago" timestamps
    setInterval(renderAllDebounced, 10000);
  }

  // =========================================================================
  //                              SPARKLINES
  // =========================================================================
  const Sparks = {
    history: { bat: [], acc: [], pit: [] },
    max: 60,

    push(w) {
      this.history.bat.push(w.bat);
      this.history.acc.push(w.ac);
      this.history.pit.push(w.p);
      for (const k of Object.keys(this.history)) {
        if (this.history[k].length > this.max) this.history[k].shift();
      }
    },

    draw(canvasId, data, color, fmt) {
      const el = $(canvasId);
      if (!el || !data.length) return;
      const css = getComputedStyle(document.documentElement);
      const colorV = css.getPropertyValue(color).trim() || '#f5a524';
      const muteV  = css.getPropertyValue('--bg-4').trim() || '#333';

      const ratio = window.devicePixelRatio || 1;
      const w = el.clientWidth || 240, h = el.clientHeight || 36;
      if (el.width !== w * ratio) { el.width = w * ratio; el.height = h * ratio; }
      const ctx = el.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const min = Math.min(...data), max = Math.max(...data);
      const range = max - min || 1;
      const pad = 3;
      const step = (w - pad * 2) / Math.max(data.length - 1, 1);

      // Baseline
      ctx.strokeStyle = muteV;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h - 1);
      ctx.lineTo(w, h - 1);
      ctx.stroke();

      // Fill gradient
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, colorV + '55');
      grad.addColorStop(1, colorV + '00');
      ctx.fillStyle = grad;

      ctx.beginPath();
      ctx.moveTo(pad, h - pad);
      data.forEach((v, i) => {
        const x = pad + i * step;
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        i === 0 ? ctx.lineTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.lineTo(pad + (data.length - 1) * step, h - pad);
      ctx.closePath();
      ctx.fill();

      // Line
      ctx.strokeStyle = colorV;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = pad + i * step;
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Last-point dot
      const last = data[data.length - 1];
      const lx = pad + (data.length - 1) * step;
      const ly = h - pad - ((last - min) / range) * (h - pad * 2);
      ctx.fillStyle = colorV;
      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fill();

      const valEl = $(canvasId.replace('sp', 'sp') + 'V');
      if (valEl && typeof fmt === 'function') valEl.textContent = fmt(last);
    },

    renderAll() {
      this.draw('spBat', this.history.bat, '--ok', (v) => Math.round(v) + '%');
      this.draw('spAcc', this.history.acc, '--cy', (v) => v.toFixed(2));
      this.draw('spPit', this.history.pit, '--ac', (v) => v.toFixed(1) + '°');
    },
  };

  // =========================================================================
  //                              AUDIO ALERTS
  // =========================================================================
  const Audio = {
    enabled: true,
    ctx: null,

    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch { /* no audio */ }
      }
    },

    beep(freq = 880, dur = 0.12, vol = 0.18) {
      if (!this.enabled) return;
      this.ensure();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + dur);
    },

    alertManDown() {
      if (!this.enabled) return;
      this.beep(880, 0.15);
      setTimeout(() => this.beep(660, 0.15), 180);
      setTimeout(() => this.beep(880, 0.22), 360);
    },

    toggle() {
      this.enabled = !this.enabled;
      const btn = $('soundBtn');
      btn.setAttribute('aria-pressed', this.enabled ? 'true' : 'false');
      Prefs.update({ sound: this.enabled });
      if (this.enabled) this.beep(1000, 0.08, 0.1);
      return this.enabled;
    },
  };

  // =========================================================================
  //                            ANALYTICS / HSE REPORTS
  // =========================================================================
  const Analytics = {
    history: null,
    selectedWorker: 0,
    period: 2160,  // default 90 días
    fleetSummary: null,  // cache 90-day summary for all workers (for chat context)

    async loadHistory(helmetId, hours = 24) {
      try {
        const r = await fetch(`/api/history/${encodeURIComponent(helmetId)}?hours=${hours}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('status ' + r.status);
        return await r.json();
      } catch (e) {
        console.warn('[history]', e.message);
        return null;
      }
    },

    async loadFleetSummary() {
      // Cache 90-day summary for ALL workers → used as chat context
      if (this.fleetSummary) return this.fleetSummary;
      try {
        const ids = State.workers.map((w) => w.id).join(',');
        const r = await fetch(`/api/fleet-summary?days=90&ids=${encodeURIComponent(ids)}`, { cache: 'no-store' });
        if (r.ok) this.fleetSummary = await r.json();
      } catch (e) {
        console.warn('[fleet-summary]', e.message);
      }
      return this.fleetSummary;
    },

    async render() {
      // Preload fleet-summary in background (for chat context)
      this.loadFleetSummary();

      // KPIs
      const fleet = State.workers;
      const online = fleet.filter((w) => w.st !== 'off').length;
      $('anOps').textContent = (online * 8) + 'h';
      const incCount = fleet.filter((w) => w.mdw).length + fleet.filter((w) => w.st === 'wr').length;
      $('anInc').textContent = incCount;
      $('anExp').textContent = Math.floor(fleet.length * 0.25);
      $('anScore').textContent = '—';

      this.drawActivityChart();
      this.drawZoneChart();

      // Worker selector (20 trabajadores)
      const sel = $('anWorker');
      if (!sel.options.length) {
        sel.innerHTML = State.workers.map((w, i) =>
          `<option value="${i}">${w.nm} · ${w.id}${w.re ? ' · LIVE' : ''}</option>`).join('');
        sel.addEventListener('change', (e) => {
          this.selectedWorker = +e.target.value;
          this.renderWorkerHistory();
        });
      }
      // Period selector
      const pSel = $('anPeriod');
      if (pSel && !pSel.dataset.bound) {
        pSel.dataset.bound = '1';
        pSel.addEventListener('change', (e) => {
          this.period = +e.target.value;
          this.renderWorkerHistory();
        });
      }
      await this.renderWorkerHistory();
    },

    async renderWorkerHistory() {
      const w = State.workers[this.selectedWorker];
      if (!w) return;
      const data = await this.loadHistory(w.id, this.period);
      if (!data) return;
      this.history = data;

      const s = data.summary;
      const periodLabel = data.range_hours >= 720 ? `${Math.round(data.range_hours / 24)} días` : `${data.range_hours}h`;
      const tile = (l, v, accent = '') =>
        `<div class="metric"${accent ? ` data-accent="${accent}"` : ''}>
           <div class="metric-v metric-v-sm">${v}</div>
           <div class="metric-l">${l}</div>
         </div>`;

      $('anWorkerKpis').innerHTML = [
        tile(`Batería promedio · ${periodLabel}`, s.battery_avg + '%', s.battery_avg < 50 ? 'cr' : 'ok'),
        tile('Batería mínima', s.battery_min + '%', 'wr'),
        tile('% Caminando', s.walking_pct + '%', 'ok'),
        tile(`Incidentes · ${periodLabel}`, s.incidents_count, s.incidents_count ? 'cr' : 'ok'),
      ].join('');

      // Sparklines for this worker's history
      this.drawSpark('hsBat', data.battery.map((p) => p.v), '--ok', (v) => Math.round(v) + '%');
      this.drawSpark('hsAcc', data.accel.map((p) => p.v), '--cy', (v) => v.toFixed(2));
      this.drawSpark('hsPit', data.pitch.map((p) => p.v), '--ac', (v) => v.toFixed(1) + '°');

      // Incidents list
      const gran = data.granularity_sec || 600;
      $('anIncidents').innerHTML = data.incidents.length
        ? data.incidents.map((inc) => {
            const secAgo = data.range_hours * 3600 - inc.t;
            const when = secAgo < 86400
              ? `hace ${Math.floor(secAgo / 3600)}h`
              : `hace ${Math.floor(secAgo / 86400)}d`;
            return `<div class="alert alert-wr">
              <div class="alert-ty" style="color:var(--wr)">${h(inc.type)}</div>
              <div class="alert-m">${h(w.nm)} · Zona ${h(inc.zone)}</div>
              <div class="alert-x">${when} · granularidad ${Math.round(gran / 60)}min</div></div>`;
          }).join('')
        : '<div class="empty-state">Sin incidentes en el período</div>';
    },

    drawSpark(id, data, colorVar, fmt) {
      const el = $(id);
      if (!el || !data.length) return;
      const css = getComputedStyle(document.documentElement);
      const color = css.getPropertyValue(colorVar).trim() || '#f5a524';
      const ratio = window.devicePixelRatio || 1;
      const w = el.clientWidth || 600, ht = el.clientHeight || 54;
      if (el.width !== w * ratio) { el.width = w * ratio; el.height = ht * ratio; }
      const ctx = el.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, ht);
      const min = Math.min(...data), max = Math.max(...data);
      const range = max - min || 1;
      const step = (w - 6) / Math.max(data.length - 1, 1);

      const grad = ctx.createLinearGradient(0, 0, 0, ht);
      grad.addColorStop(0, color + '50');
      grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(3, ht - 3);
      data.forEach((v, i) => {
        const x = 3 + i * step;
        const y = ht - 3 - ((v - min) / range) * (ht - 6);
        ctx.lineTo(x, y);
      });
      ctx.lineTo(3 + (data.length - 1) * step, ht - 3);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = 3 + i * step;
        const y = ht - 3 - ((v - min) / range) * (ht - 6);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      const valEl = $(id + 'V');
      if (valEl) valEl.textContent = fmt ? fmt(data[data.length - 1]) : data[data.length - 1];
    },

    drawActivityChart() {
      const el = $('chActivity');
      if (!el) return;
      const css = getComputedStyle(document.documentElement);
      const cOk = css.getPropertyValue('--ok').trim();
      const cBl = css.getPropertyValue('--bl').trim();
      const cMute = css.getPropertyValue('--tx-3').trim();
      const cBg = css.getPropertyValue('--bg-3').trim();

      const ratio = window.devicePixelRatio || 1;
      const w = el.clientWidth || 600, ht = 180;
      if (el.width !== w * ratio) { el.width = w * ratio; el.height = ht * ratio; }
      const ctx = el.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, ht);

      // 24 hourly bars
      const hours = 24;
      const barW = (w - 40) / hours * 0.72;
      const gap = (w - 40) / hours * 0.28;
      const maxH = ht - 30;
      for (let i = 0; i < hours; i++) {
        const x = 30 + i * (barW + gap);
        // Synthesize a consistent pattern
        const walking = 40 + Math.abs(Math.sin(i * 0.6)) * 30;
        const driving = 20 + Math.abs(Math.cos(i * 0.5)) * 20;
        const still = 100 - walking - driving;
        let yCursor = ht - 16;

        // still
        let h1 = (still / 100) * maxH;
        ctx.fillStyle = cMute;
        ctx.fillRect(x, yCursor - h1, barW, h1);
        yCursor -= h1;
        // driving
        const h2 = (driving / 100) * maxH;
        ctx.fillStyle = cBl;
        ctx.fillRect(x, yCursor - h2, barW, h2);
        yCursor -= h2;
        // walking
        const h3 = (walking / 100) * maxH;
        ctx.fillStyle = cOk;
        ctx.fillRect(x, yCursor - h3, barW, h3);

        // hour label
        if (i % 4 === 0) {
          ctx.fillStyle = cMute;
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${i}h`, x + barW / 2, ht - 4);
        }
      }
      // Y axis baseline
      ctx.strokeStyle = cBg;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(30, ht - 16);
      ctx.lineTo(w - 10, ht - 16);
      ctx.stroke();
    },

    drawZoneChart() {
      const el = $('chZones');
      if (!el) return;
      const css = getComputedStyle(document.documentElement);
      const cAc = css.getPropertyValue('--ac').trim();
      const cCr = css.getPropertyValue('--cr').trim();
      const cWr = css.getPropertyValue('--wr').trim();
      const cMute = css.getPropertyValue('--tx-3').trim();

      const ratio = window.devicePixelRatio || 1;
      const w = el.clientWidth || 600, ht = 180;
      if (el.width !== w * ratio) { el.width = w * ratio; el.height = ht * ratio; }
      const ctx = el.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, ht);

      const zones = [
        { n: 'Z1', v: 3, c: cAc },
        { n: 'Z2', v: 5, c: cWr },
        { n: 'Z3', v: 2, c: cAc },
        { n: 'Z4', v: 7, c: cCr },
        { n: 'Z5', v: 1, c: cAc },
      ];
      const max = Math.max(...zones.map((z) => z.v));
      const colW = (w - 80) / zones.length;
      zones.forEach((z, i) => {
        const x = 60 + i * colW + 10;
        const bh = (z.v / max) * (ht - 50);
        const y = ht - 30 - bh;
        // Bar
        const grad = ctx.createLinearGradient(0, y, 0, y + bh);
        grad.addColorStop(0, z.c);
        grad.addColorStop(1, z.c + '66');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, colW - 20, bh);
        // Value
        ctx.fillStyle = z.c;
        ctx.font = '700 13px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(z.v, x + (colW - 20) / 2, y - 6);
        // Label
        ctx.fillStyle = cMute;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(z.n, x + (colW - 20) / 2, ht - 12);
      });
    },

    async generateReport() {
      const btn = $('genReportBtn');
      const lbl = $('genReportLbl');
      btn.disabled = true;
      lbl.textContent = 'Analizando…';
      $('reportBody').innerHTML = '<div class="report-loading"><div class="spinner"></div><div>Gemini está analizando la flota, incidentes y exposición DS594…</div></div>';

      const fleet = State.workers.map((w) => ({
        id: w.id, nombre: w.nm, rol: w.rl, zona: w.zn,
        estado: w.st, man_down: w.mdw, bateria: w.bat,
        actividad: actEs(w.act), pitch: Math.round(w.p), accel: +w.ac.toFixed(2),
      }));
      const incidents = State.workers.filter((w) => w.mdw || w.st === 'wr').map((w) => ({
        casco: w.id, trabajador: w.nm, tipo: w.mdw ? 'man-down' : 'alerta', zona: w.zn,
      }));
      const exposure = State.workers.map((w) => ({
        trabajador: w.nm, casco: w.id, horas_expuesto: (2 + Math.abs((w.id.charCodeAt(5) || 0) % 6)).toString() + 'h',
      }));

      try {
        const r = await fetch('/api/analytics/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fleet, incidents, exposure, period: 'Turno actual · ' + new Date().toLocaleString('es-CL') }),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        const html = this.markdownToHtml(data.report || 'Sin contenido');
        $('reportBody').innerHTML = html;
        $('reportMeta').textContent = `${data.model} · ${new Date(data.generated_at).toLocaleTimeString('es-CL')}`;

        // Extract score (0-100)
        const scoreMatch = (data.report || '').match(/(?:Score\s*HSE[\s\S]{0,80}?)(\d{1,3})/i);
        if (scoreMatch) $('anScore').textContent = scoreMatch[1];

        toast('ok', 'Reporte HSE generado', 'Gemini completó el análisis');
      } catch (e) {
        $('reportBody').innerHTML = `<div class="empty-state" style="color:var(--cr)">Error generando reporte: ${h(e.message)}. Revisa EMERGENT_LLM_KEY en backend/.env</div>`;
        toast('cr', 'Error', 'No se pudo generar el reporte HSE');
      } finally {
        btn.disabled = false;
        lbl.textContent = 'Regenerar reporte';
      }
    },

    markdownToHtml(md) {
      // Minimal markdown renderer (headings, bold, italic, lists, tables, code, quotes)
      const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const lines = md.split('\n');
      let html = '';
      let inList = false, inOL = false, inTable = false, tableHeader = false;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trimEnd();

        if (/^#{1}\s+/.test(line)) { if (inList) { html += inOL ? '</ol>' : '</ul>'; inList = false; } html += `<h1>${esc(line.replace(/^#\s+/, ''))}</h1>`; continue; }
        if (/^#{2}\s+/.test(line)) { if (inList) { html += inOL ? '</ol>' : '</ul>'; inList = false; } html += `<h2>${esc(line.replace(/^#{2}\s+/, ''))}</h2>`; continue; }
        if (/^#{3}\s+/.test(line)) { if (inList) { html += inOL ? '</ol>' : '</ul>'; inList = false; } html += `<h3>${esc(line.replace(/^#{3}\s+/, ''))}</h3>`; continue; }

        // Tables
        if (/^\|.*\|$/.test(line)) {
          const cells = line.slice(1, -1).split('|').map((c) => c.trim());
          if (/^[\s\-:|]+$/.test(line)) { tableHeader = false; continue; }
          if (!inTable) { html += '<table>'; inTable = true; tableHeader = true; }
          const tag = tableHeader ? 'th' : 'td';
          html += '<tr>' + cells.map((c) => `<${tag}>${formatInline(c)}</${tag}>`).join('') + '</tr>';
          tableHeader = false;
          continue;
        } else if (inTable) { html += '</table>'; inTable = false; }

        // Ordered list
        if (/^\s*\d+\.\s+/.test(line)) {
          if (!inList || !inOL) { if (inList) html += '</ul>'; html += '<ol>'; inList = true; inOL = true; }
          html += `<li>${formatInline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`;
          continue;
        }
        // Unordered list
        if (/^\s*[-*]\s+/.test(line)) {
          if (!inList || inOL) { if (inList) html += '</ol>'; html += '<ul>'; inList = true; inOL = false; }
          html += `<li>${formatInline(line.replace(/^\s*[-*]\s+/, ''))}</li>`;
          continue;
        }
        if (inList) { html += inOL ? '</ol>' : '</ul>'; inList = false; }

        if (/^>\s+/.test(line)) { html += `<blockquote>${formatInline(line.replace(/^>\s+/, ''))}</blockquote>`; continue; }

        if (line.trim()) html += `<p>${formatInline(line)}</p>`;
      }
      if (inList) html += inOL ? '</ol>' : '</ul>';
      if (inTable) html += '</table>';
      return html;

      function formatInline(s) {
        s = esc(s);
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        return s;
      }
    },
  };


  const Demo = {
    active: false,
    timer: null,
    tick: 0,

    toggle() {
      this.active = !this.active;
      const btn = $('demoBtn');
      btn.setAttribute('aria-pressed', this.active ? 'true' : 'false');
      if (this.active) {
        this.start();
        toast('wr', 'MODO DEMO activado', 'Datos simulados para presentación');
        logPush('DEMO ON — simulando telemetría');
      } else {
        this.stop();
        toast('ok', 'MODO DEMO desactivado', 'Volviendo a datos reales MQTT');
        logPush('DEMO OFF');
      }
      Prefs.update({ demo: this.active });
    },

    start() {
      this.stop();
      this.tick = 0;
      this.timer = setInterval(() => this.step(), 1200);
    },

    stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

    step() {
      this.tick++;
      const w = State.workers[0];
      if (!w) return;

      // Oscillating realistic data
      const t = this.tick;
      w.p  = 160 + Math.sin(t * 0.3) * 8 + (Math.random() * 2 - 1);
      w.r  = Math.sin(t * 0.2) * 5;
      w.y  = (t * 2) % 360;
      w.ac = 9.6 + Math.sin(t * 0.4) * 0.5 + Math.random() * 0.2;
      w.bat = Math.max(0, w.bat - (Math.random() > 0.85 ? 1 : 0));
      w.act = ['caminando', 'quieto', 'conduciendo', 'caminando'][t % 4];
      w.lat = (-27.366 + Math.sin(t * 0.1) * 0.002).toFixed(5);
      w.lon = (-70.332 + Math.cos(t * 0.1) * 0.002).toFixed(5);
      w.gF = true; w.gS = String(6 + Math.floor(Math.random() * 5));
      w.ts = Date.now();

      // Scripted scenarios
      if (t === 8) {
        // Scenario: geofence breach on worker 2
        State.workers[2].st = 'wr';
        toast('wr', 'Geofence breach', 'Pedro Aravena entró a Zona Z4 restringida');
        logPush('⚠ Geofence breach · Pedro Aravena · Z4');
      }
      if (t === 14) {
        // Scenario: Man-Down on worker 0 (the live one)
        w.mdw = true; w.st = 'cr'; w.p = 48; w.ac = 2.3; w.act = 'quieto';
        toast('cr', 'MAN-DOWN detectado', 'Luis Campusano (CMI-001) — pitch 48°');
        Audio.alertManDown();
        logPush('🚨 MAN-DOWN · CMI-001 · pitch=48°');
      }
      if (t === 22) {
        w.mdw = false; w.st = 'ok'; w.p = 168;
        toast('ok', 'Man-down reconocido', 'Operador reportó estado normal');
        logPush('✔ Man-down resuelto · CMI-001');
      }
      if (t === 30) {
        this.tick = 0; // loop scenarios
      }

      Sparks.push(w);
      if (State.currentView === 2) Sparks.renderAll();
      renderAllDebounced();
    },
  };

  // =========================================================================
  //                              CHAT IA
  // =========================================================================
  const Chat = {
    history: [],

    push(role, content) { this.history.push({ role, content }); },

    snapshot() {
      const snap = {
        timestamp: new Date().toISOString(),
        fleet: State.workers.map((w) => ({
          id: w.id, nombre: w.nm, rol: w.rl, zona: w.zn,
          estado: w.st, man_down: w.mdw, bateria: w.bat,
          actividad: actEs(w.act), ubicacion: w.loc || '',
          gps: w.lat ? `${w.lat}, ${w.lon}` : 'sin fix',
          pitch: Math.round(w.p), accel: +w.ac.toFixed(2),
          tiempo_real: !!w.re,  // solo Luis = true
        })),
        evac_active: State.evacActive,
        mqtt_live: State.mqtt.connected,
      };
      // Include long-term summary (90 days) if preloaded
      if (Analytics.fleetSummary) {
        snap.historico_90dias = Analytics.fleetSummary;
      }
      return snap;
    },

    renderMessages() {
      const box = $('chatMessages');
      const welcome = box.querySelector('.chat-msg-ai:first-child');
      const welcomeHTML = welcome ? welcome.outerHTML : '';
      box.innerHTML = welcomeHTML;
      this.history.forEach((m) => box.appendChild(this.bubble(m.role, m.content)));
      box.scrollTop = box.scrollHeight;
    },

    bubble(role, content) {
      const el = document.createElement('div');
      el.className = 'chat-msg chat-msg-' + (role === 'user' ? 'user' : 'ai');
      const av = role === 'user' ? 'TÚ' : 'AI';
      const avCls = role === 'user' ? 'chat-avatar-user' : 'chat-avatar-ai';
      el.innerHTML = `<div class="chat-avatar ${avCls}">${av}</div><div class="chat-bubble">${this.fmt(content)}</div>`;
      return el;
    },

    fmt(text) {
      let s = h(text);
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      const lines = s.split('\n');
      let out = '', inUL = false;
      for (const line of lines) {
        if (/^\s*[-*]\s+/.test(line)) {
          if (!inUL) { out += '<ul>'; inUL = true; }
          out += `<li>${line.replace(/^\s*[-*]\s+/, '')}</li>`;
        } else {
          if (inUL) { out += '</ul>'; inUL = false; }
          if (line.trim()) out += line + '<br>';
        }
      }
      if (inUL) out += '</ul>';
      return out;
    },

    showTyping() {
      const box = $('chatMessages');
      const el = document.createElement('div');
      el.id = 'chat-typing-indicator';
      el.className = 'chat-msg chat-msg-ai';
      el.innerHTML = `<div class="chat-avatar chat-avatar-ai">AI</div><div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>`;
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
    },

    hideTyping() {
      const el = $('chat-typing-indicator');
      if (el) el.remove();
    },

    async send(text) {
      text = (text || '').trim();
      if (!text) return;
      this.push('user', text);
      this.renderMessages();
      $('chatInput').value = '';
      $('chatSendBtn').disabled = true;
      this.showTyping();

      try {
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: this.history, context: this.snapshot() }),
        });
        const data = await r.json();
        this.hideTyping();
        if (!r.ok) throw new Error(data.detail || 'HTTP ' + r.status);
        this.push('assistant', data.reply);
        this.renderMessages();
      } catch (e) {
        this.hideTyping();
        this.push('assistant', '⚠ Error: ' + e.message);
        this.renderMessages();
      } finally {
        $('chatSendBtn').disabled = false;
        $('chatInput').focus();
      }
    },

    clear() { this.history = []; this.renderMessages(); },
  };

  // =========================================================================
  //                          PREDICTIVE & PRESCRIPTIVE
  // =========================================================================
  const Predictive = {
    async generate() {
      const btn = $('genPredBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-ico">⏳</span><span>Analizando…</span>';
      try {
        const r = await fetch('/api/analytics/predictive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fleet: Chat.snapshot().fleet, incidents: [], exposure: [], period: '24h' }),
        });
        const data = await r.json();
        this.render(data);
        toast('ok', 'Predicción generada', `Pico de riesgo: ${data.peak_hour || '—'}`);
      } catch (e) {
        toast('cr', 'Error predicción', e.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-ico">✦</span><span>Recalcular con IA</span>';
      }
    },
    render(data) {
      $('predPeak').textContent = data.peak_hour || '—';
      $('predWorker').textContent = data.top_worker?.name || '—';
      $('predConf').textContent = data.confidence ? Math.round(data.confidence * 100) + '%' : '—';
      this.drawForecast(data.forecast_8h || []);
      const pats = data.patterns || [];
      $('predPatterns').innerHTML = pats.length
        ? pats.map((p) => {
            const cls = p.impact === 'alto' ? 'cr' : p.impact === 'medio' ? 'wr' : 'bl';
            return `<div class="pattern-row">
              <span class="chip chip-${cls}">${h(p.impact || 'medio').toUpperCase()}</span>
              <div><strong style="color:var(--tx-0)">${h(p.name)}</strong><br><span style="color:var(--tx-2);font-size:12px">${h(p.note || '')}</span></div>
              <span class="pattern-conf" style="color:var(--${cls})">${p.impact || ''}</span>
            </div>`;
          }).join('')
        : '<div class="empty-state">Sin patrones detectados</div>';
    },
    drawForecast(data) {
      const el = $('chForecast');
      if (!el || !data.length) return;
      const css = getComputedStyle(document.documentElement);
      const cOk = css.getPropertyValue('--ok').trim();
      const cWr = css.getPropertyValue('--wr').trim();
      const cCr = css.getPropertyValue('--cr').trim();
      const cMute = css.getPropertyValue('--tx-3').trim();
      const ratio = window.devicePixelRatio || 1;
      const w = el.clientWidth || 800, ht = 220;
      if (el.width !== w * ratio) { el.width = w * ratio; el.height = ht * ratio; }
      const ctx = el.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, ht);
      const padL = 50, padB = 28, padT = 14;
      const chartH = ht - padB - padT;
      ctx.strokeStyle = css.getPropertyValue('--bg-3').trim();
      ctx.lineWidth = 1;
      [0, .25, .5, .75, 1].forEach((p) => {
        const y = padT + chartH * (1 - p);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - 10, y); ctx.stroke();
        ctx.fillStyle = cMute; ctx.font = '10px "JetBrains Mono"';
        ctx.textAlign = 'right'; ctx.fillText((p * 100) + '%', padL - 8, y + 3);
      });
      const colW = (w - padL - 20) / data.length;
      data.forEach((d, i) => {
        const x = padL + i * colW + 6;
        const r = +d.risk || 0;
        const bh = r * chartH;
        const y = padT + chartH - bh;
        const c = r > 0.66 ? cCr : r > 0.33 ? cWr : cOk;
        const grad = ctx.createLinearGradient(0, y, 0, y + bh);
        grad.addColorStop(0, c); grad.addColorStop(1, c + '50');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, colW - 12, bh);
        ctx.fillStyle = c;
        ctx.font = '700 11px "JetBrains Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(r * 100) + '', x + (colW - 12) / 2, y - 5);
        ctx.fillStyle = cMute;
        ctx.font = '10px "JetBrains Mono"';
        ctx.fillText(d.hour || '', x + (colW - 12) / 2, ht - 10);
      });
    },
  };

  const Prescriptive = {
    async generate() {
      const btn = $('genPrescBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-ico">⏳</span><span>Generando…</span>';
      try {
        const r = await fetch('/api/analytics/prescriptive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fleet: Chat.snapshot().fleet, incidents: [], exposure: [] }),
        });
        const data = await r.json();
        const actions = data.actions || [];
        $('prescActions').innerHTML = actions.length
          ? actions.map((a, i) => {
              const pri = (a.priority || 'media').toLowerCase();
              const cls = pri === 'alta' ? 'h' : pri === 'baja' ? 'l' : 'm';
              return `<div class="action-card">
                <div class="action-num">${i + 1}</div>
                <div class="action-body">
                  <strong>${h(a.action || '')}</strong>
                  <span>👤 ${h(a.responsible || '—')} · 🕐 ${h(a.deadline || '—')}</span>
                </div>
                <span class="action-priority action-priority-${cls}">${pri.toUpperCase()}</span>
              </div>`;
            }).join('')
          : '<div class="empty-state">Sin acciones generadas</div>';
        toast('ok', 'Acciones generadas', `${actions.length} recomendaciones por Gemini`);
      } catch (e) {
        toast('cr', 'Error', e.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-ico">⚡</span><span>Regenerar</span>';
      }
    },
  };

  // =========================================================================
  //                         HISTORIC LOGS (30 days, mock)
  // =========================================================================
  const HistLogs = {
    data: [],
    seed() {
      const types = [
        { t: 'cr', tag: 'MAN-DOWN',   tpl: 'Caída detectada · {worker} ({id}) · pitch {pitch}° · Zona {zn}' },
        { t: 'wr', tag: 'GEOFENCE',   tpl: 'Trabajador {worker} entró a zona restringida {zn}' },
        { t: 'wr', tag: 'BATERÍA',    tpl: 'Batería bajo umbral en {id} ({worker}) · {bat}%' },
        { t: 'ok', tag: 'COMANDO',    tpl: 'Supervisor envió comando "{cmd}" a {id}' },
        { t: 'ok', tag: 'CONEXIÓN',   tpl: '{id} reconectado a HiveMQ · LTE Cat1 · CSQ 18' },
        { t: 'cr', tag: 'EVACUACIÓN', tpl: 'Evacuación activada · SOS broadcast a 8 cascos' },
        { t: 'wr', tag: 'TRONADURA',  tpl: 'Aviso de tronadura programada · Nivel-3 · {worker} confirmado' },
        { t: 'ok', tag: 'TURNO',      tpl: 'Inicio de turno · {worker} ({id}) en posición · Zona {zn}' },
        { t: 'bl', tag: 'GPS',        tpl: 'GPS fix obtenido en {id} · sats=12 · HDOP 0.8' },
        { t: 'ok', tag: 'ACK',        tpl: 'Reconocimiento man-down · {id} · operador respondió OK' },
      ];
      const cmds = ['default', 'signal', 'gps_on', 'recover', 'status'];
      const events = [];
      const now = Date.now();
      for (let d = 0; d < 30; d++) {
        const eventsToday = 5 + Math.floor(Math.random() * 8);
        for (let e = 0; e < eventsToday; e++) {
          const tt = types[Math.floor(Math.random() * types.length)];
          const w = State.workers[Math.floor(Math.random() * State.workers.length)];
          const ts = now - d * 86400000 - Math.random() * 86400000;
          const msg = tt.tpl
            .replace('{worker}', w.nm).replace('{id}', w.id).replace('{zn}', w.zn)
            .replace('{pitch}', String(40 + Math.floor(Math.random() * 30)))
            .replace('{bat}', String(15 + Math.floor(Math.random() * 15)))
            .replace('{cmd}', cmds[Math.floor(Math.random() * cmds.length)]);
          events.push({ ts, t: tt.t, tag: tt.tag, msg, worker: w.nm });
        }
      }
      this.data = events.sort((a, b) => b.ts - a.ts);
    },
    render(filter = 'all') {
      const list = filter === 'all' ? this.data : this.data.filter((e) => e.t === filter);
      const el = $('histLogs');
      if (!list.length) { el.innerHTML = '<div class="empty-state">Sin eventos</div>'; return; }
      el.innerHTML = list.slice(0, 200).map((e) => {
        const date = new Date(e.ts);
        const day = date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
        const time = date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        return `<div class="log-entry">
          <div class="log-time">${day}<br>${time}</div>
          <span class="log-tag log-tag-${e.t}">${e.tag}</span>
          <div class="log-msg">${h(e.msg)}<span class="log-meta">${h(e.worker)}</span></div>
        </div>`;
      }).join('');
    },
  };

  function setSubtab(name) {
    $$('.subtab').forEach((b) => b.classList.toggle('is-on', b.dataset.sub === name));
    $$('.subview').forEach((v) => {
      const isOn = v.id === 'sub-' + name;
      v.classList.toggle('is-on', isOn);
      v.hidden = !isOn;
    });
    if (name === 'logs' && !HistLogs.data.length) { HistLogs.seed(); HistLogs.render(); }
    if (name === 'chat') setTimeout(() => $('chatInput').focus(), 50);
  }



  async function init() {
    const prefs = Prefs.load();
    if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;

    seedFleet();
    renderCommands();
    renderUseCases();
    renderAll();
    renderSchema();
    bind();

    // Load MQTT creds from backend env (not hardcoded)
    await loadRuntimeConfig();
    if (CFG.mqttUrl) {
      connectMqtt();
    } else {
      setMqttStatus('off', 'NO CONFIG');
      logPush('Sin credenciales MQTT — activa DEMO para simular');
    }

    // Restore last view & map
    if (typeof prefs.view === 'number') setView(prefs.view);
    if (prefs.mapView) State.mapView = prefs.mapView;
    if (prefs.schemaMode) State.schemaMode = prefs.schemaMode;

    // Fix theme icon
    if (document.documentElement.dataset.theme === 'light') {
      $('themeIco').innerHTML = '<path fill="currentColor" d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1m11.4-11.4 2.1-2.1"/>';
    }

    // Restore sound preference (default ON)
    if (prefs.sound === false) {
      Audio.enabled = false;
      $('soundBtn').setAttribute('aria-pressed', 'false');
    } else {
      $('soundBtn').setAttribute('aria-pressed', 'true');
    }

    // Seed initial sparkline history
    const w0 = State.workers[0];
    if (w0) {
      for (let i = 0; i < 20; i++) {
        Sparks.history.bat.push(w0.bat + (Math.random() * 2 - 1));
        Sparks.history.acc.push(9.5 + Math.sin(i * .5) * .3);
        Sparks.history.pit.push(165 + Math.sin(i * .4) * 6);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
