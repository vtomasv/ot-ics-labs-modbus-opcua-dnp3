# Laboratorio 02 — Integridad Modbus y proxy didáctico

**Duración orientativa:** 50 minutos. **Protocolo:** Modbus/TCP. **Modo:** escenario controlado, educativo y defensivo.

## Aislamiento y uso legal — lectura obligatoria

Ejecute esta práctica únicamente en el repositorio clonado y en la red Docker privada del laboratorio. No la conecte a una red OT real, a Internet industrial, a un PLC, a un SIS, a una RTU física ni a un tercero. No cambie `plant:502`, no añada destinos configurables y no publique `502/TCP`, `4840/TCP` ni `20000/TCP`. El único puerto publicado por Compose es la consola HTTP en `127.0.0.1:8080` (o el puerto local que el proyecto ya configure); no cambie el bind a `0.0.0.0`.

El propósito es aprender a verificar integridad de mensajes y correlación de evidencias, no probar técnicas contra activos ajenos. El uso fuera de este escenario debe contar con autorización escrita, análisis de seguridad de proceso y coordinación con el responsable de la instalación. La Ley chilena 21.663 se cita solo como contexto general de gobernanza y ciberseguridad; esta guía no determina aplicabilidad jurídica, cumplimiento, plazos ni sanciones. Consulte siempre la versión oficial vigente y la asesoría legal competente antes de tomar decisiones.

## Objetivo y alcance

El alumno observará una línea base de lecturas FC03 y contrastará dos órdenes Modbus/TCP que afectan el mismo registro de velocidad del gemelo digital:

1. **Escritura Modbus:** una escritura FC06 auténtica desde `trainer` a `plant:502`, registro 2, que lleva el setpoint simulado de 45 a 85 Hz.
2. **Proxy de trama Modbus:** una función didáctica prepara una trama nominal de 45 Hz, cambia solo su valor a 90 Hz y abre una conexión saliente única al destino fijo `plant:502`.

La práctica representa un resultado técnico observable —un parámetro cambia y el proceso software reacciona—, no una intrusión real ni una atribución de actor. El segundo escenario es una comparación de integridad en un relay explícito. **No es un MITM transparente:** no escucha una conexión existente, no redirige ARP, no se coloca entre dos terceros y no modifica tráfico de una red externa.

La planta es una maqueta 3D/software. La consola Three.js visualiza el estado servido por la API; no hay sensores, válvulas, motor, PLC físico ni SIS físico. La protección que puede detener la bomba por umbral es lógica local del gemelo y no una función de seguridad certificada. Los paquetes Modbus/TCP entre contenedores sí son transacciones de protocolo dentro del laboratorio; la pantalla 3D no sustituye un PCAP.

El enfoque de esta práctica sigue la cautela de seguridad OT de NIST: preservar requisitos de rendimiento, confiabilidad y seguridad de proceso mientras se aplican controles de ciberseguridad [8].

## Qué se debe demostrar

- Que FC03 es una lectura de holding registers y no prueba por sí sola una intrusión.
- Que FC06 escribe un único holding register y que en esta maqueta la dirección de aplicación es **2, 0-based**, con valor nominal `45` (`0x002D`).
- Que la escritura del escenario `modbus-write` produce `85` (`0x0055`) y que el proxy produce `90` (`0x005A`).
- Que la petición de ejemplo `00 11 00 00 00 06 01 06 00 02 00 2D` conserva TID, PID, longitud, unidad, función y dirección cuando su último valor pasa a `00 5A`.
- Que el PCAP, `/api/state`, `/api/events` y `/api/alerts` son fuentes distintas. Una alerta de proceso no se convierte automáticamente en firma Suricata.
- Que los bytes del navegador no deben atribuirse al PCAP Modbus: el navegador hace HTTP hacia la API local y esa API solicita al operador el tráfico OT dentro de Docker.

## Prerrequisitos

