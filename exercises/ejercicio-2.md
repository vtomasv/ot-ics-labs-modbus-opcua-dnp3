# Práctica 2 — Integridad Modbus y proxy didáctico

**Duración:** 50 min. **Protocolo:** Modbus/TCP. **Uso exclusivamente educativo, defensivo y aislado.**

> **Aislamiento y uso legal obligatorio.** Ejecuta esta práctica solo en la red Docker privada del repositorio. No conectes el laboratorio a una red OT real, PLC, RTU, SIS, sensores, válvulas ni equipos de terceros. No publiques `502/TCP`, `4840/TCP` ni `20000/TCP`, no cambies los destinos fijos y no pruebes los comandos fuera del gemelo. La consola se publica únicamente en loopback. La Ley chilena 21.663 se menciona solo como contexto general; esta práctica no determina cumplimiento, aplicabilidad, plazos ni sanciones [6].

## Objetivo

Demostrar, con evidencias separadas, qué significa observar y comparar una transacción Modbus/TCP dentro de un gemelo digital:

- observar lecturas FC03 de línea base sin presentarlas como intrusión;
- ejecutar una escritura FC06 al registro 2 (direccionamiento PDU 0-based) y correlacionar 45→85 Hz;
- ejecutar el **proxy explícito** de una sola trama y comparar 45→90 Hz;
- distinguir PCAP, estado del gemelo, eventos de aplicación y firma `engine: Suricata`;
- proponer controles conceptuales IEC 62443 y justificar el alcance MITRE sin atribuir un actor.

La maqueta 3D/software representa tanque, bomba, caudal, cartel, semáforo y lógica de proceso. **No contiene un PLC físico ni un SIS real.** Los paquetes Modbus/TCP entre contenedores son reales dentro del escenario, pero la vista SCADA/3D es solo una representación del estado de la API.

## Prerrequisitos y arranque

Desde la raíz del repositorio, con Docker Engine y Compose v2:

```bash
docker compose config --quiet
docker compose up -d
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/health | python3 -m json.tool
```

Si el puerto local ya está ocupado, usa la variable documentada por el repositorio y conserva el bind de loopback. Ejecuta `bash scripts/verify-lab.sh` si necesitas comprobar la instalación completa; los escenarios OPC UA y DNP3 que ese verificador pueda ejecutar no forman parte de la evidencia de esta práctica. Para la línea base de 02-modbus solo se genera FC03 y se captura TCP/502; **no inventes tráfico periódico de OPC UA o DNP3**.

## Procedimiento del alumno

### 1. Restablecer y observar la línea base

Pulsa **Restablecer laboratorio** o ejecuta:

```bash
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/reset | python3 -m json.tool
curl --noproxy '*' -fsS \
  http://127.0.0.1:8080/api/state | python3 -m json.tool
```

Registra nominalmente 45 Hz, bomba encendida, caudal cercano a 22,5 m³/h y semáforo verde. El reset no borra históricos ni PCAP.

Genera cinco lecturas FC03 al único destino permitido:

```bash
docker compose exec -T trainer \
  python /lab/scripts/generate-traffic.py --count 5
```

La petición PDU esperada comienza `01 03 00 00 00 07`: unidad 1, FC03, dirección inicial 0 y siete registros. El Transaction Identifier del MBAP depende del cliente y no debe inventarse. La especificación oficial de Modbus define FC03 para leer holding registers y FC06 para escribir un único holding register; sus direcciones PDU empiezan en cero [1].

### 2. Ejecutar la escritura FC06

Pulsa **Escritura Modbus** o utiliza el script cerrado:

```bash
docker compose exec -T trainer \
  python /lab/scripts/attack-modbus-write.py --lab-only
```

Comprueba:

```bash
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/state | python3 -m json.tool
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/events | python3 -m json.tool
```

Rotula en tu hoja la solicitud de referencia:

```text
00 11 00 00 00 06 01 06 00 02 00 55
```

