# Práctica 3 — Integridad OPC UA: Write, evidencia y confianza

**Duración:** 45 min. **Laboratorio aislado, educativo y defensivo.** Trabaje solo en el repositorio Docker y con autorización del responsable. No conecte esta maqueta a una red OT real, PLC, RTU, SIS, sensor, actuador o equipo de terceros; no escanee ni escriba destinos externos; no publique `4840/TCP`, `502/TCP` ni `20000/TCP`. Las únicas acciones de escenario de esta práctica son `opcua-write` y `reset`.

## Objetivo

Verificar una escritura OPC UA real al nodo `Planta/SpeedSetpoint`, separar la transacción técnica de las observaciones de la consola, capturar el flujo interno y proponer controles de integridad y autorización. El endpoint de la maqueta usa deliberadamente `SecurityPolicy None`: es una debilidad de configuración para el ejercicio, **no** una limitación intrínseca de OPC UA ni una configuración apta para producción.

La planta es un **gemelo digital 3D/software**: no hay PLC físico, SIS, sensores, válvulas, firmware ni proceso externo. El cliente OPC UA real es `trainer`; el navegador solo habla HTTP/JSON con la API. No atribuya bytes del navegador a un PCAP de OPC UA.

## Prerrequisitos y arranque

```bash
docker compose up -d --build
docker compose ps
docker compose exec -T trainer python /lab/scripts/health.py trainer
curl --noproxy '*' -fsS http://127.0.0.1:${DASHBOARD_PORT:-8080}/api/health
```

Abra `http://127.0.0.1:${DASHBOARD_PORT:-8080}/` en el mismo anfitrión. No ejecute en esta práctica `modbus-write`, `dnp3-signal` ni `intercept`. El proxy Modbus del repositorio, además, es una PDU editada enviada al único destino fijo `plant:502`; no es una intercepción transparente, no hace ARP spoofing y no se estudia como MITM aquí.

## Procedimiento del alumno

### 1. Línea base y estado nominal

Pulse **Restablecer laboratorio** y registre una captura de la vista 3D nominal. También puede usar el endpoint interno del contenedor:

```bash
docker compose exec -T plant python -c "import urllib.request; r=urllib.request.Request('http://127.0.0.1:8000/api/scenario/reset', method='POST'); print(urllib.request.urlopen(r, timeout=10).read().decode())"
```

Como contexto, el `trainer` genera lecturas periódicas Modbus FC03; no invente tráfico periódico OPC UA o DNP3:

```bash
docker compose exec -T trainer python /lab/scripts/generate-traffic.py --count 5
```

Explique en dos frases qué diferencia hay entre una lectura FC03 de línea base, una observación de aplicación y una trama capturada.

### 2. Ejecutar el escenario OPC UA permitido

Pulse **Escritura OPC UA** o ejecute, sin cambiar el destino:

```bash
docker compose exec -T plant python -c "import urllib.request; r=urllib.request.Request('http://127.0.0.1:8000/api/scenario/opcua-write', method='POST'); print(urllib.request.urlopen(r, timeout=20).read().decode())"
```

La secuencia del operador abre `opc.tcp://plant:4840/ot-lab/`, busca el namespace `urn:ot-ics-labs:planta`, localiza `Planta/SpeedSetpoint` y escribe `75` como `Int64`. Compruebe:

```bash
curl --noproxy '*' -fsS http://127.0.0.1:${DASHBOARD_PORT:-8080}/api/state
curl --noproxy '*' -fsS http://127.0.0.1:${DASHBOARD_PORT:-8080}/api/events
```

Registre el nodo, el valor antes/después, la hora, la respuesta del escenario y la captura de la vista SCADA/3D. El valor esperado es `75 Hz` y la consola puede marcarlo como atención por superar el nominal `<=60 Hz` de la maqueta.

### 3. Capturar el flujo interno

En una terminal A, capture únicamente el conducto de `plant`:

```bash
docker compose exec -T plant timeout 20 tcpdump -i any -U -s 0 -w /captures/03-opcua.pcap 'tcp port 4840'
```

Durante esa ventana, en una terminal B repita una sola vez el escenario `opcua-write`. Al terminar:

```bash
test -s pcaps/03-opcua.pcap
ls -lh pcaps/03-opcua.pcap
```

La captura se realiza en el namespace del contenedor y el volumen la deja en `pcaps/03-opcua.pcap`. No es una captura de la red del anfitrión ni de una red OT real.

### 4. Inspeccionar con tshark

Con `tshark` del anfitrión:

```bash
tshark -r pcaps/03-opcua.pcap -Y 'tcp.port == 4840' \
  -T fields -E header=y -E separator=, \
  -e frame.number -e frame.time -e ip.src -e ip.dst \
  -e tcp.srcport -e tcp.dstport -e frame.len -e _ws.col.Info
```

Si existe el disector OPC UA, pruebe también:

```bash
tshark -r pcaps/03-opcua.pcap -Y 'opcua' \
  -T fields -E header=y -E separator=, \
  -e frame.number -e frame.time -e ip.src -e ip.dst \
  -e tcp.srcport -e tcp.dstport -e _ws.col.Info
```

Informe extremos, puertos, número de frames, tamaños y correlación temporal con `/api/events`. Si `-Y opcua` no decodifica nada, conserve el filtro TCP y anote la limitación; no invente `WriteRequest`, NodeId, identidad o campos que el disector no entregue.

### 5. Separar evidencia técnica de observación

Complete esta tabla:

| Fuente | Qué permite afirmar | Qué no permite afirmar |
|---|---|---|
| `trainer`/respuesta del escenario | Que el cliente didáctico ejecutó un Write hacia `plant:4840` | Que existió un adversario o una identidad criptográfica fuerte |
| PCAP `tcp.port==4840` | Que se observó tráfico TCP en el namespace capturado | Que el navegador generó esos bytes, que fue malicioso o que se vio toda la red |
| `/api/state` y 3D | Que el gemelo refleja `speed_setpoint=75` | Que haya cambiado un PLC/SIS o un sensor físico |
| `/api/events` | Que la aplicación registró la escritura y el cambio | Que sea un espejo completo de paquetes o una prueba de autorización |
| EVE/Suricata, si aparece | Que el sensor generó ese registro | Que la ausencia de alerta descarte una anomalía |

### 6. Restablecer y preservar la evidencia

```bash
docker compose exec -T plant python -c "import urllib.request; r=urllib.request.Request('http://127.0.0.1:8000/api/scenario/reset', method='POST'); print(urllib.request.urlopen(r, timeout=10).read().decode())"
```

`reset` vuelve el gemelo a línea base; no borra históricos ni el PCAP. Entregue las evidencias antes de considerar `docker compose down -v`, que elimina volúmenes.

## Preguntas de análisis

1. ¿Qué aporta `Sign` y qué aporta adicionalmente `SignAndEncrypt`? ¿Qué significa que el endpoint de esta práctica sea `None`?
2. ¿Cómo se autentica una aplicación OPC UA mediante certificado y TrustList? ¿Por qué autenticación de aplicación, autenticación de usuario y autorización no son sinónimos?
3. Diseñe una política en la que supervisión pueda leer y suscribirse, pero solo ingeniería pueda escribir `Planta/SpeedSetpoint` en una ventana aprobada. Incluya rol, nodo, rango, identidad, aprobación y auditoría.
4. ¿Qué parte de su evidencia es una representación técnica y qué parte es observación? ¿Por qué una captura HTTP del navegador no demuestra los bytes OPC UA?
5. Relacione el cambio con MITRE ATT&CK for ICS **T0836 Modify Parameter** como analogía técnica. Explique por qué no es correcto presentar el escenario autorizado como intrusión. Compare, sin etiquetar automáticamente el laboratorio, con T1692.001 Command Message.
6. Mapee conceptualmente FR1–FR7 de IEC 62443 a controles para este conducto. Explique por qué el mapa no es certificación, `SL-A`, `SL-T` ni afirmación de cumplimiento.
7. ¿Qué límites de hardware, observabilidad, aislamiento y contexto legal chileno deben constar en el informe? Use la fuente oficial de Ley 21.663 sin afirmar plazos, multas o aplicabilidad no verificada.

## Entregable

Una ficha de 1–3 páginas o equivalente que incluya:

- diagrama `trainer` → `plant:4840` y rol del navegador;
- ficha `Planta/SpeedSetpoint`, valor antes/después y captura 3D;
- respuesta del escenario, `/api/state`, `/api/events`, PCAP y filtro/salida `tshark`;
- tabla de evidencia “demuestra/no demuestra”;
- política de certificados, TrustLists, autenticación, roles, permisos por nodo, ventana y auditoría;
- matriz MITRE (T0836 como analogía) y matriz conceptual IEC FR1–FR7;
- aislamiento, uso legal, límites de maqueta, límites de PCAP y antipatrones corregidos.

## Rúbrica (10 puntos)