- Docker Engine y Docker Compose v2.
- Al menos 2 GB libres para construir imágenes y guardar evidencias.
- Linux amd64/x86_64 validado; en ARM64 se requiere la emulación amd64 disponible en Docker Desktop.
- `curl`, `python3` y `tshark` en el anfitrión son convenientes. `tshark` no es obligatorio para ejecutar el escenario, pero sí para inspeccionar bytes. `tcpdump` y las bibliotecas de protocolo ya están dentro de la imagen.
- Un terminal desde el directorio raíz del repositorio.

## Arranque seguro

Desde la raíz del repositorio:

```bash
docker compose version
docker compose config --quiet
docker compose up -d
docker compose ps
bash scripts/verify-lab.sh
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/health | python3 -m json.tool
```

El estado esperado es `plant` y `trainer` saludables, con `dnp3` y `suricata` en ejecución. `verify-lab.sh` comprueba el conjunto del repositorio; si se usa, sus casos adicionales no forman parte de la evidencia específica de este laboratorio. Para esta guía no se presenta tráfico periódico OPC UA o DNP3: la línea base se genera de forma explícita con FC03 y la captura se filtra a TCP/502.

Si el puerto local 8080 ya está ocupado, siga el mecanismo documentado por el proyecto para cambiar `DASHBOARD_PORT`, mantenga el bind en loopback y use el puerto local resultante en los comandos HTTP. No publique el panel en una interfaz de red.

## Paso 1: restablecer y registrar la línea base

Pulse **Restablecer laboratorio** en la consola o use la API local:

```bash
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/reset | python3 -m json.tool
curl --noproxy '*' -fsS \
  http://127.0.0.1:8080/api/state | python3 -m json.tool
```

Registre antes de generar tráfico:

- `speed_setpoint = 45` Hz;
- bomba encendida;
- caudal cercano a `22.5` m³/h;
- semáforo virtual verde (`traffic_signal = 2`);
- cartel de operación (`sign_code = 0`), salvo que el estado se esté actualizando en ese segundo.

La respuesta HTTP solo confirma una acción de la API. No se debe rotular el POST de reset como trama Modbus.

## Paso 2: observar FC03 sin inventar tráfico

El cliente cíclico integrado en `trainer` lee siete registros desde la dirección 0 cada tres segundos. Para una muestra acotada y reproducible, ejecute:

```bash
docker compose exec -T trainer \
  python /lab/scripts/generate-traffic.py --count 5
```

La salida imprime los registros recibidos. La implementación mantiene este mapa 0-based:

| Dirección de aplicación | Contenido del holding register | Tipo didáctico |
|---:|---|---|
| 0 | nivel × 10 | lectura |
| 1 | bomba (`0`/`1`) | lectura/orden restringida |
| 2 | velocidad en Hz | lectura/orden restringida |
| 3 | temperatura × 10 | lectura |
| 4 | caudal × 10 | lectura |
| 5 | semáforo virtual | lectura/orden restringida |
| 6 | código de cartel | lectura/orden restringida |

En la PDU, la petición FC03 de esta herramienta comienza conceptualmente por `01 03 00 00 00 07`: unidad 1, función 03, inicio 0 y cantidad 7. El Transaction Identifier del MBAP lo decide el cliente y no debe inventarse a partir de este texto. La respuesta contiene la función `03`, un byte count de `0E` y catorce bytes de datos para siete registros.

La especificación oficial de Modbus define FC03 para leer un bloque contiguo de holding registers y aclara que en la PDU las direcciones comienzan en cero. También define FC06 para escribir un único holding register y devolver normalmente un eco de la solicitud [3]. La introducción oficial resume la semántica de FC03 y FC06 y su encapsulado sobre TCP/IP [4].

**Interpretación:** cinco lecturas FC03 son una observación de un flujo autorizado del laboratorio. No demuestran por sí mismas reconocimiento malicioso, acceso no autorizado ni una técnica ATT&CK.

