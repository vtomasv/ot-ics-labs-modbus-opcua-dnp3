# Ejercicio 4 — Control DNP3 de señal

**Duración:** 45 minutos · **Nivel:** técnico-didáctico OT · **Acciones permitidas:** `dnp3-signal`, `reset`.

> **Aislamiento y uso legal obligatorio.** Este ejercicio se ejecuta exclusivamente en el repositorio y en la red Docker interna de la maqueta. No lo conecte a una red OT, PLC, RTU, SIS, semáforo público ni equipo de terceros. No publique `502/TCP`, `4840/TCP` ni `20000/TCP`, no cambie el destino fijo `plant:20000` y no use el ejercicio para interferir con sistemas ajenos. Es material educativo y defensivo; cualquier uso fuera de un entorno autorizado puede ser ilegal y peligroso.

## Objetivo

Demostrar, con evidencias reproducibles, una operación DNP3/TCP de control de una señal virtual y diferenciar:

- la **técnica representada**: una orden DNP3 cambia el punto del gemelo digital;
- la **observación**: PCAP, respuesta/readback del master, estado de API, vista SCADA/3D y eventos son fuentes distintas;
- la **interpretación**: una trama DNP3 o el preámbulo `05 64` no prueban por sí solos un ataque.

El resultado esperado es `traffic_signal=0` y semáforo virtual rojo después de `dnp3-signal`, seguido de una lectura DNP3 de retorno igual a 0. La maqueta es **software/3D**: no hay PLC físico, RTU físico, actuador ni SIS. El proxy Modbus de otro ejercicio no es proxy transparente/MITM y no forma parte de esta práctica.

## Prerrequisitos

1. Docker Engine y Docker Compose v2.
2. `tshark` o Wireshark en el anfitrión; `tcpdump` está disponible en `plant`.
3. Repositorio iniciado desde su raíz y sin puertos industriales publicados.
4. Dos capturas de pantalla: estado nominal verde y estado rojo.
5. Leer la [guía completa de este laboratorio](../docs/labs/04-dnp3.md) antes de comenzar.

## Procedimiento

### 1. Arranque, aislamiento y reset

```bash
docker compose config --quiet
docker compose up -d
bash scripts/verify-lab.sh
docker compose ps
```

Abra `http://127.0.0.1:8080/` solo en el mismo anfitrión. Pulse **Restablecer laboratorio** o ejecute:

```bash
docker compose exec -T plant python -c 'import urllib.request; r=urllib.request.Request("http://127.0.0.1:8000/api/scenario/reset", method="POST"); print(urllib.request.urlopen(r).read().decode())'
docker compose exec -T plant python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/api/state").read().decode())'
```

Registre la línea base (`traffic_signal=2`, normalmente verde) y tome la primera captura. `reset` es una acción de API; no lo describa como DNP3.

### 2. Lectura DNP3 inicial

```bash
docker compose exec -T trainer python /lab/dnp3/native_master.py observe
```

Conserve la salida JSON. La lectura del analog input índice 0 debe corresponder a la señal verde en línea base. No la llame “tráfico DNP3 periódico”: el `trainer` genera FC03 Modbus de línea base para otro ejercicio; esta lectura DNP3 es puntual.

### 3. Control de señal

Ejecute **Señal DNP3** en la consola o el cliente fijo:

```bash
docker compose exec -T trainer python /lab/dnp3/native_master.py signal 0
```

Compruebe que la salida incluye `status=VERIFIED_BY_DNP3_READBACK` y valores solicitado/observado iguales a 0. El cliente usa exclusivamente `plant:20000`, valida la respuesta y lee de nuevo el punto. La implementación mínima representa una operación de salida analógica Group 41 Variation 1, índice 0, y una lectura Group 30 Variation 1.

### 4. Vista SCADA/3D y correlación

Observe el semáforo virtual rojo y el evento DNP3 en el panel. Obtenga el estado de aplicación:

```bash
docker compose exec -T plant python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/api/state").read().decode())'
```