`00 11` es el TID de ejemplo, `00 00` el PID, `00 06` la longitud MBAP, `01` la unidad, `06` FC06, `00 02` el registro 2 y `00 55` el valor 85. La respuesta normal es eco. No cambies silenciosamente la dirección 2 por un rótulo 40003: el código de esta maqueta usa el direccionamiento de PDU 0-based.

### 3. Separar la vista 3D de la observabilidad de red

Captura la vista antes/después y consulta:

```bash
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/events | python3 -m json.tool
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/alerts | python3 -m json.tool
docker compose logs --tail=100 suricata
```

Clasifica cada registro como:

- estado del gemelo (`/api/state`);
- evento de aplicación (`/api/events` o `/api/traffic`);
- alerta analítica `OT-ANOMALY` del proceso;
- firma del sensor solo si incluye `engine: Suricata`.

Si no aparece la firma, escribe **sin evidencia IDS**. No conviertas la alerta del proceso en una firma de red.

### 4. Ejecutar el proxy didáctico y comparar bytes

Restablece primero:

```bash
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/reset >/dev/null
```

Pulsa **Proxy de trama Modbus**. La función prepara una trama FC06 nominal, cambia el valor y envía una sola trama al destino fijo `plant:502`. Compara:

```text
ANTES:    00 11 00 00 00 06 01 06 00 02 00 2D
DESPUÉS:  00 11 00 00 00 06 01 06 00 02 00 5A
```

`0x002D`=45 y `0x005A`=90. Solo cambia el valor. Comprueba 90 Hz en la vista y en `/api/state`.

**No lo llames MITM transparente.** No escucha una sesión existente, no modifica terceros, no hace ARP spoofing y no redirige tráfico. Es un proxy explícito de aula que abre una conexión saliente a un único destino. MITRE describe T0830 como una condición de intercepción de tráfico con capacidad de bloquear, registrar, modificar o inyectar; por eso aquí se usa solo una **analogía limitada**, sin asignar T0830 a una observación real [2].

### 5. Crear e inspeccionar un PCAP Modbus

Captura solo TCP/502 dentro del namespace `plant`. Guarda el fichero en `pcaps/`:

```bash
set -u
PCAP="pcaps/lab02-modbus-$(date -u +%Y%m%dT%H%M%SZ).pcap"
NAME="$(basename "$PCAP")"
curl --noproxy '*' -fsS -X POST http://127.0.0.1:8080/api/scenario/reset >/dev/null
docker compose exec -T plant sh -c \
  "timeout 38 tcpdump -i any -U -s 0 -w /captures/$NAME 'tcp port 502'" \
  >/dev/null 2>&1 &
CAP=$!
sleep 3
docker compose exec -T trainer python /lab/scripts/generate-traffic.py --count 5
docker compose exec -T trainer python /lab/scripts/attack-modbus-write.py --lab-only
curl --noproxy '*' -fsS -X POST http://127.0.0.1:8080/api/scenario/reset >/dev/null
curl --noproxy '*' -fsS -X POST http://127.0.0.1:8080/api/scenario/intercept >/dev/null
curl --noproxy '*' -fsS -X POST http://127.0.0.1:8080/api/scenario/reset >/dev/null
set +e
wait "$CAP"; RC=$?
set -e
[ "$RC" -eq 124 ]
test -s "$PCAP"
echo "$PCAP"
```

Inspecciona la captura:

```bash
tshark -r "$PCAP" -Y 'tcp.port == 502' \
  -T fields -e frame.number -e tcp.stream -e ip.src -e tcp.srcport \
  -e ip.dst -e tcp.dstport -e tcp.len

tshark -r "$PCAP" -Y 'modbus && tcp.port == 502' -V
tshark -r "$PCAP" -Y 'modbus && tcp.port == 502' -x
```

Cuando el disector lo soporte, usa además:

```bash
tshark -r "$PCAP" -Y 'modbus.func_code == 3' -V
tshark -r "$PCAP" -Y 'modbus.func_code == 6' -V
```

Si `modbus.func_code` no existe en tu versión, usa `tcp.port == 502` y localiza `Function Code` en `-V`. En la entrega debes distinguir las cabeceras Ethernet/IP/TCP del payload MBAP/PDU. Los 12 bytes de los ejemplos no son una trama Ethernet completa.

