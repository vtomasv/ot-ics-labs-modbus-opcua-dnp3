import { initPlantScene } from './scene.js';

const API = Object.freeze({ state: '/api/state', events: '/api/events', alerts: '/api/alerts', health: '/api/health', traffic: '/api/traffic', scenario: name => `/api/scenario/${encodeURIComponent(name)}` });
const $ = id => document.getElementById(id);
const ui = {
  connectionPill: $('connection-pill'), connectionLabel: $('connection-label'), clock: $('clock'), lastUpdate: $('last-update'),
  tank: $('tank-level'), tankProgress: $('tank-level-progress'), sceneLevel: $('scene-level'), sceneBar: $('scene-level-bar'),
  speed: $('speed-setpoint'), speedProgress: $('speed-progress'), temperature: $('temperature'), temperatureProgress: $('temperature-progress'), flow: $('flow'),
  pumpStateTag: $('pump-state-tag'), scenePump: $('scene-pump'), sceneSpeed: $('scene-speed'), pumpToggle: $('pump-toggle'), speedSlider: $('speed-slider'), speedValue: $('speed-value'), manualStatus: $('manual-status'),
  safetyState: $('safety-state'), safetyBadge: $('safety-badge'), trafficState: $('traffic-state'), trafficLight: $('traffic-light'), signState: $('sign-state'), signMessage: $('sign-message'), physicalSign: $('physical-sign'),
  scenarioCounter: $('scenario-counter'), scenarioFeedback: $('scenario-feedback'), scenarioButtons: [...document.querySelectorAll('.scenario-button')], frameStatus: $('frame-status'), frameBefore: $('frame-before'), frameAfter: $('frame-after'),
  trafficList: $('traffic-list'), eventBand: $('event-band'), eventCount: $('event-count'), alertCount: $('alert-count'), riskScore: $('risk-score'), scoreRing: $('score-ring'), riskSummary: $('risk-summary'), alertStrip: $('alert-strip'), toast: $('toast')
};

const signNames = ['OPERACIÓN NORMAL', 'MANTENIMIENTO', 'DETENER / ANOMALÍA', 'EVACUAR'];
const trafficNames = ['ROJO / PARADA', 'ÁMBAR / PRECAUCIÓN', 'VERDE / PERMITIDO'];
const severityClass = value => { const v = String(value || '').toLowerCase(); return v.includes('crit') || v.includes('high') || v.includes('alta') ? 'critical' : v.includes('warn') || v.includes('medium') || v.includes('media') || v.includes('aviso') ? 'warning' : 'normal'; };
const protocolClass = protocol => { const p = String(protocol || '').toLowerCase(); if (p.includes('opc')) return 'opcua'; if (p.includes('dnp')) return 'dnp3'; return 'modbus'; };
const safeDate = value => { const d = value ? new Date(value) : new Date(); return Number.isNaN(d.getTime()) ? new Date() : d; };
const timeLabel = value => safeDate(value).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

let scene;
let pollTimer;
let pollInFlight = false;
let connected = false;
let usingDemo = false;
let latestState = null;
let eventCache = [];
let alertCache = [];
let flowHistory = [];
let completedScenarios = new Set();
let toastTimer;

function setConnection(status, label) {
  connected = status === 'online';
  ui.connectionLabel.textContent = label;
  const dot = ui.connectionPill.querySelector('.status-dot');
  dot.className = `status-dot ${status}`;
}

function showToast(message, error = false) {
  ui.toast.textContent = message; ui.toast.classList.toggle('error', error); ui.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3600);
}

async function getJson(url, timeout = 4800) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try { const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json(); }
  finally { clearTimeout(timer); }
}