## Paso 3: ejecutar la escritura FC06

Se puede pulsar **Escritura Modbus** en la consola o usar el script cerrado que exige confirmación de laboratorio:

```bash
docker compose exec -T trainer \
  python /lab/scripts/attack-modbus-write.py --lab-only
```

El script lee el registro 2, escribe 85 y vuelve a leerlo. Compruebe el resultado:

```bash
curl --noproxy '*' -fsS \
  http://127.0.0.1:8080/api/state | python3 -m json.tool
curl --noproxy '*' -fsS \
  http://127.0.0.1:8080/api/events | python3 -m json.tool
```

La petición FC06 de referencia puede verse como estos 12 bytes de **MBAP + PDU**, no como una trama Ethernet completa:

```text
00 11 00 00 00 06 01 06 00 02 00 55
```

La separación es:

| Bytes | Campo | Valor |
|---|---|---|
| `00 11` | Transaction Identifier | `0x0011` |
| `00 00` | Protocol Identifier | `0x0000` |
| `00 06` | Length | 6 bytes después de este campo |
| `01` | Unit Identifier | 1 |
| `06` | Function Code | FC06, Write Single Register |
| `00 02` | Register Address | 2, dirección 0-based de la maqueta |
| `00 55` | Register Value | `0x0055` = 85 |

El servidor devuelve normalmente el eco de la solicitud. Una lectura de retorno a 85 y el cambio en `/api/state` son evidencia del efecto simulado. No son evidencia de que exista un PLC físico ni de que una autoridad industrial haya aprobado la orden.

## Paso 4: inspeccionar la vista SCADA/3D y separar fuentes

En la consola, observe el tanque, la bomba, el caudal, el cartel y el semáforo virtual. El aumento a 85 Hz puede cambiar el caudal y hacer visible una advertencia. Esos indicadores son el **modelo de proceso**; no son sensores físicos independientes.

Consulte las tres fuentes por separado:

```bash
curl --noproxy '*' -fsS \
  http://127.0.0.1:8080/api/state | python3 -m json.tool
curl --noproxy '*' -fsS \
  http://127.0.0.1:8080/api/events | python3 -m json.tool
curl --noproxy '*' -fsS \
  http://127.0.0.1:8080/api/alerts | python3 -m json.tool
```

- `/api/state` muestra el estado del gemelo.
- `/api/events` contiene eventos de aplicación, como `Modbus/TCP` y efectos simulados.
- `/api/alerts` combina alertas calculadas por la lógica del gemelo con alertas leídas de EVE JSON. Solo una entrada que indique `engine: Suricata` se debe presentar como firma del IDS.

Si no aparece una alerta `engine: Suricata`, escriba **sin evidencia IDS** y revise `docker compose logs suricata`. No convierta una alerta `OT-ANOMALY cambio de parámetro fuera de línea base` en una detección de red.

## Paso 5: ejecutar el proxy didáctico

Restablezca primero para que la orden de comparación parta de la nominal:

```bash
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/reset | python3 -m json.tool
```

Pulse **Proxy de trama Modbus**. La función del entrenador construye una solicitud FC06 con valor 45, reemplaza únicamente los dos bytes del valor por 90, abre una conexión saliente a `plant:502`, envía una sola trama y comprueba el eco. La consola muestra los campos `ANTES` y `DESPUÉS`; la API registra `frame_before` y `frame_after`.

```text
ANTES:    00 11 00 00 00 06 01 06 00 02 00 2D
DESPUÉS:  00 11 00 00 00 06 01 06 00 02 00 5A
```

`0x002D` es 45 y `0x005A` es 90. TID, PID, longitud, unidad, función y dirección permanecen iguales. El servidor responde al segundo mensaje y el gemelo queda en 90 Hz.

La diferencia didáctica es importante:

- **Técnica representada:** edición de un parámetro dentro de una orden preparada por un relay de aula y posterior efecto en el gemelo.
- **Observación:** el PCAP, los bytes `frame_before/frame_after`, el estado 90 Hz y el evento de aplicación.
- **Lo que no se demuestra:** posición entre dos dispositivos ajenos, ARP spoofing, escucha de una conexión existente, persistencia, acceso a una instalación real o modificación de paquetes de terceros.

Por eso el escenario se relaciona con la idea de integridad de mensajes y se contrasta con la descripción oficial de Adversary-in-the-Middle, pero se marca como **analogía limitada** y no como una observación T0830 [2].

## Paso 6: capturar solo Modbus/TCP

La captura de referencia del repositorio reúne escenarios de varios protocolos. Para esta práctica, genere un PCAP específico con filtro `tcp port 502`. El siguiente procedimiento se ejecuta desde la raíz y guarda el fichero en `pcaps/` mediante el volumen ya definido por Compose:

```bash
set -u
PCAP="pcaps/lab02-modbus-$(date -u +%Y%m%dT%H%M%SZ).pcap"
NAME="$(basename "$PCAP")"
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/reset >/dev/null

docker compose exec -T plant sh -c \
  "timeout 38 tcpdump -i any -U -s 0 -w /captures/$NAME 'tcp port 502'" \
  >/dev/null 2>&1 &
CAPTURE_PID=$!
sleep 3

docker compose exec -T trainer \
  python /lab/scripts/generate-traffic.py --count 5

docker compose exec -T trainer \
  python /lab/scripts/attack-modbus-write.py --lab-only
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/reset >/dev/null
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/intercept >/dev/null
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/reset >/dev/null

set +e
wait "$CAPTURE_PID"
CAPTURE_RC=$?
set -e
[ "$CAPTURE_RC" -eq 124 ]
test -s "$PCAP"
printf 'PCAP: %s\n' "$PCAP"
```

El `timeout` termina la ventana normal con código 124. Si la captura no termina así, conserve los logs y trate el resultado como una anomalía del procedimiento. El filtro limita el fichero a TCP/502; no implica que el navegador haya emitido Modbus.

Para inspección inicial:

```bash
tshark -r "$PCAP" -Y 'tcp.port == 502' \
  -T fields -e frame.number -e frame.time_relative \
  -e tcp.stream -e ip.src -e tcp.srcport -e ip.dst -e tcp.dstport -e tcp.len

tshark -r "$PCAP" -Y 'modbus && tcp.port == 502' -V

tshark -r "$PCAP" -Y 'modbus && tcp.port == 502' -x
```

Use también el filtro de función cuando la versión del disector lo exponga:

```bash
tshark -r "$PCAP" -Y 'modbus.func_code == 3' -V
tshark -r "$PCAP" -Y 'modbus.func_code == 6' -V
```

Si el nombre del campo no existe en la versión instalada, use `-Y 'tcp.port == 502' -V` y localice `Modbus/TCP` y `Function Code` en la salida detallada. La documentación oficial de Suricata muestra que una regla Modbus puede combinar función, acceso, dirección y valor, y advierte sobre la diferencia entre direccionamiento 0-based de una implementación y la convención de una regla [5].

Para rotular una petición FC06 en la entrega:

1. Identifique el stream TCP y el segmento que contiene la solicitud.
2. Separe las cabeceras de transporte del payload Modbus.
3. Lea los siete primeros bytes de MBAP como TID, PID y Length.
4. Lea `01` como Unit Identifier.
5. Lea `06` como función.
6. Lea `00 02` como dirección de aplicación 2.
7. Lea `00 55` o `00 5A` como valor 85 o 90.
8. Compare la dirección y función con el registro de aplicación del repositorio; no cambie silenciosamente a una dirección de documentación 40003.

