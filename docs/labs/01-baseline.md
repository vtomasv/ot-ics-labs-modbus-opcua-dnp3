# Laboratorio 01 — Línea base y observabilidad OT

- **Duración:** 60–75 minutos
- **Alcance:** solo `01-baseline` de esta maqueta
- **Repositorio:** `ot-ics-labs-modbus-opcua-dnp3`

## Aislamiento obligatorio y uso legal

> Ejecute esta práctica exclusivamente en el repositorio y en una red Docker de laboratorio, con autorización del propietario del equipo. No conecte el proyecto a una planta, PLC, SIS, RTU, sensor, actuador, red corporativa o Internet OT. No escanee, capture ni modifique equipos de terceros. No publique `502/TCP`, `4840/TCP` ni `20000/TCP`; no cambie los destinos fijos de los scripts.

El escenario es defensivo y educativo. La red `control` del Compose es `internal: true`; el único acceso publicado por defecto es el panel HTTP ligado a `127.0.0.1:8080`. La señal de proceso, la protección y la visualización son simulaciones. La guía no autoriza pruebas fuera de la maqueta ni constituye asesoría legal.

## Qué se aprende y qué no se debe afirmar

El objetivo es construir una línea base de comunicaciones y de estado: reconocer una lectura Modbus/TCP FC03, documentar su origen y destino, observar el gemelo digital y conservar un PCAP reproducible. La especificación oficial describe FC03 como lectura de un bloque contiguo de holding registers y FC06 como escritura de un solo holding register; una lectura FC03 no es un comando FC06 [1]. Modbus codifica direcciones y datos de más de un byte en orden *big-endian* [1].

El tráfico Modbus generado por `trainer` es real dentro del namespace Docker. OPC UA y DNP3 también son implementaciones de software que pueden producir bytes reales, pero en esta práctica no se inventa que sean periódicos: aparecen en la captura solo cuando el script `baseline-capture.sh` activa de manera explícita sus escenarios. El repositorio no representa una planta con hardware.

### Técnica representada frente a observación

| Técnica representada en el software | Observación que se puede verificar | Lo que **no** demuestra |
|---|---|---|
| `trainer` solicita siete registros de holding desde la dirección PDU 0 mediante FC03 hacia `plant:502`. | Petición y respuesta FC03 en el PCAP; evento Modbus/TCP; valores en la API/panel. | Que un adversario haya leído el proceso, que la IP sea una identidad autorizada o que el panel sea un sensor independiente. |
| El proceso `baseline()` del trainer intenta FC03 cada 3 s mientras el servicio está activo. | Periodicidad aproximada en el PCAP y en eventos de aplicación. | Tráfico periódico de OPC UA o DNP3. No se debe atribuir tal tráfico si no se observó. |
| `baseline-capture.sh` abre una ventana de 22 s y llama explícitamente a `modbus-write`, `opcua-write`, `dnp3-signal` e `intercept`. | Flujos FC06, OPC UA y DNP3/TCP posteriores a esas llamadas, además de FC03. | Que esos cuatro flujos sean “normalidad” o que exista un operador malicioso. Etiquételos como **tráfico inducido por escenario**. |
| Suricata observa la interfaz que lleva al conducto `control`. | Una alerta EVE JSON con `engine: Suricata`, si la regla coincide. | Un espejo completo de la red o una alerta cuando no existe una firma. Es válido registrar **sin evidencia IDS**. |
| El panel muestra estado, eventos y alertas. | Evidencia de aplicación y estado visual del gemelo. | Bytes de red. Los bytes mostrados por el navegador no se atribuyen a un PCAP. |
| `intercept` envía una sola PDU editada a `plant:502`. | Campos de aplicación `frame_before`/`frame_after` y la transacción resultante. | Un proxy transparente, MITM, ARP spoofing o intercepción de terceros. |

## Prerrequisitos