No atribuya el JSON del navegador a un byte del PCAP. La API y la UI son observaciones del gemelo; la transacción DNP3 es entre `trainer` y el outstation en Docker.

### 5. PCAP enfocado y tshark

En una terminal, capture solo TCP/20000 mientras ejecuta el control en otra terminal:

```bash
docker compose exec -T plant timeout 12 tcpdump -i any -U -s 0 -w /captures/04-dnp3.pcap 'tcp port 20000' >/dev/null 2>&1 &
CAP_PID=$!
sleep 2
docker compose exec -T trainer python /lab/dnp3/native_master.py signal 0
wait "$CAP_PID" || test "$?" -eq 124
sha256sum pcaps/04-dnp3.pcap
```

Analice únicamente lo que exista en el archivo:

```bash
capinfos pcaps/04-dnp3.pcap
tshark -r pcaps/04-dnp3.pcap -Y 'tcp.port == 20000' \
  -T fields -e frame.number -e frame.time_relative -e ip.src -e ip.dst \
  -e tcp.stream -e tcp.len -e tcp.flags -e data.data

tshark -r pcaps/04-dnp3.pcap -Y 'dnp3' -V | sed -n '1,240p'
```

Si su tshark no reconoce el filtro `dnp3`, use `tcp.port == 20000`, `tcp.len > 0` e inspección hexadecimal. Identifique handshake, dirección del master, solicitud, respuesta y lectura de retorno. El `05 64` es un indicio de inicio de trama DNP3; no demuestra control ni malicia sin correlación.

`bash scripts/baseline-capture.sh` puede usarse como evidencia adicional, pero lanza también escenarios Modbus, OPC UA y proxy. Si se usa, indique que FC03 es Modbus y que no existe una afirmación de tráfico periódico OPC/DNP.

### 6. Tabla de evidencia

Complete sin inventar timestamps ni bytes:

| Hora UTC | Origen | Función/objeto | Solicitado | Observado | Estado virtual | Evidencia independiente |
|---|---|---|---:|---:|---|---|
| `<salida/evento>` | `trainer/master` | Direct Operate AO G41V1 índice 0 | 0 | 0 por readback G30V1 | Rojo | PCAP + JSON del master |
| `<api/state>` | `plant/gemelo` | Estado de aplicación, no función DNP3 | — | `traffic_signal=0` | Rojo | JSON + captura SCADA/3D |

Incluya el hash del PCAP y la versión de tshark/Wireshark. Al menos una evidencia debe ser independiente del navegador.

### 7. Mapeo

#### MITRE ATT&CK for ICS

Mapee únicamente lo que puede demostrar:

| Evidencia | Técnica/táctica | Justificación | Límite de la afirmación |
|---|---|---|---|
| Orden DNP3 AO índice 0, respuesta válida, readback 0 y `traffic_signal=0` | **T0831 — Manipulation of Control**, **Impact** | MITRE describe la manipulación de control de procesos. El laboratorio representa benignamente una orden autorizada que cambia una señal del gemelo. | No demuestra intrusión, intención adversaria, campaña, acceso no autorizado ni manipulación de un equipo real. |
| Una sola orden y una lectura | **No asignar T0806** | T0806 — Brute Force I/O exige cambios repetitivos o sucesivos; esta práctica no los ejecuta. | No llamar “brute force” a una escritura única. |

La relación T0831 es una relación de **conducta representada**, no una alerta automática ni una atribución. La autenticidad de comunicaciones y la validación fuera de banda son líneas de mitigación para estudiar; esta maqueta no implementa DNP3 Secure Authentication. Una alerta del panel o EVE JSON tampoco reemplaza al PCAP.

#### IEC 62443 (mapeo conceptual)