La solicitud HTTP de un botón no es una fuente válida para afirmar esos bytes. El botón llama a `/api/scenario/...`; el operador dentro de Docker es quien abre la conexión Modbus. Si no hay PCAP, diga que el efecto fue observado en el gemelo y que la transacción de red no quedó demostrada.

## Paso 7: revisar la firma IDS sin sobreinterpretarla

La regla de aula para FC06 busca un byte `06` en un offset fijo del flujo hacia TCP/502. Es una ayuda de entrenamiento, no un analizador Modbus completo. Compruebe el registro por separado:

```bash
docker compose logs --tail=100 suricata
curl --noproxy '*' -fsS \
  http://127.0.0.1:8080/api/alerts | python3 -m json.tool
```

Clasifique el resultado:

| Resultado | Cómo escribirlo |
|---|---|
| Existe entrada con `engine: Suricata` y firma FC06 | “Se observó una firma del sensor Suricata para el flujo capturado”, indicando timestamp y firma. |
| Solo existe `OT-ANOMALY` u otro evento de proceso | “El gemelo generó una alerta analítica; no hay evidencia IDS en la consulta realizada”. |
| No aparece alerta | “Sin evidencia IDS; revisar visibilidad del namespace, logs y ventana de captura”. |

No atribuya una firma a un paquete que no aparezca en el PCAP ni concluya que la ausencia de firma prueba ausencia del paquete. La captura del sensor se limita al namespace y a la interfaz que lleva al conducto `control`; no es un espejo de toda la red del anfitrión.

## Paso 8: restablecer, conservar evidencias y apagar

Antes de entregar:

```bash
curl --noproxy '*' -fsS -X POST \
  http://127.0.0.1:8080/api/scenario/reset | python3 -m json.tool
curl --noproxy '*' -fsS \
  http://127.0.0.1:8080/api/state | python3 -m json.tool
git status --short
```

Confirme 45 Hz y semáforo verde. Conserve el PCAP, el JSON de estado/eventos/alertas y las capturas de la consola. Para detener el entorno sin borrar volúmenes:

```bash
docker compose down
```

No use `docker compose down -v` si necesita conservar los volúmenes de evidencia o logs.

## Evidencias y cadena de correlación

La entrega debe separar las fuentes y anotar hora UTC o una referencia temporal común:

| Fuente | Qué prueba | Qué no prueba |
|---|---|---|
| PCAP `tcp port 502` | Que el sensor de esa interfaz capturó un flujo TCP/Modbus y permite leer MBAP/PDU | Que el navegador produjo esos bytes o que hubo tráfico fuera del namespace |
| `/api/state` | Estado actual del gemelo, por ejemplo 45, 85 o 90 Hz | Estado de un equipo físico |
| `/api/events` y `/api/traffic` | Registro de aplicación y dirección lógica del evento | Firma IDS independiente |
| `/api/alerts` con `engine: Suricata` | Correlación de una alerta EVE del sensor | Que toda alarma de proceso fue detectada por red |
| `docker compose logs suricata` | Diagnóstico del sensor y sus reglas | Visibilidad de interfaces ajenas |
| Vista 3D/SCADA | Representación visual de nivel, bomba, caudal, cartel y semáforo | Medición de campo, SIS o PLC |

La evidencia mínima recomendada es: dos capturas de la vista 3D (45 y 85/90 Hz), el extracto FC06 antes/después, ocho campos o bytes rotulados, la salida del script o del escenario, el estado del gemelo, la consulta de alertas y el PCAP si estuvo disponible.

## Matriz MITRE ATT&CK for ICS

MITRE describe **T0836 Modify Parameter** como la modificación de parámetros usados para instruir dispositivos ICS, con posible resultado fuera de lo esperado, y la ubica en la táctica **Impair Process Control** [1]. En esta práctica la técnica es una **representación didáctica del comportamiento final**: el laboratorio escribe un registro de velocidad y el gemelo reacciona. No es evidencia de que un adversario haya realizado la acción.