- Docker Engine y Docker Compose v2 (`docker compose version`).
- Al menos 2 GB libres para imágenes y evidencias. En ARM64 se necesita emulación `linux/amd64`; no es soporte nativo.
- Un navegador en el mismo anfitrión. Wireshark o TShark son opcionales en el anfitrión para leer el archivo, no para escuchar interfaces de una planta.
- Una copia del repositorio en el equipo de práctica.

El repositorio instala las bibliotecas de protocolo y `tcpdump` dentro de la imagen. El panel se publica solo en loopback. No cambie el bind a `0.0.0.0`.

## Arquitectura de la maqueta

| Nodo | Rol didáctico | Zona/alcance | Evidencia principal |
|---|---|---|---|
| Navegador `127.0.0.1:8080` | SCADA/HMI y vista Three.js | `dashboard`, fuera del conducto `control` | pantalla y JSON descargado por el panel |
| `plant` | API, gemelo digital, servidor Modbus/TCP 502 y OPC UA 4840 | `control` + namespace de `plant` | PCAP, API, eventos |
| `trainer` | cliente/maestro controlado; FC03 y escenarios explícitos | `control` interna | salida de scripts, PCAP |
| `dnp3` | outstation DNP3 software | `network_mode: service:plant` | PCAP de `plant:20000` cuando se activa el escenario |
| `suricata` | sensor pasivo y EVE JSON | namespace de `plant` | `api/alerts` y volumen de logs |

Flujos autorizados de la maqueta:

```text
navegador --HTTP loopback:8080--> plant:8000 (panel/API)
trainer   --Modbus/TCP-----------> plant:502
trainer   --OPC UA/TCP-----------> plant:4840 (solo al activar escenario OPC UA)
trainer   --DNP3/TCP-------------> plant:20000 (solo al activar escenario DNP3)
trainer   --tráfico de control---> suricata (copia pasiva visible)
```

Los puertos industriales no se publican al anfitrión. `trainer` usa literalmente el nombre Docker `plant`, y el maestro DNP3 fija `plant:20000`. El puente entre panel y control es una decisión didáctica y **no** equivale a una DMZ industrial o a una separación Purdue física. NIST SP 800-82 Rev. 3 recuerda que OT tiene requisitos propios de desempeño, confiabilidad y seguridad física; una captura segura no debe poner en riesgo un proceso real [13].

## Procedimiento paso a paso

### 1. Validar el perímetro y arrancar

Desde la raíz del repositorio:

```bash
cd /home/ubuntu/work/ot-ics-labs-modbus-opcua-dnp3
docker compose config --quiet
docker compose up -d
docker compose ps
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/health
```

Se espera `ok: true`, modo `SIMULATED_LAB_ONLY` y los puertos lógicos 502, 4840 y 20000 en la respuesta de salud. Esa respuesta es una comprobación de la API, no una prueba de que el anfitrión tenga esos puertos publicados. Verifique que `docker compose ps` muestre `plant` y `trainer` como `healthy`, y `dnp3` y `suricata` como `running`.

Si necesita la comprobación integrada existente, ejecútela sin modificarla:

```bash
bash scripts/verify-lab.sh
```

No continúe si Docker muestra puertos industriales publicados o si el navegador se abre desde otro equipo.

### 2. Restablecer y observar la línea base visual

Use la acción existente **Restablecer laboratorio** o el endpoint local equivalente:

```bash
curl --noproxy '*' -fsS -X POST http://127.0.0.1:8080/api/scenario/reset
```

Abra `http://127.0.0.1:8080/` y espere `API CONECTADA`. Inmediatamente después del reset, el estado inicial del modelo es aproximadamente: nivel 48 %, bomba habilitada, setpoint 45 Hz, temperatura 29 °C, caudal 22,5 m³/h, semáforo virtual verde, cartel `OPERACIÓN` y protección simulada sin disparo. El proceso se actualiza cada segundo; anote el valor observado y la hora en vez de tratar estos valores como una medición física.

Registre una captura de la vista isométrica y de las tarjetas `TK-101`, `P-101`, `TT-201` y `FT-101`. Observe también:

- **Tráfico en vivo:** observaciones de aplicación que el servidor agrega al histórico.
- **Banda de eventos histórica:** eventos del gemelo, no un espejo de paquetes.
- **Riesgos y alertas:** puede combinar alertas analíticas del gemelo con líneas EVE de Suricata.
- **Inspección de protocolo:** los campos de trama del proxy son una ayuda didáctica de aplicación; no reemplazan el PCAP.

Una dirección IP, un nombre Docker o un `source` de evento no prueban por sí solos una identidad autorizada. La autorización debe provenir de controles de identidad, rol, canal, horario y cambio aprobado.

### 3. Generar únicamente lecturas FC03

El generador real del repositorio solo apunta a `plant:502`, limita `--count` a 1–30 y solicita siete registros desde la dirección PDU 0:

```bash
docker compose exec -T trainer python /lab/scripts/generate-traffic.py --count 5
```

La salida debe mostrar cinco lecturas. En el servidor, `LabContext` actualiza los valores del gemelo y emite un evento `FC03 lectura de 7 registros desde 0`. El proceso de baseline del trainer también puede producir lecturas cada 3 s mientras los contenedores están activos; por eso una captura puede contener más de cinco pares.

**No pulse Escritura Modbus, Escritura OPC UA, Señal DNP3 ni Proxy de trama** durante esta parte. FC06, `Write` OPC UA y `Direct Operate` DNP3 son comandos de escenarios, no parte de la lectura nominal.

### 4. Opcional: guardar un PCAP de FC03 puro

Este procedimiento limita el filtro a TCP/502 y guarda mediante el volumen `./pcaps:/captures`. No escucha interfaces del anfitrión:

```bash
set -u
PCAP="pcaps/01-baseline-fc03-$(date -u +%Y%m%dT%H%M%SZ).pcap"
docker compose exec -T plant timeout 12 tcpdump -i any -U -s 0 \
  -w "/captures/$(basename "$PCAP")" 'tcp port 502' >/dev/null 2>&1 &
CAPTURE_PID=$!
sleep 2
docker compose exec -T trainer python /lab/scripts/generate-traffic.py --count 5
CAPTURE_STATUS=0
wait "$CAPTURE_PID" || CAPTURE_STATUS=$?
test "$CAPTURE_STATUS" -eq 124
ls -lh "$PCAP"
```

El código `124` es el final normal de `timeout`. Si el archivo no existe o está vacío, conserve los logs y corrija el entorno; no redirija el cliente a otra IP. El resultado esperado es al menos una petición y respuesta por cada lectura generada. La relación solicitud/respuesta debe confirmarse por transaction ID, flujo TCP y tiempo, no solo por una línea del panel.

### 5. Captura reproducible de los tres protocolos por escenarios explícitos

Para obtener el PCAP de referencia del laboratorio, use el helper existente:

```bash
bash scripts/baseline-capture.sh
```

El script hace lo siguiente:

1. Restablece por API local.
2. Inicia `tcpdump` dentro de `plant` durante 22 s con el filtro `tcp port 502 or tcp port 4840 or tcp port 20000`.
3. Espera 4 s.
4. Activa en orden `modbus-write`, `opcua-write`, `dnp3-signal` e `intercept`, con 2 s entre llamadas.
5. Guarda `pcaps/ot-ics-labs-<UTC>.pcap` y comprueba que no esté vacío.

Este helper es útil para aprender a correlacionar varios protocolos, pero su salida **no es una línea base de normalidad**: contiene tráfico FC06 y comandos activados deliberadamente. En el informe marque cada segmento temporal con el escenario que lo produjo. No diga que OPC UA o DNP3 tienen una tasa periódica si solo hay un intercambio disparado por una acción.

Conserve el nombre, la hora UTC y un hash:

```bash
PCAP="$(ls -1t pcaps/ot-ics-labs-*.pcap | head -n 1)"
sha256sum "$PCAP" | tee "${PCAP}.sha256"
ls -lh "$PCAP" "${PCAP}.sha256"
```

