/* Independent lab workspaces. All protocol effects originate in Docker; never fake packets. */
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validId = value => ['01-baseline','02-modbus','03-opcua','04-dnp3'].includes(value);
const activeId = (() => { const match = location.pathname.match(/^\/labs\/([^/]+)\/?$/); return match && validId(match[1]) ? match[1] : '01-baseline'; })();
let currentLab;
let shownPackets = [];
let lastPacketKey = '';
let lastCount = 0;
let observations = [];

async function api(url, init) {
  const response = await fetch(url, {cache:'no-store', ...init});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function storeKey() { return `ot-lab-progress-v1:${activeId}`; }
function progress() { try { return JSON.parse(localStorage.getItem(storeKey()) || '{}'); } catch { return {}; } }
function saveProgress(data) { localStorage.setItem(storeKey(), JSON.stringify(data)); }
function resultMessage(message, error = false) {
  $('injection-feedback').textContent = message;
  $('injection-feedback').classList.toggle('error-text', error);
}
function renderNav(labs) {
  $('lab-nav').innerHTML = labs.map(lab => `<a href="/labs/${escape(lab.id)}" class="lab-tab ${lab.id === activeId ? 'active' : ''}" ${lab.id === activeId ? 'aria-current="page"' : ''}><small>LAB ${String(lab.number).padStart(2,'0')} · ${escape(lab.protocol)}</small><strong>${escape(lab.title)}</strong></a>`).join('');
}
function renderMap(lab, packets = []) {
  const ports = new Set(packets.map(packet => Number(packet.dst_port) || Number(packet.src_port)));
  const nodes = Array.isArray(lab.nodes) ? lab.nodes : [];
  const links = Array.isArray(lab.links) ? lab.links : [];
  const positions = {browser:[20,20],scada3d:[20,20],trainer:[310,20],plant:[600,20],dnp3:[890,20],suricata:[310,180],sensor:[600,180]};
  const offset = nodes.some(node => node.id === 'dnp3') ? 0 : 145;
  const svgLinks = links.map(link => {
    const from = positions[link.from], to = positions[link.to]; if (!from || !to) return '';
    const observed = Number.isFinite(Number(link.port)) && ports.has(Number(link.port));
    return `<line x1="${from[0]+offset+105}" y1="${from[1]+35}" x2="${to[0]+offset+105}" y2="${to[1]+35}" class="network-edge ${observed ? 'observed' : ''}" marker-end="url(#arrow)" />`;
  }).join('');
  const svgNodes = nodes.map((node, index) => {
    const [x,y] = positions[node.id] || [20+index*180,180];
    return `<g class="network-node" transform="translate(${x+offset},${y})"><title>${escape(node.label)} — ${escape(node.role)} — ${escape(node.zone)}</title><rect width="210" height="70" rx="6"/><text x="14" y="21" class="network-zone">${escape(String(node.zone).slice(0,28))}</text><text x="14" y="45" class="network-label">${escape(String(node.label).slice(0,28))}</text></g>`;
  }).join('');
  const diagram = `<svg class="network-svg" viewBox="0 0 1120 265" role="img" aria-label="Nodos Docker y enlaces lógicos de la práctica"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,1 L7,4 L0,7" fill="none" stroke="#7691aa" stroke-width="1.5"/></marker></defs>${svgLinks}${svgNodes}</svg>`;
  const cards = `<div class="network-cards">${nodes.map(node => `<article class="topology-node"><span class="node-zone">${escape(node.zone)}</span><strong>${escape(node.label)}</strong><small>${escape(node.role)}</small></article>`).join('')}</div>`;
  $('topology').innerHTML = nodes.length ? diagram + cards : '<p>Sin nodos declarados.</p>';
  $('topology-flows').innerHTML = links.map(link => {
    const observed = Number.isFinite(Number(link.port)) && ports.has(Number(link.port));
    return `<div class="topology-link ${observed ? 'observed' : ''}"><span class="link-led"></span><strong>${escape(link.from)} → ${escape(link.to)}</strong><span>${escape(link.protocol)}${link.port ? ` / TCP ${escape(link.port)}` : ''}</span><em>${observed ? 'payload visto en PCAP' : 'declarado · sin payload observado'}</em></div>`;
  }).join('');
  $('topology-status').textContent = `${nodes.length} componentes · ${links.length} conductos declarados`;
}
function renderSteps(lab) {
  const steps = Array.isArray(lab.steps) ? lab.steps : [];
  const done = progress();
  $('step-count').textContent = `${steps.length} pasos`;
  $('learning-objectives').innerHTML = '<strong>Al terminar podrás:</strong><ul>' + (lab.objectives || []).map(s => `<li>${escape(s)}</li>`).join('') + '</ul>';
  $('lab-steps').innerHTML = steps.map((step, index) => `<li class="lab-step ${done[index]?.checked ? 'checked' : ''}"><div class="step-heading"><span class="step-number">${String(index + 1).padStart(2, '0')}</span><strong>${escape(step.title)}</strong></div><p>${escape(step.observation)}</p><div class="step-evidence"><span><b>Paquete:</b> ${escape(step.packet)}</span><span><b>Evidencia:</b> ${escape(step.evidence)}</span><span><b>Criterio:</b> ${escape(step.criterion)}</span></div>${step.command ? `<code class="step-command">${escape(step.command)}</code>` : ''}${step.action && lab.allowed_actions?.includes(step.action) ? `<button type="button" class="action-pill step-run" data-step="${index}" data-action="${escape(step.action)}">Ejecutar acción ${escape(step.action)}</button>` : ''}<label class="step-check"><input type="checkbox" data-check="${index}" ${done[index]?.checked ? 'checked' : ''}> Revisé y documenté el criterio (autoevaluación, no prueba automática)</label><label class="note-label">Nota de evidencia<input maxlength="240" data-note="${index}" value="${escape(done[index]?.note || '')}" placeholder="IP, hora, FC, alerta, resultado…"></label></li>`).join('');
  $('lab-steps').addEventListener('change', e => {
    if (!e.target.matches('[data-check]')) return;
    const index = e.target.dataset.check;
    const data = progress(); data[index] = {...data[index], checked:e.target.checked}; saveProgress(data);
    e.target.closest('.lab-step').classList.toggle('checked', e.target.checked);
  });
  $('lab-steps').addEventListener('input', e => {
    if (!e.target.matches('[data-note]')) return;
    const index = e.target.dataset.note;
    const data = progress(); data[index] = {...data[index], note:e.target.value.slice(0,240)}; saveProgress(data);
  });
}
function renderMatrix(lab) {
  $('mitre-rows').innerHTML = (lab.mitre || []).map(row => {
    let url = '';
    try { const parsed = new URL(row.source); if (parsed.protocol === 'https:') url = parsed.href; } catch { /* no link */ }
    return `<tr><td>${escape(row.tactic)}</td><td><strong>${escape(row.technique_id)}</strong> ${escape(row.technique)}${url ? ` <a href="${escape(url)}" target="_blank" rel="noopener noreferrer">↗</a>` : ''}</td><td>${escape(row.scope)}</td><td>${escape(row.evidence)}</td><td>${escape(row.mitigation)}</td></tr>`;
  }).join('') || '<tr><td colspan="5">Sin mapeo declarado. Consulta la guía.</td></tr>';
  $('iec-mapping').innerHTML = '<strong>IEC 62443 · mapeo de controles (no certificación)</strong>' + (lab.iec || []).map(row => `<span><b>${escape(row.reference)}</b> ${escape(row.application)}</span>`).join('');
  $('lab-limitations').innerHTML = '<strong>Qué NO demuestra esta práctica</strong><ul>' + (lab.limitations || []).map(s => `<li>${escape(s)}</li>`).join('') + '</ul>';
}
function renderInjection(lab) {
  const {protocol, operation} = lab.injection;
  const specs = {
    '01-baseline': {label:'Modbus FC03 / leer registros 0–6', detail:'Emite una ADU FC03 fija a plant:502, sin alterar el proceso.'},
    '02-modbus': {label:'Modbus FC06 / registro 2 · velocidad', detail:'ADU cruda MBAP + PDU; rango 30–95 Hz; respuesta FC06 validada.', field:'number', min:30, max:95, value:85},
    '03-opcua': {label:'OPC UA Write / Planta/SpeedSetpoint', detail:'Cliente asyncua emite Write real por TCP 4840; Read confirma retorno.', field:'number', min:30, max:95, value:75},
    '04-dnp3': {label:'DNP3 Direct Operate / salida analógica 0', detail:'Maestro DNP3 emite Control g41v1 y lee g30v1 de retorno.', field:'select'}
  };
  const spec = specs[activeId];
  $('injection-description').textContent = spec.detail + ' Solo contenedores internos, nunca IP libres.';
  $('inject-form').innerHTML = `<label>${escape(spec.label)}${spec.field === 'number' ? `<input id="inject-value" type="number" min="${spec.min}" max="${spec.max}" step="1" value="${spec.value}" required>` : spec.field === 'select' ? '<select id="inject-value"><option value="0">0 · ROJO</option><option value="1">1 · ÁMBAR</option><option value="2">2 · VERDE</option></select>' : ''}</label><button id="inject-button" type="button" class="action-pill primary">Emitir comando en Docker</button>`;
  $('inject-button').addEventListener('click', async () => {
    const button = $('inject-button');
    const input = $('inject-value');
    const value = input ? Number(input.value) : null;
    if (input && (!Number.isInteger(value) || (spec.field === 'number' && (value < spec.min || value > spec.max)))) { resultMessage('Valor fuera de rango permitido.', true); return; }
    button.disabled = true; resultMessage('Enviando al servicio interno; esperando acuse del protocolo…');
    try {
      const result = await api(`/api/labs/${activeId}/inject`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({protocol,operation,value})});
      if (result.ok !== true) throw new Error(result.message || 'Transacción no confirmada');
      resultMessage(`${result.message}. Inspecciona el PCAP y el gemelo; un acuse no demuestra un cambio físico real.`);
      await refreshPackets();
    } catch (error) { resultMessage(`Sin confirmación: ${error.message}`, true); }
    finally { button.disabled = false; }
  });
}
function renderPackets(data) {
  const list = $('packet-list');
  if (!data.available) {
    $('capture-status').textContent = 'SENSOR NO DISPONIBLE';
    $('sensor-count').textContent = 'sin captura';
    list.innerHTML = `<div class="empty-inline">${escape(data.message)}</div>`;
    shownPackets = []; renderMap(currentLab, []); return;
  }
  shownPackets = data.packets || [];
  $('capture-status').textContent = `${data.capture} · PCAP REAL`;
  $('sensor-count').textContent = `${shownPackets.length} payloads`;
  if (!shownPackets.length) { list.innerHTML = '<div class="empty-inline">Sensor conectado; no hay payloads para este filtro. Genera un comando y espera ~2 s.</div>'; return; }
  const newestKey = `${shownPackets[0].ts}:${shownPackets[0].src_port}:${shownPackets[0].hex}`;
  if (newestKey !== lastPacketKey) { lastPacketKey = newestKey; lastCount = shownPackets.length; }
  list.innerHTML = shownPackets.map((packet, index) => `<button type="button" class="packet-row" data-packet="${index}" role="listitem"><time>${escape(new Date(packet.ts).toLocaleTimeString('es-ES'))}</time><b>${escape(packet.protocol)}</b><span>${escape(packet.src)}:${escape(packet.src_port)} → ${escape(packet.dst)}:${escape(packet.dst_port)}</span><small>${escape(packet.summary)}</small><em>${escape(packet.bytes)} B</em></button>`).join('');
  renderMap(currentLab, shownPackets);
}
function showPacket(index) {
  const packet = shownPackets[index]; if (!packet) return;
  $('packet-description').textContent = `${packet.protocol} · ${packet.src}:${packet.src_port} → ${packet.dst}:${packet.dst_port} · ${packet.summary} · ${packet.evidence}`;
  $('packet-hex').textContent = packet.hex + (packet.truncated_hex ? ' … [solo primeros 192 bytes; descarga PCAP]' : '');
  document.querySelectorAll('.packet-row').forEach(row => row.classList.toggle('selected', Number(row.dataset.packet) === index));
}
async function refreshPackets() {
  const protocol = $('packet-filter').value;
  try { renderPackets(await api(`/api/packets?limit=80${protocol ? `&protocol=${encodeURIComponent(protocol)}` : ''}`)); }
  catch (error) { renderPackets({available:false,message:`API de captura no disponible: ${error.message}`}); }
}
async function refreshMonitor() {
  try {
    const {alerts = []} = await api('/api/alerts');
    const relevant = activeId === '01-baseline' ? alerts : alerts.filter(row => {
      const text = `${row.signature || ''} ${row.protocol || ''} ${row.src_ip || ''}`.toLowerCase();
      return activeId === '02-modbus' ? text.includes('modbus') || text.includes('fc06') : activeId === '03-opcua' ? text.includes('opc') : text.includes('dnp');
    });
    observations = relevant;
    $('monitor-body').innerHTML = relevant.length ? relevant.slice(0,6).map(row => `<div class="monitor-row"><span>${row.engine === 'Suricata' ? 'SURICATA / FIRMA' : 'GEMELO / ANALÍTICA'}</span><strong>${escape(row.signature)}</strong><small>${escape(row.ts || '')}</small></div>`).join('') : '<p>Sin alertas correlacionadas en esta práctica. La ausencia de alertas no prueba que un comando no ocurrió: consulta el PCAP y el estado.</p>';
  } catch (error) { $('monitor-body').textContent = `Monitor no disponible: ${error.message}`; }
}
async function exportEvidence() {
  const calls = await Promise.allSettled([api('/api/state'), api('/api/packets?limit=100'), api('/api/alerts')]);
  const result = {lab_id:activeId, collected_at:new Date().toISOString(), source:'Autoevaluación de alumno, no certificación', progress:progress(),
    state: calls[0].status === 'fulfilled' ? calls[0].value : null,
    packet_capture: calls[1].status === 'fulfilled' ? calls[1].value : null,
    alerts: calls[2].status === 'fulfilled' ? calls[2].value : null};
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
  link.download = `evidencia-${activeId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
export async function initLabWorkspace({runAction}) {
  document.body.dataset.lab = activeId;
  const [catalog, lab] = await Promise.all([api('/api/labs'), api(`/api/labs/${activeId}`)]);
  currentLab = lab;
  renderNav(catalog.labs || []);
  $('page-title').textContent = `LAB ${String(lab.number).padStart(2,'0')} / ${lab.title}`;
  $('lab-summary').textContent = lab.summary || lab.subtitle;
  $('lab-number').textContent = `${String(lab.number).padStart(2,'0')} / 04`;
  $('full-guide').href = `/docs/labs/${activeId}.md`;
  // Docs are served explicitly by the API below; no filesystem path from user input.
  renderMap(lab);
  renderSteps(lab);
  renderMatrix(lab);
  renderInjection(lab);
  $('frame-panel').hidden = activeId !== '02-modbus';
  document.querySelectorAll('.scenario-button').forEach(button => { button.hidden = !lab.allowed_actions.includes(button.dataset.scenario); });
  const allowedCount = document.querySelectorAll('.scenario-button:not([hidden])').length;
  $('scenario-counter').textContent = `0/${allowedCount}`;
  $('packet-filter').value = ({'02-modbus':'Modbus/TCP','03-opcua':'OPC UA','04-dnp3':'DNP3'})[activeId] || '';
  $('packet-filter').addEventListener('change', refreshPackets);
  $('packet-list').addEventListener('click', event => { const row = event.target.closest('[data-packet]'); if (row) showPacket(Number(row.dataset.packet)); });
  $('lab-steps').addEventListener('click', async event => {
    const button = event.target.closest('.step-run'); if (!button) return;
    button.disabled = true;
    try { const result = await runAction(button.dataset.action); button.textContent = result.message || 'Acción ejecutada; valida evidencia.'; await refreshPackets(); }
    catch (error) { button.textContent = `Sin confirmación: ${error.message}`; }
    finally { button.disabled = false; }
  });
  $('export-evidence').addEventListener('click', exportEvidence);
  await Promise.all([refreshPackets(),refreshMonitor()]);
  setInterval(refreshPackets, 2200);
  setInterval(refreshMonitor, 4300);
  return activeId;
}
export { activeId };
