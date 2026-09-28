#!/usr/bin/env node
/**
 * Rebuild the review gallery from an authorized, local Docker lab only.
 * No HTTP fixtures, fake packets, external targets or browser network interception.
 * Run with a fresh Compose project when independent evidence is required.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const docs = path.join(repo, 'docs');
const port = Number(process.env.LAB_CAPTURE_PORT || 18080);
assert(Number.isInteger(port) && port > 1024 && port <= 65535, 'LAB_CAPTURE_PORT debe ser un puerto local válido');
const root = `http://127.0.0.1:${port}`;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const stage = await mkdtemp(path.join(tmpdir(), 'ot-ics-capturas-'));
const captures = [];
const errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
let browser;
let page;

async function until(label, predicate, timeoutMs = 22000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; }
    catch (error) { lastError = error; }
    await sleep(550);
  }
  throw Error(`Tiempo agotado esperando ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

async function json(route) {
  const response = await page.request.get(`${root}${route}`, { timeout: 7000 });
  assert(response.ok(), `${route}: HTTP ${response.status()}`);
  return response.json();
}

async function reset(id) {
  const response = await page.request.post(`${root}/api/labs/${id}/action/reset`, { timeout: 10000 });
  assert(response.ok(), `reset de ${id}: HTTP ${response.status()}`);
  await until('estado nominal', async () => {
    const state = await json('/api/state');
    return state.speed_setpoint === 45 && state.traffic_signal === 2 && state.pump_enabled;
  });
}

async function save(name, lab, phase, options = {}) {
  const buffer = await page.screenshot(options);
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `PNG inválido: ${name}`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert(width > 380 && height >= 900, `Captura incompleta: ${name} (${width}x${height})`);
  const relative = path.join('docs', name);
  const tempFile = path.join(stage, name);
  await mkdir(path.dirname(tempFile), { recursive: true });
  await writeFile(tempFile, buffer);
  const item = { file: relative.replaceAll('\\', '/'), lab, phase, width, height, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
  captures.push(item);
  console.log(`CAPTURE ${item.file} ${width}x${height} ${item.sha256.slice(0, 12)}`);
}

async function waitNewPacket(protocol, afterMs, predicate = () => true) {
  await until(`trama ${protocol} reciente`, async () => {
    const captured = await json('/api/packets?limit=100');
    return captured.source === 'sensor pasivo / PCAP' && (captured.packets || []).some(packet =>
      packet.protocol.includes(protocol) && Date.parse(packet.ts) >= afterMs - 1000 && predicate(packet));
  }, 20000);
}

async function navigate(id) {
  await page.goto(`${root}/labs/${id}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(expected => document.body.dataset.lab === expected &&
    document.querySelector('#connection-label')?.textContent.includes('API CONECTADA') &&
    document.querySelector('#scene-level')?.textContent !== '--%', id, { timeout: 18000 });
  assert((await page.locator('.network-node').count()) >= 4, `Topología incompleta en ${id}`);
  assert((await page.locator('#mitre-rows tr').count()) >= 1, `Matriz MITRE vacía en ${id}`);
  assert.equal(await page.locator('#frame-panel').isVisible(), id === '02-modbus', `MBAP fuera de Modbus en ${id}`);
  const panelColor = await page.locator('.scene-panel').evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(panelColor, 'rgb(255, 255, 255)', `Tema claro ausente en ${id}`);
  await page.waitForTimeout(500); // One UI repaint; not a substitute for the protocol/state assertions.
}

try {
  const health = await fetch(`${root}/api/health`).then(r => r.json());
  assert.equal(health.mode, 'SIMULATED_LAB_ONLY', 'El destino no es la maqueta Docker esperada');
  browser = await chromium.launch({
    executablePath: chromiumPath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 1480 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await until('FC03 de línea base en PCAP', async () => {
    const response = await json('/api/packets?limit=20');
    return response.packets?.some(packet => packet.protocol === 'Modbus/TCP' && packet.summary.includes('FC03'));
  }, 25000);

  const labs = [
    { id: '01-baseline', title: 'línea base', value: null, protocol: 'Modbus/TCP', expected: { speed_setpoint: 45, traffic_signal: 2 } },
    { id: '02-modbus', title: 'Modbus', value: '85', protocol: 'Modbus/TCP', expected: { speed_setpoint: 85, traffic_signal: 2 } },
    { id: '03-opcua', title: 'OPC UA', value: '75', protocol: 'OPC UA', expected: { speed_setpoint: 75, traffic_signal: 2 } },
    { id: '04-dnp3', title: 'DNP3', value: '0', protocol: 'DNP3', expected: { speed_setpoint: 45, traffic_signal: 0 } },
  ];
  for (const lab of labs) {
    await reset(lab.id);
    await navigate(lab.id);
    await until('telemetría nominal en navegador', async () =>
      (await page.locator('#speed-setpoint').textContent()).trim() === '45');
    await page.evaluate(() => window.scrollTo(0, 0));
    await save(`preview-${lab.id}.png`, lab.id, 'nominal · 1600 × 1480');
    if (lab.id === '01-baseline') {
      await page.setViewportSize({ width: 1600, height: 1250 });
      await save('consola-preview.png', lab.id, 'nominal · consola 1600 × 1250');
      await page.setViewportSize({ width: 1600, height: 1480 });
    }
    if (lab.id === '02-modbus') {
      await page.locator('#topology-heading').scrollIntoViewIfNeeded();
      await save('preview-network.png', lab.id, 'mapa · FC03 observado');
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const before = Date.now();
    if (lab.value !== null) {
      if (lab.id === '04-dnp3') await page.locator('#inject-value').selectOption(lab.value);
      else await page.locator('#inject-value').fill(lab.value);
    }
    await page.locator('#inject-button').click();
    await page.waitForFunction(() => /transmitida|confirmados|confirmado/i.test(
      document.querySelector('#injection-feedback')?.textContent || ''), null, { timeout: 25000 });
    await until(`estado ${lab.title} aplicado`, async () => {
      const state = await json('/api/state');
      return Object.entries(lab.expected).every(([key, value]) => state[key] === value);
    });
    await waitNewPacket(lab.protocol, before,
      lab.id === '02-modbus' ? packet => packet.summary.includes('FC06') : () => true);
    if (lab.id !== '01-baseline') {
      const signature = { '02-modbus': 'FC06', '03-opcua': 'OPC UA', '04-dnp3': 'DNP3' }[lab.id];
      await until(`firma Suricata ${signature} en API`, async () => {
        const { alerts = [] } = await json('/api/alerts');
        return alerts.some(row => row.engine === 'Suricata' && row.signature.includes(signature));
      }, 22000);
      await until(`firma Suricata ${signature} visible`, async () =>
        (await page.locator('#monitor-body').textContent()).includes('SURICATA / FIRMA'), 13000);
    }
    await until('SCADA y PCAP actualizados en navegador', async () => {
      const speed = (await page.locator('#speed-setpoint').textContent()).trim();
      const packets = await page.locator('#packet-list .packet-row').count();
      return speed === String(lab.expected.speed_setpoint) && packets > 0;
    });
    if (lab.id === '04-dnp3') {
      await until('semáforo rojo', async () => /ROJO/i.test(await page.locator('#traffic-state').textContent()));
    }
    await page.locator('#packet-list .packet-row').first().click();
    assert((await page.locator('#packet-hex').textContent()).trim().length > 10, `Hex PCAP no visible en ${lab.id}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await save(`capturas/${lab.id}-completo.png`, lab.id, `práctica completa después de ${lab.title}`, { fullPage: true });
    if (lab.id === '02-modbus') {
      await page.setViewportSize({ width: 1600, height: 1250 });
      await save('consola-alerta.png', lab.id, 'FC06=85 · alerta 1600 × 1250');
      await page.setViewportSize({ width: 1600, height: 1480 });
      await page.locator('#focus-pump').click();
      assert.equal(await page.locator('#focus-pump').getAttribute('aria-pressed'), 'true');
      assert(await page.locator('#scene-ident').isVisible());
      await page.evaluate(() => window.scrollTo(0, 0));
      await save('preview-pump-focus.png', lab.id, 'FC06=85 · detalle bomba P-101');
      await page.locator('#reset-camera').click();
      assert.equal(await page.locator('#focus-pump').getAttribute('aria-pressed'), 'false');
    }
    console.log(`PASS ${lab.id}: comando acotado, estado simulado, PCAP Ethernet y matriz visibles`);
  }
  await reset('03-opcua');
  await page.setViewportSize({ width: 390, height: 920 });
  await navigate('03-opcua');
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert(widths[0] <= widths[1] + 2, `Desbordamiento móvil ${widths.join('/')}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await save('preview-mobile.png', '03-opcua', 'móvil nominal · 390 × 920');
  assert.equal(captures.length, 13, 'Falta una de las trece capturas esperadas');
  assert.deepEqual(errors, [], 'Errores JavaScript durante las capturas');
  await reset('04-dnp3');
  for (const capture of captures) {
    const dest = path.join(repo, capture.file);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(stage, capture.file.slice(5)), dest);
  }
  const manifest = {
    capturedAtUtc: new Date().toISOString(),
    sourceCommitAtCapture: commit,
    environment: 'Chromium headless 1600 × 1480 y móvil 390 × 920; Docker aislado; Playwright Core 1.56.1',
    captureOrigin: 'HTTP solo 127.0.0.1; datos SCADA de la API y bytes de un sensor PCAP pasivo; sin mocks',
    caveat: 'Los cuatro laboratorios comparten estado e historial: cada pantalla nominal se restablece, pero eventos y PCAP de prácticas anteriores permanecen y se identifican como histórico global.',
    files: captures.sort((a, b) => a.file.localeCompare(b.file)),
  };
  await writeFile(path.join(docs, 'capturas/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`PASS GALERÍA: ${captures.length} PNG verificados; hash y procedencia en docs/capturas/manifest.json`);
} finally {
  if (page) await page.request.post(`${root}/api/labs/04-dnp3/action/reset`).catch(() => {});
  if (browser) await browser.close();
  await rm(stage, { recursive: true, force: true });
}