| Evidencia del laboratorio | Relación | Alcance y control defensivo |
|---|---|---|
| FC06 registro 2, 45→85 Hz | **T0836 Modify Parameter** | Mapeo justificado por el cambio de un parámetro de control. Aplicar autenticación, autorización, protección de escritura, validación de rango y auditoría. |
| Relay explícito, 45→90 Hz en una trama preparada | **Analogía limitada con Adversary-in-the-Middle** | MITRE describe AiTM como interceptar tráfico hacia/desde un dispositivo y poder bloquear, registrar, modificar o inyectar [2]. Este escenario no satisface esas condiciones: no hay flujo existente de terceros ni transparencia. Se discuten autenticidad de mensajes, segmentación, acceso a red y validación fuera de banda, pero **no se asigna T0830 como observación**. |
| Cinco lecturas FC03 | No se asigna técnica | Es observación de línea base autorizada. Inventariar el flujo y establecer una política de lectura no equivale a afirmar sniffing o intrusión. |

No invente un identificador para “proxy didáctico”, “alteración de bytes” o “alarma del gemelo”. Use el identificador oficial solo cuando la relación esté justificada y escriba “representación”, “analogía” u “observación” con precisión.

## Mapeo conceptual IEC 62443

La serie ISA/IEC 62443 define requisitos y procesos para implementar y mantener sistemas de automatización y control electrónicamente seguros y ofrece una forma de evaluar el desempeño de seguridad [6]. La página de ciberseguridad de IEC resume los siete requisitos fundamentales, sus requisitos técnicos y la idea de zonas/conductos [7]. Aquí se usa **mapeo conceptual y de controles**, no una declaración de conformidad, SL-A, SL-T ni certificación.

| FR | Aplicación conceptual a este laboratorio | Control que debe proponerse | Límite observado |
|---|---|---|---|
| FR1 — Identification and authentication control | Identificar y autenticar cliente, dispositivo y operador antes de permitir FC06 | Identidad fuerte, certificados/credenciales gestionadas, sesiones y auditoría | El token interno es de demostración; no es autenticación de producción |
| FR2 — Use control | Separar lectura FC03 de escritura FC06 y limitar quién puede escribir registro 2 | Roles, mínimo privilegio, ventana de cambio, aprobación y lista de registros/rangos | Los endpoints del laboratorio están cerrados a escenarios predefinidos, no son un IAM completo |
| FR3 — System integrity | Detectar alteración, replay o valor fuera de rango antes de actuar | Autenticidad de mensajes, anti-replay, validación de rango y estado, control de cambios | Modbus/TCP de esta maqueta no aporta integridad criptográfica por sí solo |
| FR5 — Restricted data flow | El conducto permitido es `trainer→plant:502` en red `control` interna | Zonas/conductos definidos por riesgo, ACL, firewalls industriales y puntos de captura pasivos | La red Docker aproxima un conducto; no es una DMZ industrial ni segmentación certificada |
| FR6 — Timely response to events | Correlacionar PCAP, eventos, estado y EVE para alertar y recuperar | Alertas accionables, retención, revisión, contención segura y prueba de restauración | La firma Suricata es didáctica, tiene offset fijo y no asegura visibilidad completa |

FR4 (confidencialidad) no es el objetivo principal de este laboratorio, aunque una arquitectura real debe decidir si aplica. FR7 (disponibilidad) tampoco se valida aquí; no se debe presentar el interlock del gemelo como continuidad o seguridad de disponibilidad industrial. Las decisiones reales requieren evaluación de riesgo de la zona y el conducto, no copiar este ejemplo como diseño productivo.

## Contexto chileno: Ley 21.663