### 6. Inspección con TShark

TShark aplica filtros de visualización con `-Y` y permite seleccionar campos con `-T fields -e ...` [15]. La referencia oficial de Wireshark documenta el campo `modbus` y sus campos de función, referencia, conteo y valores [14]. Sustituya `PCAP` por el archivo real:

```bash
PCAP="$(ls -1t pcaps/ot-ics-labs-*.pcap | head -n 1)"
tshark -r "$PCAP" -Y 'tcp.port == 502'
tshark -r "$PCAP" -Y 'modbus && modbus.func_code == 3'
tshark -r "$PCAP" -Y 'modbus && modbus.func_code == 6'
tshark -r "$PCAP" -Y 'tcp.port == 4840'
tshark -r "$PCAP" -Y 'tcp.port == 20000'
tshark -r "$PCAP" -Y 'tcp contains 05:64'
```

Para producir una tabla de trabajo:

```bash
tshark -r "$PCAP" -Y 'modbus' -T fields -E header=y -E separator=, \
  -e frame.number -e frame.time_relative -e ip.src -e ip.dst \
  -e tcp.srcport -e tcp.dstport -e modbus.func_code \
  -e modbus.reference_num -e modbus.word_cnt \
  > /tmp/01-baseline-modbus.csv
cat /tmp/01-baseline-modbus.csv
```

Si la versión local nombra un campo de otra manera, enumere los campos instalados y use el que corresponda; no convierta un campo ausente en una detección:

```bash
tshark -G fields | grep -iE 'modbus.*(func|function|reference|word|register)'
```

Para DNP3, pruebe primero el disector nativo. Si el puerto no se reconoce, fuerce el tipo como en `Decode As…`:

```bash
tshark -r "$PCAP" -d tcp.port==20000,dnp3 -Y 'tcp.port == 20000' \
  -T fields -e frame.number -e frame.time_relative -e ip.src -e ip.dst \
  -e tcp.srcport -e tcp.dstport
```

El preámbulo `05 64` es un indicio de inicio de trama DNP3 en el formato de enlace documentado por el DNP Users Group [5]. Contrástelo con el puerto y el flujo; un patrón de bytes aislado no basta para atribuir un comando. Si el disector no identifica DNP3, registre `DNP3 no decodificado; evidencia limitada a TCP/20000 y bytes 05 64`, no una conclusión más fuerte.

### 7. Inspección en Wireshark

Abra el PCAP local, no una interfaz de una red externa. Filtros iniciales:

```text
tcp.port == 502
tcp.port == 4840
tcp.port == 20000
modbus.func_code == 3
modbus.func_code == 6
tcp contains 05:64
```

En el primer flujo Modbus:

1. Identifique el cliente `trainer` y el servidor `plant` por la conversación, no por una IP supuestamente autorizada.
2. Abra la capa Modbus y localice función `03`, dirección inicial y cantidad. La especificación oficial establece que FC03 usa direcciones PDU desde cero y devuelve dos bytes por registro [1].
3. Relacione la respuesta con la petición mediante transaction ID/flujo TCP. Una respuesta FC03 no es una escritura.
4. Busque por separado `06`; el documento oficial define FC06 como `Write Single Register` y describe una respuesta que hace eco de la petición después de escribir [1]. En la práctica de línea base, un FC06 solo debe provenir de un escenario explícito.
5. En OPC UA use `tcp.port == 4840` como evidencia de transporte. No suponga una publicación periódica si no observa mensajes. Este endpoint de ensayo usa `SecurityPolicy None` deliberadamente; OPC Foundation indica que `None`, `Sign` y `SignAndEncrypt` son modos diferentes y que el perfil `None` debe estar deshabilitado por defecto [3].
6. En DNP3 use `Decode As… → TCP port 20000 → DNP3` si procede y contraste `05 64`. El DNP Users Group describe DNP3 como protocolo abierto de telecontrol con modelo master/outstation; la pila mínima del repositorio no es una implementación industrial general [4].

