# Galería de revisión: cuatro laboratorios OT

**Ámbito:** capturas directas de Chromium sobre una instancia **Docker aislada en `127.0.0.1:18080`**. Los paquetes corresponden a TCP/Ethernet entre contenedores y a un sensor pasivo; la bomba, el tanque, el semáforo y los indicadores son **un gemelo software**, no hardware físico. No se usan respuestas HTTP falsas, imágenes de stock ni un PLC real. La fecha UTC, el commit del código capturado, dimensiones, tamaños y SHA-256 individuales están en [`manifest.json`](manifest.json).

| Laboratorio | Vista nominal | Práctica completa tras la acción | Qué comprobar |
|---|---|---|---|
| 01 · Línea base | [Consola 01](../preview-01-baseline.png) | [Página 01](01-baseline-completo.png) | 45 Hz, señal verde y lectura FC03; no inventar OPC UA/DNP3 periódicos. |
| 02 · Integridad Modbus | [Consola 02](../preview-02-modbus.png) | [Página 02](02-modbus-completo.png) | FC06=85, cartel de anomalía, bytes PCAP y firma **Suricata FC06** separada de la analítica del gemelo. |
| 03 · OPC UA | [Consola 03](../preview-03-opcua.png) | [Página 03](03-opcua-completo.png) | Write/Read=75, tramas en TCP/4840 y firma HEL de **presencia**, no firma del servicio Write. |
| 04 · DNP3 | [Consola 04](../preview-04-dnp3.png) | [Página 04](04-dnp3-completo.png) | Direct Operate=0, **readback DNP3**, semáforo rojo y firma de solicitud **de presencia**, no de la orden específica. |

**Vistas de apoyo:** [consola nominal heredada, ya actualizada](../consola-preview.png) · [alerta Modbus heredada, ya actualizada](../consola-alerta.png) · [mapa de zonas y conductos](../preview-network.png) · [detalle de la bomba P-101](../preview-pump-focus.png) · [móvil 390 px](../preview-mobile.png). **Total: 13 PNG**. Las dos imágenes llamadas `consola-*.png` conservan su nombre por compatibilidad documental, pero ya no representan el tema oscuro anterior.

> El cartel de aviso y el semáforo son **variables distintas** del gemelo. En DNP3 se controla la señal de tráfico, no se afirma que el cartel cambie con ella. El mapa resalta enlaces por payload observado; las líneas no resaltadas son topología declarada, no prueba de captura. Los históricos de alertas y PCAP no se borran por `reset`, por lo que una página nominal posterior puede incluir eventos de prácticas anteriores, rotulados como **histórico global**.

## Reproducción local de la galería

Necesita Docker/Compose v2, Node.js 20+, Chromium instalado (normalmente `/usr/bin/chromium`) y disponibilidad inicial para descargar `playwright-core` fijado en `package-lock.json`. No instale dependencias Node para **usar** los laboratorios: son exclusivamente del proceso **opcional de documentación**.

```bash
# Desde la raíz del repositorio; puerto HTTP solo en loopback.
DASHBOARD_PORT=18080 docker compose -p ot-ics-capturas-review up -d --build
docker compose -p ot-ics-capturas-review ps
npm --prefix tools/screenshots ci
LAB_CAPTURE_PORT=18080 npm --prefix tools/screenshots run capture
LAB_VERIFY_PORT=18080 python3 scripts/verify-workspaces.py
# Si Chromium está en otra ruta, use CHROMIUM_PATH=/ruta/chromium.
# Para detener sin borrar PCAP, eventos ni logs:
docker compose -p ot-ics-capturas-review down
```

Use un **nombre de proyecto Docker nuevo** si necesita historial independiente; esto crea volúmenes nuevos sin ejecutar `down -v`. El script se niega a usar destinos distintos de `127.0.0.1` y exige `mode=SIMULATED_LAB_ONLY`. Antes de reemplazar imágenes, guarda capturas temporalmente y valida conexión, estado del gemelo, páginas y matriz MITRE visibles, tramas PCAP **posteriores** al comando, firma Suricata cuando corresponde, foco/restablecimiento de cámara y ausencia de errores JavaScript; si una condición falla, **no sustituye las imágenes versionadas**. El contenido completo de objetivos, pasos y guías se comprueba además con `verify-workspaces.py`. Solo se acepta DNP3 después de readback confirmado; la recuperación de una primera lectura sin respuesta es **una nueva conexión de solo lectura**, sin retransmitir Direct Operate.

**Verificar la integridad de esta entrega** desde la raíz, sin dependencias adicionales:

```bash
python3 - <<'PY'
import hashlib, json
from pathlib import Path
m = json.loads(Path('docs/capturas/manifest.json').read_text())
assert len(m['files']) == 13
for item in m['files']:
    content = Path(item['file']).read_bytes()
    assert len(content) == item['bytes']
    assert hashlib.sha256(content).hexdigest() == item['sha256'], item['file']
print('13/13 PNG íntegros; código de captura:', m['sourceCommitAtCapture'])
PY
```

Una ejecución posterior producirá bytes diferentes por la hora en pantalla, telemetría y tráfico cíclico; **reproducible significa mismo procedimiento y verificaciones, no imágenes idénticas bit a bit**. La CI aplica la misma comprobación SHA-256 **antes de construir** el laboratorio; no sustituye la revisión visual y científica de las capturas. El commit del manifiesto identifica el código ya comprometido antes de capturar; el commit posterior que añade las imágenes y esta documentación naturalmente tendrá otro SHA. Para detalles técnicos y límites de validación consulte [validación](../validacion.md) y la [guía de merge](../merge.md).