| FR | Aplicación didáctica | Control que propondrías en producción | Limitación |
|---|---|---|---|
| **FR2 — Use control** | Acción cerrada `dnp3-signal`, rango cerrado y destino fijo. | Identidad fuerte, rol mínimo, aprobación de escritura, allowlist de puntos y registro. | Token de demostración y botón local no son IAM de producción. |
| **FR3 — System integrity** | Respuesta y readback DNP3 se validan y se comparan con el estado del gemelo. | Autenticidad criptográfica, control de cambios, configuración protegida y verificación independiente. | CRC detecta errores; no es autenticación. Readback no garantiza seguridad física. |
| **FR5 — Restricted data flow** | Red `control` `internal: true`; 20000/TCP no se publica; ruta fija `trainer→plant:20000`. | Zonas/conductos, firewall y allowlist, separación de administración y egress controlado. | Un bridge Docker no es una DMZ ni una segmentación física IEC 62443. |
| **FR6 — Timely response to events** | Correlación de evento, PCAP, readback, estado y captura visual. | Monitorización contextual, playbook, responsables, retención y validación fuera de banda. | No hay SLA ni respuesta de incidente real. |

Este mapeo no declara Security Level, conformidad ni certificación.

### 8. Entrega y rúbrica

Entrega un único informe o carpeta de evidencias con:

- PCAP enfocado `pcaps/04-dnp3.pcap` (o extracto con comando y hash), filtro tshark y versión de la herramienta;
- JSON del master con readback, JSON de estado y tabla de correlación;
- dos capturas de la vista 3D/SCADA: verde antes y rojo después;
- matriz MITRE/IEC con URLs oficiales y límites;
- lista de antipatrones encontrados y una contención que preserve supervisión y valide el punto antes de reabrir la vía.

| Criterio | Puntos | Evidencia mínima |
|---|---:|---|
| Aislamiento, uso legal y destinos fijos | 15 | Compose local, sin puertos industriales publicados, acciones solo `dnp3-signal`/`reset`. |
| Precisión DNP3 y resultado | 25 | TCP/20000, solicitud/respuesta, AO G41V1 índice 0, readback G30V1=0, `traffic_signal=0`. |
| PCAP/tshark reproducible | 20 | Archivo/hash, filtro, stream/direcciones y separación del handshake/payload. |
| Correlación SCADA/3D y fuentes | 15 | Capturas verde/rojo, estado API, master y evidencia independiente. |
| MITRE justificado | 10 | T0831 acotado; no T0806 ni otros IDs sin evidencia. |
| IEC 62443 y contención | 10 | FR2/FR3/FR5/FR6 conceptuales, sin certificación, propuesta segura. |
| Antipatrones y límites | 5 | No PLC/SIS, no MITM transparente, no bytes del navegador en PCAP, no Secure Authentication. |
| **Total** | **100** | **Aprobación recomendada: 70; cualquier conexión a un activo real invalida el ejercicio.** |

### 9. Contexto chileno