No use el panel como atajo para declarar qué bytes “están en el PCAP”. El panel agrega eventos de aplicación y el navegador recibe JSON; únicamente el archivo de captura permite afirmar que determinados bytes fueron observados por `tcpdump`.

### 8. Correlacionar las cuatro fuentes

Con el servicio activo, extraiga las fuentes separadamente:

```bash
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/state | python3 -m json.tool
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/events | python3 -m json.tool
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/traffic | python3 -m json.tool
curl --noproxy '*' -fsS http://127.0.0.1:8080/api/alerts | python3 -m json.tool
```

Construya una tabla con estas columnas:

| Hora UTC | Fuente | Origen | Destino | Protocolo/función | Finalidad prevista | Evidencia | ¿Qué desviación detectar? |
|---|---|---|---|---|---|---|---|
| timestamp del PCAP | PCAP/API/panel/EVE | `trainer` u observado | `plant:puerto` | FC03, FC06, OPC UA, DNP3 | lectura o escenario explícito | frame, evento o captura | fuente inesperada, frecuencia, función o valor |

Reglas de correlación:

- **PCAP:** prueba observación de paquetes en la interfaz capturada.
- **Eventos API:** prueban que la aplicación registró una observación; pueden contener `frame_before`/`frame_after` del proxy didáctico.
- **Panel 3D/SCADA:** prueba el estado que el gemelo expone a la interfaz; no prueba una medición física.
- **EVE JSON:** prueba una alerta de Suricata solo cuando contiene una alerta; la ausencia se registra como `sin evidencia IDS`.

Atribuya una anomalía solo después de cruzar al menos dos fuentes y de declarar qué fuente es primaria. No convierta una alerta analítica `OT-ANOMALY` en una firma Suricata.

## Relación con MITRE ATT&CK for ICS

En ATT&CK, una táctica expresa el **porqué** de una técnica desde la perspectiva del adversario; no convierte toda actividad de laboratorio en actividad adversaria [6]. La matriz ICS y las páginas de técnica son la autoridad para los identificadores actuales. Se usan aquí solo relaciones justificadas:

| Táctica | ID y técnica | Alcance en esta práctica | Evidencia / mitigación didáctica |
|---|---|---|---|
| Collection | **T0801 — Monitor Process State** | Relación técnica representada: FC03 lee holding registers del gemelo. La lectura la genera un cliente autorizado del laboratorio; no es una intrusión. | PCAP FC03 + evento + estado. Línea base de función/origen/frecuencia, correlación independiente y alertas ante lecturas fuera de patrón. MITRE menciona explícitamente lecturas de estado operacional como componente de detección [7]. |
| Discovery | **T0842 — Network Sniffing** | Analogía defensiva: `tcpdump`/Suricata observa una interfaz autorizada. No se afirma sniffing adversario ni visibilidad total. | PCAP y, si aplica, EVE. Controlar privilegios del sensor, segmentar, autorizar SPAN/TAP y proteger las capturas [8]. |
| Impair Process Control | **T0836 — Modify Parameter** | Solo representa el comportamiento inducido por `modbus-write`/`intercept` si el helper lo ejecutó. No pertenece al FC03 nominal. | FC06 y cambio de setpoint del gemelo. Autenticación, autorización, write protection, validación, auditoría y doble control [9]. |
| Impact | **T0831 — Manipulation of Control** | Solo representa un comando DNP3/OPC UA del escenario explícito y su efecto software. No es control de un proceso físico. | Frame/Write y cambio visual. Autenticidad del canal, autorización, validación fuera de banda y límites independientes [10]. |
| — | **Sin ID: proxy didáctico de una trama** | No asignar T0830. `intercept` envía una PDU editada a `plant:502`; no establece un adversary-in-the-middle transparente, no hace ARP spoofing y no altera el tráfico de terceros. | `frame_before`/`frame_after` solo documentan integridad de un mensaje de aula. T0830 requiere una condición AiTM con intercepción/alteración del flujo; se cita únicamente para explicar por qué no corresponde [11]. |