La ficha oficial de la Biblioteca del Congreso Nacional identifica la Ley 21.663 como **Ley Marco de Ciberseguridad** y describe su objeto general e institucionalidad [9]. En esta práctica solo sirve para ubicar la conversación en un contexto nacional de gobernanza: inventario, roles, gestión de incidentes, continuidad y responsabilidades deben revisarse con la normativa y la autoridad que correspondan al caso real. No se extraen de esta guía plazos, multas, categorías de operador ni conclusiones de aplicabilidad. El laboratorio no es una evaluación legal ni regulatoria.

## Antipatrones que deben detectarse

1. **Llamar MITM al proxy:** el código no escucha ni redirige una sesión existente; abre una conexión saliente y envía una sola trama a `plant:502`.
2. **Confundir efecto con captura:** 90 Hz en `/api/state` prueba el efecto del gemelo; solo el PCAP permite afirmar que se observaron bytes Modbus en el punto de captura.
3. **Atribuir bytes al navegador:** el botón genera HTTP hacia loopback. No se debe decir que el navegador envió FC06 ni que esos bytes aparecen en el PCAP por haber pulsado un botón.
4. **Confundir alarma con IDS:** `OT-ANOMALY` es lógica de proceso. `engine: Suricata` identifica una entrada del sensor; si falta, se informa sin evidencia IDS.
5. **Cambiar el direccionamiento sin avisar:** la implementación usa dirección PDU 2 (0-based). No rotule silenciosamente el registro como 40003 ni cambie la interpretación de `00 02`.
6. **Tratar FC06 como firma completa de integridad:** una regla que busca el byte de función no autentica el mensaje, no valida rango y no prueba que el valor sea legítimo.
7. **Inventar tráfico periódico OPC/DNP:** esta práctica genera FC03 explícito y captura TCP/502. No se presenta tráfico de otros protocolos como parte de la línea base de 02-modbus.
8. **Reivindicar hardware o certificación:** tanque, bomba, semáforo, interlock y SIS son representaciones software; el mapeo IEC 62443 es conceptual y no certifica el sistema.
9. **Abrir el laboratorio hacia afuera:** no se cambian nombres, destinos, puertos publicados ni reglas para probar contra equipos reales.

## Cierre

Una conclusión correcta debe poder leerse así: “Observé FC03 de línea base y una escritura FC06 al registro 2 dentro de Docker. El gemelo cambió de 45 a 85 Hz. El proxy didáctico preparó una trama de 45 y envió una trama de 90 al único destino fijo `plant:502`; el PCAP y los campos antes/después sustentan la comparación de bytes. Esto representa modificación de parámetro de forma controlada y se relaciona conceptualmente con T0836, pero no demuestra una intrusión. El relay no es un AiTM transparente. La alerta de proceso y la firma Suricata se reportan por separado. Los controles IEC 62443 son propuestas conceptuales, no certificación.”

## Referencias oficiales

[1]: https://attack.mitre.org/techniques/T0836/ "MITRE ATT&CK for ICS T0836: Modify Parameter"
[2]: https://attack.mitre.org/techniques/T0830/ "MITRE ATT&CK for ICS T0830: Adversary-in-the-Middle"
[3]: https://www.modbus.org/file/secure/modbusprotocolspecification.pdf "MODBUS Application Protocol Specification V1.1b3"
[4]: https://www.modbus.org/introduction-to-modbus "Modbus Organization: Introduction to Modbus"
[5]: https://docs.suricata.io/en/latest/rules/modbus-keyword.html "Suricata documentation: Modbus keyword"
[6]: https://www.isa.org/standards-and-publications/isa-standards/isa-iec-62443-series-of-standards "ISA/IEC 62443 Series of Standards"
[7]: https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/ "IEC cybersecurity guidelines: IEC 62443 foundational requirements"
[8]: https://csrc.nist.gov/pubs/sp/800/82/r3/final "NIST SP 800-82 Rev. 3: Guide to Operational Technology Security"
[9]: https://www.bcn.cl/leychile/navegar?idNorma=1202434 "Biblioteca del Congreso Nacional de Chile: Ley 21.663, Ley Marco de Ciberseguridad"