async function postScenario(name) {
  const response = await fetch(API.scenario(name), { method: 'POST', headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json();
}

function updateState(state) {
  if (!state || typeof state !== 'object') return;
  latestState = state; const tank = clamp(Number(state.tank_level) || 0, 0, 100); const speed = clamp(Number(state.speed_setpoint) || 0, 0, 100); const temp = Number(state.temperature) || 0; const flow = Number(state.flow) || 0; const pump = Boolean(state.pump_enabled); const trip = Boolean(state.safety_trip);
  ui.tank.textContent = Math.round(tank); ui.sceneLevel.textContent = `${Math.round(tank)}%`; ui.tankProgress.style.width = `${tank}%`; ui.sceneBar.style.width = `${tank}%`;
  ui.speed.textContent = speed.toFixed(0); ui.speedProgress.style.width = `${speed}%`; ui.speed.style.color = speed > 60 ? 'var(--red)' : ''; ui.temperature.textContent = temp.toFixed(1); ui.temperatureProgress.style.width = `${clamp((temp - 15) / 40 * 100, 0, 100)}%`; ui.flow.textContent = flow.toFixed(1);
  ui.scenePump.textContent = pump ? 'RUN' : 'STOP'; ui.sceneSpeed.textContent = `${speed.toFixed(0)} Hz`; ui.pumpStateTag.textContent = pump ? '● RUN' : '■ STOP'; ui.pumpStateTag.classList.toggle('up', pump);
  const anomaly = trip || speed > 60 || Number(state.traffic_signal) === 0 || Number(state.sign_code) >= 2;
  ui.safetyState.textContent = trip ? 'TRIP ACTIVO' : 'SEGURO'; ui.safetyBadge.textContent = anomaly ? 'ATENCIÓN' : 'NOMINAL'; ui.safetyBadge.style.color = anomaly ? 'var(--red)' : 'var(--green)';
  ui.pumpToggle.checked = pump; if (document.activeElement !== ui.speedSlider) { ui.speedSlider.value = clamp(speed, 0, 60); ui.speedValue.textContent = `${speed.toFixed(0)} Hz${speed > 60 ? ' / ANÓMALO' : ''}`; updateRangeBackground(); }
  const traffic = clamp(Number(state.traffic_signal) || 0, 0, 2); const sign = clamp(Number(state.sign_code) || 0, 0, 3); ui.trafficState.textContent = trafficNames[traffic]; ui.signState.textContent = signNames[sign]; ui.signMessage.textContent = signNames[sign]; ui.physicalSign.style.borderColor = sign >= 2 ? 'rgba(250,93,93,.55)' : 'rgba(242,178,75,.24)'; ui.physicalSign.style.color = sign >= 2 ? 'var(--red)' : 'var(--amber)'; ui.trafficLight.className = `state-light ${traffic === 0 ? 'red' : traffic === 1 ? 'amber' : 'green'}`;
  scene?.updateState(state); flowHistory.push(flow); if (flowHistory.length > 32) flowHistory.shift(); renderSparkline();
  const updated = state.updated_at ? timeLabel(state.updated_at) : timeLabel(); ui.lastUpdate.textContent = `Última lectura: ${updated}`;
}

function updateRangeBackground() { const value = Number(ui.speedSlider.value); ui.speedSlider.style.background = `linear-gradient(90deg, var(--cyan) 0%, var(--cyan) ${value / 60 * 100}%, #1c3c43 ${value / 60 * 100}%, #1c3c43 100%)`; }
function renderSparkline() { const el = $('flow-sparkline'); if (!el || !flowHistory.length) return; const min = Math.min(...flowHistory), max = Math.max(...flowHistory, min + 1); const points = flowHistory.map((v, i) => `${i / Math.max(flowHistory.length - 1, 1) * 100}% ${100 - (v - min) / (max - min) * 90}%`).join(','); el.style.clipPath = `polygon(0 100%, ${points}, 100% 100%)`; el.style.background = 'var(--cyan-deep)'; el.style.opacity = '.85'; }

function renderEvents(events = []) {
  eventCache = Array.isArray(events) ? events.slice(0, 100) : []; ui.eventCount.textContent = `${eventCache.length} evento${eventCache.length === 1 ? '' : 's'}`;
  if (!eventCache.length) { ui.trafficList.innerHTML = '<div class="empty-state">Esperando paquetes…</div>'; ui.eventBand.innerHTML = '<span class="empty-band">Sin eventos registrados</span>'; return; }
  const frameEvent = eventCache.find(event => event?.frame_before || event?.frameBefore || event?.frame_after || event?.frameAfter); if (frameEvent) renderFrame(frameEvent);
  ui.trafficList.innerHTML = eventCache.slice(0, 6).map(event => `<div class="traffic-item"><span class="traffic-time">${timeLabel(event.ts)}</span><span class="proto ${protocolClass(event.protocol)}">${protocolClass(event.protocol) === 'modbus' ? 'MB' : protocolClass(event.protocol) === 'opcua' ? 'OP' : 'D3'}</span><span class="traffic-detail" title="${escapeHtml(event.detail || '')}">${escapeHtml(event.detail || event.source || 'Evento de proceso')}</span></div>`).join('');
  ui.eventBand.innerHTML = eventCache.slice().reverse().slice(0, 70).map(event => `<i class="event-segment ${severityClass(event.severity)}" title="${escapeHtml(event.detail || '')}"></i>`).join('');
}

function renderTraffic(traffic = []) {
  if (!Array.isArray(traffic) || !traffic.length) return;
  ui.trafficList.innerHTML = traffic.slice(0, 6).map(item => `<div class="traffic-item"><span class="traffic-time">${timeLabel(item.ts)}</span><span class="proto ${protocolClass(item.protocol)}">${protocolClass(item.protocol) === 'modbus' ? 'MB' : protocolClass(item.protocol) === 'opcua' ? 'OP' : 'D3'}</span><span class="traffic-detail" title="${escapeHtml(item.detail || '')}">${escapeHtml(item.detail || item.direction || 'Mensaje de proceso')}</span></div>`).join('');
}

function renderAlerts(alerts = []) {
  alertCache = Array.isArray(alerts) ? alerts.slice(0, 100) : []; const count = alertCache.length; ui.alertCount.textContent = count; const elevated = count > 0 || eventCache.some(e => ['critical', 'high', 'alta'].some(x => String(e.severity || '').toLowerCase().includes(x)));
  ui.riskScore.textContent = elevated ? 'REVISAR' : 'OK'; ui.riskScore.style.color = elevated ? 'var(--amber)' : 'var(--green)'; ui.scoreRing.style.borderColor = elevated ? 'var(--amber)' : 'var(--green)'; ui.riskSummary.textContent = elevated ? 'Se detectaron indicadores que requieren revisión del instructor. Verifica el origen antes de continuar.' : 'No hay señales de compromiso activas. Mantén los comandos dentro del escenario.';
  ui.alertStrip.innerHTML = count ? `<span class="alert-icon">!</span><span>${count} alerta${count === 1 ? '' : 's'} en el perímetro OT</span>` : '<span class="alert-icon">!</span><span>Alertas recientes se mostrarán aquí.</span>';
}

function renderFrame(event) {
  const before = event?.frame_before || event?.frameBefore; const after = event?.frame_after || event?.frameAfter; if (!before && !after) return;
  ui.frameBefore.textContent = before || '—'; ui.frameAfter.textContent = after || '—'; ui.frameStatus.textContent = 'TRAMA COMPARADA / PROXY'; ui.frameStatus.classList.add('captured');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }

function demoState() { const t = Date.now() / 1000; const level = 61 + Math.sin(t / 10) * 5; const speed = Number(ui.speedSlider.value) || 35; return { tank_level: level, pump_enabled: ui.pumpToggle.checked, speed_setpoint: speed, temperature: 31.4 + Math.sin(t / 17) * .9, flow: ui.pumpToggle.checked ? 54 + Math.sin(t / 8) * 4 : 0, traffic_signal: 2, sign_code: 0, safety_trip: false, updated_at: new Date().toISOString() }; }
function demoEvents() { return [{ ts: new Date(Date.now() - 24000).toISOString(), protocol: 'Modbus TCP', source: 'PLC-01', detail: 'FC03 lectura TK-101 · nivel', severity: 'normal' }, { ts: new Date(Date.now() - 13000).toISOString(), protocol: 'OPC UA', source: 'SCADA-01', detail: 'Read /Plant/P101/Flow', severity: 'normal' }, { ts: new Date().toISOString(), protocol: 'DNP3', source: 'RTU-03', detail: 'Heartbeat / estación online', severity: 'normal' }]; }

async function poll() {
  if (pollInFlight) return; pollInFlight = true;
  try {
    const [state, events, alerts] = await Promise.all([getJson(API.state), getJson(API.events), getJson(API.alerts)]); usingDemo = false; setConnection('online', 'API CONECTADA'); updateState(state); renderEvents(events?.events || []); renderAlerts(alerts?.alerts || []);
    try { await getJson(API.health, 2500); } catch (_) { /* health is advisory; state/events remain authoritative */ }
    try { const traffic = await getJson(API.traffic); renderTraffic(traffic?.traffic || []); } catch (_) { /* traffic is optional per contract */ }
  } catch (error) {
    if (!usingDemo) { usingDemo = true; setConnection('demo', 'MODO DEMO'); showToast('API no disponible: visualización local de demostración activa.', true); }
    updateState(demoState()); if (!eventCache.length) renderEvents(demoEvents()); renderAlerts([]);
  } finally { pollInFlight = false; }
}

async function executeScenario(name, button) {
  if (ui.scenarioButtons.some(item => item.disabled)) return;
  ui.scenarioButtons.forEach(item => { item.disabled = true; }); button.classList.add('running'); ui.scenarioFeedback.className = 'scenario-feedback'; ui.scenarioFeedback.innerHTML = '<span class="feedback-mark">…</span><span>Ejecutando secuencia controlada…</span>';
  try {
    let result;
    if (usingDemo) throw new Error('API no disponible: modo DEMO. No se envió ningún paquete OT.');
    result = await postScenario(name);
    if (result?.ok === false) throw new Error(result.message || 'El backend rechazó el escenario.'); completedScenarios.add(name); ui.scenarioCounter.textContent = `${completedScenarios.size}/5`; ui.scenarioFeedback.className = 'scenario-feedback success'; ui.scenarioFeedback.innerHTML = `<span class="feedback-mark">✓</span><span>${escapeHtml(result?.message || 'Escenario completado.')}</span>`; showToast(result?.message || 'Escenario completado.'); await poll();
  } catch (error) { ui.scenarioFeedback.className = 'scenario-feedback error'; ui.scenarioFeedback.innerHTML = `<span class="feedback-mark">!</span><span>${escapeHtml(error.message || 'No se pudo ejecutar el escenario.')}</span>`; showToast(error.message || 'No se pudo ejecutar el escenario.', true); }
  finally { button.classList.remove('running'); ui.scenarioButtons.forEach(item => { item.disabled = false; }); }
}

function exportEvents() { const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), events: eventCache, alerts: alertCache }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `ot-ics-events-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`; link.click(); URL.revokeObjectURL(link.href); showToast('Eventos exportados en JSON local.'); }