| Criterio | Puntos | Evidencia esperada |
|---|---:|---|
| Ejecución reproducible | 2 | Usa solo `opcua-write`/`reset`, destino fijo Docker y obtiene `75` |
| Vista y estado del gemelo | 1 | Antes/después, 3D/SCADA y aclaración de que no hay hardware |
| PCAP/tshark | 2 | Captura interna, filtro `4840`, extremos/frames/timestamps y limitaciones del disector |
| Distinción de fuentes | 2 | Separa trainer, PCAP, API/evento, 3D y navegador; no atribuye bytes incorrectamente |
| Seguridad OPC UA | 1 | Explica None, Sign, SignAndEncrypt, certificados/TrustList, usuario, roles y nodo |
| MITRE e IEC 62443 | 1 | T0836 justificado como analogía y FR1–FR7 como mapa conceptual sin certificación |
| Aislamiento, legalidad y límites | 1 | No OT real, no PLC/SIS, no proxy transparente, no tráfico periódico inventado y Ley 21.663 solo contextual |

## Solución orientativa (abrir después de evaluar)

### Resultado técnico

El cliente real es `trainer`, no el navegador. `trainer` usa `asyncua.Client` contra `opc.tcp://plant:4840/ot-lab/`, obtiene el namespace `urn:ot-ics-labs:planta`, localiza `Planta/SpeedSetpoint` y escribe `75` como `Int64`. El servidor notifica el cambio, el gemelo actualiza `speed_setpoint` y la API/panel pueden mostrar una condición fuera del nominal. La operación es un Write auténtico de la maqueta, pero está autorizada/predefinida por el laboratorio y no prueba una intrusión.

### Resultado de observabilidad

El PCAP debe contener un flujo TCP entre las direcciones internas de `trainer` y `plant` por `4840`, sujeto a la ventana de captura y al disector. La salida `tshark -Y 'tcp.port == 4840'` es una evidencia válida aunque `-Y opcua` no decodifique. La API del navegador usa HTTP/JSON: una solicitud a `127.0.0.1:8080` activa la API; no convierte al navegador en emisor de los bytes OPC UA. `/api/events`, el estado y la vista 3D son observaciones separadas. Ningún resultado permite inferir una identidad criptográfica porque `None` no aporta ese canal seguro.

### Política de diseño esperada

Un diseño razonable exige endpoint seguro `Sign` o `SignAndEncrypt` según el objetivo, certificado de aplicación en una TrustList gestionada, autenticación de usuario, rol `Observer`/`Operator` para lectura y `Engineer` para Write en el nodo exacto, rango y ventana aprobados, validación de precondiciones, auditoría y segmentación/allowlist del conducto. La maqueta no implementa esos controles: `SecurityPolicy None` y `set_writable()` solo hacen visible la brecha.

### MITRE e IEC

`T0836 Modify Parameter` es una relación técnica justificada porque se cambia un parámetro de proceso; el alcance correcto es “analogía controlada, no atribución”. T1692.001 puede compararse con mensajes de comando no autorizados, pero no debe marcarse como hallazgo de este escenario autorizado. FR1 cubre identidad/autenticación, FR2 uso/roles, FR3 integridad y validación, FR4 confidencialidad, FR5 zonas/conductos, FR6 respuesta y FR7 disponibilidad. Es un mapa conceptual: no hay certificación IEC 62443 ni nivel de seguridad alcanzado.

### Límites y contexto chileno

La representación es software 3D/gemelo, sin PLC ni SIS; la captura es del namespace interno de `plant`, no un espejo OT completo; el proxy Modbus del repositorio no es transparente; y la línea base real es FC03 Modbus, no tráfico OPC UA/DNP3 periódico inventado. La Ley 21.663 se cita únicamente por su objeto general de marco de ciberseguridad usando [Ley Chile](https://www.bcn.cl/leychile/navegar?idNorma=1202434); no se deducen plazos, multas, categoría regulatoria ni cumplimiento.

## Referencias

1. [OPC Foundation — OPC UA Part 2: Security Model](https://reference.opcfoundation.org/specs/OPC-10000-2/4)
2. [OPC Foundation — OPC UA Part 4: Services](https://reference.opcfoundation.org/specs/OPC-10000-4/4)
3. [OPC Foundation — OPC UA Part 18: Role Model](https://reference.opcfoundation.org/specs/OPC-10000-18/4)
4. [MITRE ATT&CK for ICS — T0836 Modify Parameter](https://attack.mitre.org/techniques/T0836/)
5. [MITRE ATT&CK for ICS — T1692.001 Command Message](https://attack.mitre.org/techniques/T1692/001/)
6. [IEC SyC Smart Energy — IEC 62443](https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/)
7. [Ley Chile — Ley 21.663, Ley Marco de Ciberseguridad](https://www.bcn.cl/leychile/navegar?idNorma=1202434)