No se asigna una técnica de descubrimiento de sistemas a un mapa estático de arquitectura: el ejercicio no ejecuta un escaneo. Tampoco se atribuye un actor, campaña o malware. Los IDs anteriores describen una conducta técnica representada o una analogía defensiva, no una conclusión de compromiso.

## Mapeo conceptual IEC 62443

La serie ISA/IEC 62443 define requisitos y procesos para implementar y mantener sistemas de automatización y control seguros, y ofrece una forma de evaluar desempeño de seguridad [12]. Este laboratorio usa sus conceptos para razonar sobre zonas, conductos y requisitos fundamentales (FR); **no declara conformidad, SL-T/SL-C ni certificación**.

| Referencia conceptual | Aplicación y control a proponer |
|---|---|
| FR1 — Identification and Authentication Control | Inventariar `trainer`, `plant`, `dnp3` y navegador; reemplazar token de demostración por identidades, certificados, roles y autenticación apropiada. No tratar nombre Docker/IP como identidad. |
| FR2 — Use Control | Separar lectura FC03 de comandos; permitir operaciones por rol, destino, rango, horario y aprobación. `reset` es la acción didáctica permitida del catálogo. |
| FR3 — System Integrity | Validar función, registro, rango y estado; conservar hash del PCAP; correlacionar paquete, evento y visualización. La firma Suricata simplificada no prueba integridad de producción. |
| FR4 — Data Confidentiality | Reconocer que los flujos de ensayo no representan una arquitectura confidencial endurecida. Proponer cifrado donde sea viable y observar que OPC UA `NoSecurity` es intencionalmente débil. |
| FR5 — Restricted Data Flow | Tratar `control` como conducto de entrenamiento y `dashboard` como zona de visualización; mantener destinos fijos y puertos industriales sin publicar. Esto no es una DMZ industrial. |
| FR6 — Timely Response to Events | Medir tiempo entre frame, evento, cambio visual y EVE; establecer qué hacer cuando no hay firma y escribir `sin evidencia IDS` en lugar de inventar una detección. |
| FR7 — Resource Availability | Mantener capturas cortas, límites de comandos, healthchecks y recuperación por reset. No extrapolar disponibilidad de contenedores a un SIS o planta real. |

La arquitectura de zonas y conductos debe revisarse con análisis de riesgo y con los roles del propietario, integrador, proveedor y operador. La página oficial de ISA destaca ese principio de responsabilidad compartida [12].

## Contexto chileno: Ley 21.663

La Ley 21.663 aparece solo como contexto de gobernanza de ciberseguridad. La fuente oficial de BCN identifica la **Ley Marco de Ciberseguridad**, su promulgación/publicación y sus títulos sobre institucionalidad, obligaciones, agencia, incidentes, infracciones y otras materias [17]. Esta guía no determina si una organización, servicio o laboratorio está comprendido en la ley. No incluye plazos, multas, categorías obligatorias ni instrucciones de reporte: esos puntos deben verificarse directamente en la versión oficial vigente y con asesoría competente antes de usarlos en un caso real.

## Evidencias y entregable

Entregue una carpeta de análisis con:

1. `PCAP` original y su `sha256`.
2. Tabla CSV/Markdown de al menos cinco paquetes relevantes, indicando dirección, función/protocolo, finalidad y señal de desviación.
3. Una captura de la vista SCADA/3D inmediatamente después de reset.
4. Salidas de TShark para FC03 y, si usó el helper completo, para FC06, OPC UA y DNP3.
5. Exportación de eventos/alertas con la hora y la fuente, separando `engine: Suricata` de alertas analíticas.
6. Diagrama o tabla de nodos, zonas y conductos.
7. Párrafo de límites: gemelo software; sin PLC/SIS físico; proxy no transparente; panel no es PCAP; OPC/DNP solo por escenario explícito; sin evidencia IDS cuando corresponda.

### Criterio de éxito

La práctica se considera lograda cuando el alumno:

- identifica cinco o más paquetes relevantes y al menos un par solicitud/respuesta FC03;
- distingue FC03 de FC06 usando la especificación y el disector, no solo el texto de la interfaz;
- describe que la captura completa contiene escenarios explícitos y no tráfico periódico inventado;
- correlaciona PCAP con una fuente de aplicación y una visual, sin atribuir bytes del navegador al PCAP;
- propone FR1–FR7 como controles conceptuales sin reivindicar certificación;
- usa IDs MITRE existentes, explica su alcance y deja la analogía sin ID cuando corresponde;
- registra `sin evidencia IDS` si no hay una línea EVE de alerta.

## Antipatrones que invalidan el informe

- Capturar una interfaz del anfitrión o publicar puertos industriales “para que funcione”.
- Cambiar `plant` por una IP o hostname externo, agregar parámetros de destino o reutilizar el cliente fuera del laboratorio.
- Llamar “normal” al PCAP completo de `baseline-capture.sh` sin marcar los cuatro escenarios.
- Afirmar tráfico periódico OPC UA/DNP3 sin contar frames observados.
- Llamar FC03 una escritura FC06, o llamar lectura a una acción del botón de escenario.
- Inferir identidad autorizada desde IP, nombre Docker o dirección de origen del evento.
- Llamar MITM transparente al proxy fijo `intercept`.
- Presentar `NoSecurity`, token demo, regla Suricata simple o control software como defensa de producción.
- Presentar una lectura legítima, un estado visual o una alerta analítica como intrusión confirmada.
- Atribuir al PCAP los bytes de una trama que solo aparece en el panel.
- Usar la Ley 21.663 para deducir plazos o sanciones sin comprobar la fuente legal vigente.

## Referencias oficiales

[1]: https://www.modbus.org/file/secure/modbusprotocolspecification.pdf "MODBUS Application Protocol Specification V1.1b3"
[2]: https://www.modbus.org/modbus-specifications "Modbus Protocol Specifications and Implementation Guides"
[3]: https://reference.opcfoundation.org/specs/OPC-10000-2/4.8 "OPC UA Part 2, Security Mode settings"
[4]: https://www.dnp.org/About/Overview-of-DNP3-Protocol "DNP Users Group, Overview of DNP3 Protocol"
[5]: https://www.dnp.org/Portals/0/AboutUs/DNP3%20Primer%20Rev%20A.pdf "DNP Users Group, A DNP3 Protocol Primer"
[6]: https://attack.mitre.org/matrices/ics/ "MITRE ATT&CK for ICS Matrix"
[7]: https://attack.mitre.org/techniques/T0801/ "MITRE ATT&CK for ICS T0801 Monitor Process State"
[8]: https://attack.mitre.org/techniques/T0842/ "MITRE ATT&CK for ICS T0842 Network Sniffing"
[9]: https://attack.mitre.org/techniques/T0836/ "MITRE ATT&CK for ICS T0836 Modify Parameter"
[10]: https://attack.mitre.org/techniques/T0831/ "MITRE ATT&CK for ICS T0831 Manipulation of Control"
[11]: https://attack.mitre.org/techniques/T0830/ "MITRE ATT&CK for ICS T0830 Adversary-in-the-Middle"
[12]: https://www.isa.org/standards-and-publications/isa-standards/isa-iec-62443-series-of-standards "ISA/IEC 62443 Series of Standards"
[13]: https://csrc.nist.gov/pubs/sp/800/82/r3/final "NIST SP 800-82 Rev. 3, Guide to Operational Technology Security"
[14]: https://www.wireshark.org/docs/dfref/m/modbus.html "Wireshark Display Filter Reference: Modbus"
[15]: https://www.wireshark.org/docs/man-pages/tshark.html "TShark manual page"
[16]: https://docs.suricata.io/en/latest/rules/modbus-keyword.html "Suricata Modbus keyword"
[17]: https://www.bcn.cl/leychile/navegar?idNorma=1202434 "Biblioteca del Congreso Nacional, Ley 21.663 Ley Marco de Ciberseguridad"