La [Ley 21.663 en LeyChile/BCN](https://www.bcn.cl/leychile/navegar?idNorma=1202434) es la Ley Marco de Ciberseguridad y ofrece contexto para considerar gobernanza, obligaciones e infraestructura crítica. En este ejercicio solo se pide citarla como contexto: no determines sujetos obligados, plazos, multas o cumplimiento legal. Revisa el texto oficial vigente y consulta a la autoridad o asesoría competente.

### 10. Antipatrones

Marca en tu informe cuáles evitaste:

1. Publicar `20000/TCP`, cambiar `plant:20000` por una IP o ejecutar contra una RTU/PLC.
2. Describir el navegador como master DNP3 o afirmar que sus bytes HTTP están en el PCAP.
3. Concluir “ataque” por `05 64`, una escritura autorizada, una alerta heurística o un ID ATT&CK.
4. Llamar DNP3 periódico a FC03 Modbus o inventar tráfico OPC/DNP no ejecutado.
5. Llamar transparente/MITM/ARP spoofing al proxy Modbus de otro laboratorio.
6. Presentar la maqueta como PLC, RTU, semáforo físico o SIS, o el CRC como autenticación.
7. Reclamar certificación o Security Level IEC 62443.

### 11. Solución orientativa (leer después de entregar)

<details>
<summary>Mostrar solución y criterios de corrección</summary>

La secuencia correcta es:

1. `docker compose config --quiet`, `docker compose up -d`, `bash scripts/verify-lab.sh`.
2. Ejecutar `reset`, confirmar `traffic_signal=2` y guardar captura verde.
3. Ejecutar `docker compose exec -T trainer python /lab/dnp3/native_master.py observe` y registrar el punto inicial.
4. Capturar `tcp port 20000` en `plant` y ejecutar una sola vez `docker compose exec -T trainer python /lab/dnp3/native_master.py signal 0`.
5. Conservar la salida `VERIFIED_BY_DNP3_READBACK`, confirmar `traffic_signal=0` por `/api/state`, guardar captura roja y calcular hash del PCAP.
6. Con tshark, distinguir handshake TCP, payload master→outstation y respuestas; identificar `05 64` como preámbulo cuando esté en los bytes capturados, sin usarlo como prueba única.
7. Mapear la conducta a **T0831 / Impact** como representación autorizada. Explicar que no se asigna T0806 porque no hay cambios repetidos. Mapear FR2/FR3/FR5/FR6 como diseño conceptual y declarar que no hay certificación.
8. Proponer allowlist del conducto, revisión de logs, preservación de evidencia, validación independiente del punto y reapertura aprobada; no proponer escaneo o conexión a activos reales.
9. Ejecutar `reset` al cerrar y conservar el PCAP; no usar `docker compose down -v` si se necesitan volúmenes de evidencia.

Una respuesta completa no presenta bytes hexadecimales que no aparezcan en el PCAP. Puede explicar que el código del master construye DNP3 con preámbulo, CRC por bloques, control de Group 41 Variation 1 y lectura Group 30 Variation 1, pero debe separar esa **representación del código** de la **observación de red**. Asimismo, el semáforo rojo es `traffic_signal=0` del gemelo, no la lectura de un semáforo físico.

</details>

### 12. Referencias y límites

- [MITRE ATT&CK for ICS T0831](https://attack.mitre.org/techniques/T0831/) — Manipulation of Control.
- [MITRE ATT&CK for ICS T0806](https://attack.mitre.org/techniques/T0806/) — Brute Force I/O, consultado para no sobreasignar la técnica.
- [DNP Users Group — Overview of DNP3](https://www.dnp.org/About/Overview-of-DNP3-Protocol) y [DNP3 Primer](https://www.dnp.org/Portals/0/AboutUs/DNP3%20Primer%20Rev%20A.pdf).
- [OpenDNP3 — ICommandHandler y salidas analógicas](https://dnp3.github.io/docs/cpp/3.1.0/d5/d04/namespaceopendnp3.html).
- [IEC 62443 — IEC SyC Smart Energy](https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/).
- [Ley chilena 21.663 — LeyChile/BCN](https://www.bcn.cl/leychile/navegar?idNorma=1202434).
- [NIST SP 800-82 Rev. 3](https://csrc.nist.gov/pubs/sp/800/82/r3/final) para el contexto de seguridad OT.

Límites que deben aparecer en el informe: maqueta software/3D sin PLC/RTU/SIS; DNP3 Secure Authentication ausente; master/outstation mínimos; CRC no criptográfico; proxy Modbus no transparente; UI/API/logs/Suricata distintos del PCAP; `baseline-capture.sh` mezcla escenarios; relación MITRE de conducta representada; mapeo IEC conceptual; Ley 21.663 solo contexto; destinos Docker fijos y acciones permitidas únicamente `dnp3-signal` y `reset`.
No ejecute `bash scripts/baseline-capture.sh` en este ejercicio: documenta una captura multi-protocolo y lanza escenarios de otros laboratorios. Solo consulte su contenido para explicar que FC03 es Modbus y que no existe una afirmación de tráfico periódico OPC/DNP.