async function sendManual(component, value) {
  if (usingDemo) { ui.manualStatus.textContent = 'Modo demo: no se transmitió ningún paquete.'; return; }
  try {
    const response = await fetch(`/api/manual/${component}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json(); ui.manualStatus.textContent = result.message || 'Comando confirmado.'; await poll();
  } catch (error) { ui.manualStatus.textContent = `Comando rechazado: ${error.message}`; showToast(ui.manualStatus.textContent, true); }
}

function bindDashboard() {
  ui.speedSlider.addEventListener('input', () => { ui.speedValue.textContent = `${ui.speedSlider.value} Hz`; updateRangeBackground(); if (usingDemo) updateState(demoState()); });
  ui.speedSlider.addEventListener('change', () => sendManual('speed', Number(ui.speedSlider.value)));
  ui.pumpToggle.addEventListener('change', () => { ui.manualStatus.textContent = ui.pumpToggle.checked ? 'Comando local: arranque solicitado.' : 'Comando local: parada solicitada.'; sendManual('pump', Number(ui.pumpToggle.checked)); if (usingDemo) updateState(demoState()); });
  ui.scenarioButtons.forEach(button => button.addEventListener('click', () => executeScenario(button.dataset.scenario, button)));
  $('export-events')?.addEventListener('click', exportEvents);
  setInterval(() => { ui.clock.textContent = new Date().toLocaleTimeString('es-ES', { hour12: false }); }, 1000);
  const observer = new ResizeObserver(() => scene?.resize()); observer.observe($('scene-wrap'));
}

async function init() { bindDashboard(); updateRangeBackground(); try { scene = initPlantScene($('plant-canvas')); } catch (error) { console.error('Three.js scene error', error); showToast('No se pudo iniciar el visor 3D.', true); } await poll(); pollTimer = setInterval(poll, 1000); }
init();