**Regla de atribución:** el navegador solo hizo HTTP hacia `127.0.0.1:8080`; el botón no emite directamente FC06 y no se deben atribuir sus bytes al PCAP Modbus. Si no existe PCAP, informa el cambio del gemelo como observación de aplicación, no como transacción de red demostrada.

### 6. Cerrar y entregar

Restablece y deja el gemelo nominal:

```bash
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/reset | python3 -m json.tool
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/state | python3 -m json.tool
```

## Entregable

Entrega una ficha o informe breve que incluya:

1. dos capturas de la vista 3D: nominal y después de 85/90 Hz;
2. la salida de FC03 y la explicación de por qué es línea base, no intrusión;
3. una tabla con al menos ocho campos/bytes de la trama FC06: TID, PID, length, unit, función, dirección, valor y eco/resultado;
4. `45→85` y `45→90` en decimal y hexadecimal (`2D`, `55`, `5A`), con el registro 2 identificado como 0-based;
5. PCAP o, si no se pudo capturar, la declaración explícita de que no se demostró la transacción de red;
6. filtros/salida de Tshark y el número de stream relevante;
7. `/api/state`, `/api/events`, `/api/alerts` y, si existe, la firma `engine: Suricata`;
8. una explicación de por qué el proxy no es MITM transparente y por qué el navegador no es origen de los bytes Modbus;
9. una matriz corta de MITRE y de controles conceptuales IEC 62443;
10. limitaciones y antipatrones detectados.

## Rúbrica — 100 puntos

| Criterio | Puntos | Evidencia esperada |
|---|---:|---|
| Aislamiento, legalidad y alcance | 10 | Declara red Docker, destinos fijos, loopback y ausencia de PLC/SIS/hardware real. |
| Línea base FC03 | 15 | Ejecuta o documenta cinco lecturas, identifica FC03, inicio 0, cantidad 7 y no inventa OPC/DNP periódico. |
| Decodificación Modbus/MBAP | 20 | Rotula ocho campos/bytes y explica unidad 1, FC06, registro 2 0-based, longitud y eco. |
| Correlación FC06 y gemelo | 15 | Prueba 45→85 con script/PCAP/estado y distingue evento de aplicación de captura. |
| Proxy e integridad | 15 | Prueba 45→90, compara `2D`→`5A` y explica que es relay explícito, no MITM transparente. |
| PCAP/Tshark y atribución | 10 | Presenta filtro TCP/502, stream y límites; no atribuye HTTP del navegador al PCAP. |
| Alertas y visibilidad | 5 | Separa `OT-ANOMALY` de `engine: Suricata`; informa “sin evidencia IDS” cuando corresponde. |
| MITRE, IEC y controles | 10 | Justifica T0836 como representación, deja T0830 como analogía sin asignación y propone controles FR conceptuales sin certificación. |

**Aprobación sugerida:** 70 puntos y ningún incumplimiento del aislamiento. Un informe que llame al proxy “MITM real”, atribuya bytes al navegador, declare PLC/SIS físico o invente una firma IDS no puede aprobarse aunque los números sean correctos.

---

# Solución orientativa — revisar después de entregar

## Resultado técnico esperado

La línea base produce cinco solicitudes FC03 desde `trainer` a `plant:502`, sin cambiar `speed_setpoint`. En esta maqueta la lectura inicia en dirección 0 y solicita siete registros. Los bytes exactos del TID pueden variar por cliente; no se debe inventar un MBAP completo para FC03 a partir de la guía.

La escritura del escenario `modbus-write` confirma una lectura anterior, un FC06 al registro 2 y una lectura de retorno con 85. La trama de referencia queda:

```text
00 11 00 00 00 06 01 06 00 02 00 55
```

El estado del gemelo puede mostrar 85 Hz, caudal aumentado y advertencia visual. Es un efecto simulado; no es la medida de un motor ni la actuación de un PLC.

El proxy registra y envía:

```text
00 11 00 00 00 06 01 06 00 02 00 2D
00 11 00 00 00 06 01 06 00 02 00 5A
```

La única diferencia son los dos bytes del valor: 45 (`0x002D`) y 90 (`0x005A`). El TID, PID, longitud, unidad, función y dirección no cambian. El resultado demuestra una comparación de integridad de una orden preparada por el laboratorio, no una modificación transparente de la red.

## Interpretación MITRE correcta

**T0836 Modify Parameter** es un mapeo justificado como representación didáctica del cambio del parámetro de velocidad: MITRE describe la modificación de parámetros usados para instruir dispositivos ICS y el posible resultado fuera de lo esperado [2]. Debe escribirse como “comportamiento representado” o “resultado simulado”, nunca como prueba de actor, campaña o intrusión.

La descripción oficial de **T0830 Adversary-in-the-Middle** incluye interceptar tráfico hacia o desde un dispositivo y la capacidad de modificarlo o inyectarlo [3]. El proxy del ejercicio no escucha una conexión existente ni intermedia terceros. Por eso la solución debe decir **analogía limitada sin ID asignado al escenario**, no “se observó T0830”.

FC03 es una observación autorizada del laboratorio. No debe asignarse automáticamente a sniffing ni a otra técnica ATT&CK.

## Matriz IEC 62443 esperada

La serie ISA/IEC 62443 define requisitos y procesos para sistemas de automatización y control, y su marco IEC resume los siete requisitos fundamentales y el concepto de zonas/conductos [4] [5].

| FR | Control propuesto |
|---|---|
| FR1 | Identidad y autenticación fuerte para cliente/dispositivo; el token de demostración no basta. |
| FR2 | Roles, mínimo privilegio, ventanas/aprobaciones y lista de registros/rangos escribibles. |
| FR3 | Integridad/autenticidad de mensajes, anti-replay, validación de rango/estado y auditoría. Modbus/TCP sin protección adicional no aporta integridad criptográfica. |
| FR5 | Zonas/conductos, ACL y firewall industrial que permitan solo el flujo necesario; `internal: true` es una aproximación de aula, no una DMZ. |
| FR6 | Correlación de PCAP, eventos y EVE; respuesta y recuperación verificables. La firma de aula no es un IDS de producción. |

El mapeo es conceptual. No demuestra SL-T, SL-A, conformidad ni certificación IEC 62443. FR4 y FR7 quedan fuera del objetivo central, aunque podrían formar parte de una evaluación real.

## Antipatrones que la solución debe rechazar

- “El navegador envió FC06”: falso; el navegador llamó la API HTTP y `trainer` generó la conexión Modbus.
- “El proxy es MITM”: falso; es una conexión explícita de una trama a `plant:502`, sin ARP spoofing ni transparencia.
- “85 Hz en la pantalla es un paquete observado”: incompleto; es estado del gemelo, que debe correlacionarse con PCAP.
- “OT-ANOMALY es Suricata”: falso; solo `engine: Suricata` atribuye una entrada al IDS.
- “Hay un PLC/SIS porque la vista lo muestra”: falso; todo es software/3D.
- “La práctica generó FC03, OPC UA y DNP3 periódicos”: falso para este alcance; solo se debe afirmar el FC03 explícito y el tráfico Modbus capturado.

## Referencias

[1]: https://www.modbus.org/file/secure/modbusprotocolspecification.pdf "MODBUS Application Protocol Specification V1.1b3"
[2]: https://attack.mitre.org/techniques/T0836/ "MITRE ATT&CK for ICS T0836: Modify Parameter"
[3]: https://attack.mitre.org/techniques/T0830/ "MITRE ATT&CK for ICS T0830: Adversary-in-the-Middle"
[4]: https://www.isa.org/standards-and-publications/isa-standards/isa-iec-62443-series-of-standards "ISA/IEC 62443 Series of Standards"
[5]: https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/ "IEC cybersecurity guidelines: IEC 62443 foundational requirements"
[6]: https://www.bcn.cl/leychile/navegar?idNorma=1202434 "Biblioteca del Congreso Nacional de Chile: Ley 21.663"
