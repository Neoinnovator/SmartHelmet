/* ============================================================================
 * CMI Command Center · Piramid Solutions
 * Modular JS: State · MQTT · Render · Map · UI · Toasts · Persistence
 * ============================================================================ */
(() => {
  'use strict';

  // ---------------------------------------------------------------- Config --
  const CFG = {
    mqttUrl: 'wss://11c2344a8d8b4107a6e0db681599d1a5.s1.eu.hivemq.cloud:8884/mqtt',
    mqttUser: 'Piramid',
    mqttPass: 'Piramid2026',
    topics: {
      sensor: 'cmi/helmet/001/sensor',
      status: 'cmi/helmet/001/status',
      gps:    'cmi/helmet/001/gps',
      cmd:    'cmi/helmet/001/cmd',
    },
    storageKey: 'cmi.prefs.v1',
    logMax: 80,
    mineCenter: { lat: -27.3668, lon: -70.3322 },
  };

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
    { t: 'Mapa Mina',      s: 'Posición operacional: esquema subterráneo / open-pit / satelital GPS' },
    { t: 'Digital Twin',   s: 'Vista detallada sensor-a-sensor del casco seleccionado' },
    { t: 'Seguridad',      s: 'Incidentes, exposición DS594 y estado de evacuación' },
    { t: 'Plataforma',     s: 'Casos de uso implementados, en desarrollo y roadmap' },
  ];

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
    const names = ['Luis Campusano', 'Carlos Muñoz', 'Pedro Aravena', 'Jorge Tapia',
                   'Mario González', 'Andrés Silva', 'Roberto Díaz', 'Felipe Rojas'];
    const roles = ['Ing. Innovación', 'Op. Perforación', 'Geomecánico', 'Jefe de Turno',
                   'Op. Cargador', 'Topógrafo', 'Op. CAEX', 'Mecánico Mina'];
    const zones = ['Z2', 'Z1', 'Z4', 'Z2', 'Z3', 'Z1', 'Z5', 'Z2'];
    const acts  = ['walking', 'driving', 'still'];

    State.workers = names.map((nm, i) => {
      const st = i === 5 ? 'cr' : (i === 2 ? 'wr' : 'ok');
      return {
        id: `CMI-00${i + 1}`,
        nm, rl: roles[i], zn: zones[i],
        st, bat: i === 0 ? 102 : 50 + Math.floor(Math.random() * 50),
        p: i === 0 ? 0 : (i === 5 ? 45 : 160 + Math.floor(Math.random() * 15)),
        r: 0, y: 0,
        ac: i === 0 ? 0 : (i === 5 ? 2.1 : 9.5 + Math.random()),
        act: i === 0 ? 'unknown' : (i === 5 ? 'still' : acts[i % 3]),
        lat: i === 0 ? '' : (-27.366 - i * 0.003).toFixed(4),
        lon: i === 0 ? '' : (-70.332 - i * 0.002).toFixed(4),
        mdw: i === 5,
        gF: i !== 0,
        ts: Date.now() - (i === 5 ? 30000 : 0),
        re: i === 0,  // real-time (receives MQTT)
        fw: 'v11.0-C6',
        gS: '', gH: '', gA: '', gU: '', gFC: 0,
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
            <span>${h(w.act)}</span>
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
    const mode = w.act === 'unknown' ? 'OFF' : (w.mdw ? 'SOS' : 'DEFAULT');
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
      tile('Actividad', w.act),
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
      tile('Activity', w.act, '', true),
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

    const sat = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'ESRI Satellite' }
    );
    const isDark = document.documentElement.dataset.theme === 'dark';
    const street = L.tileLayer(
      isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 19, attribution: 'CARTO' }
    );
    sat.addTo(map);
    L.control.layers({ Satelital: sat, Calles: street }, null, { position: 'topright' }).addTo(map);

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
      mk.bindPopup(`<b>${h(w.nm)}</b><br>${h(w.rl)}<br>${h(w.id)}<br>Zona ${h(w.zn)}${w.mdw ? '<br><span style="color:red;font-weight:700">MAN-DOWN</span>' : ''}<br>Bat: ${w.bat}%<br>${h(w.act)}`);
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
      w.act = d.activity || 'unknown';
      w.bat = d.battery_pct ?? w.bat;
      w.lat = d.lat || '';
      w.lon = d.lon || '';
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
      logPush('STS ' + (d.event || ''));
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
    toast(connected ? 'ok' : 'wr',
          connected ? 'Comando enviado' : 'Comando simulado',
          `${c}${connected ? '' : ' (MQTT offline)'}`);
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
    State.evacActive = !State.evacActive;
    const btn = $('evacBtn');
    const lbl = btn.querySelector('.evac-lbl');
    $('evacState').textContent = State.evacActive ? 'ACTIVA' : 'STANDBY';

    if (State.evacActive) {
      lbl.textContent = 'CANCELAR EVACUACIÓN';
      btn.classList.add('is-active');
      State.workers.forEach((w) => { w.st = 'cr'; w.mdw = true; w.act = 'sos'; });
      publishCmd('sos');
      logPush(`⚠ EVACUACIÓN ACTIVADA — SOS a ${State.workers.length} cascos`);
      toast('cr', 'EVACUACIÓN ACTIVA', `SOS enviado a ${State.workers.length} cascos`);
    } else {
      lbl.textContent = 'ACTIVAR EVACUACIÓN';
      btn.classList.remove('is-active');
      State.workers.forEach((w, i) => {
        if (i === 0) { w.st = 'ok'; w.mdw = false; w.act = 'unknown'; }
        else {
          w.st = i === 5 ? 'cr' : (i === 2 ? 'wr' : 'ok');
          w.mdw = i === 5;
          w.act = i === 5 ? 'still' : ['walking', 'driving', 'still'][i % 3];
        }
      });
      publishCmd('cancel');
      logPush('✔ EVACUACIÓN CANCELADA — cascos restaurados');
      toast('ok', 'Evacuación cancelada', 'Cascos restaurados a estado normal');
    }
    renderAll();
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
      if (e.key >= '1' && e.key <= '5') setView(+e.key - 1);
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
  //                                DEMO MODE
  // =========================================================================
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
      w.act = ['walking', 'still', 'driving', 'walking'][t % 4];
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
        w.mdw = true; w.st = 'cr'; w.p = 48; w.ac = 2.3; w.act = 'still';
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


  function init() {
    const prefs = Prefs.load();
    if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;

    seedFleet();
    renderCommands();
    renderUseCases();
    renderAll();
    renderSchema();
    bind();
    connectMqtt();

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
