# Laboratorio 03 — Integridad OPC UA

- **Duración orientativa:** 45 minutos
- **Protocolo:** OPC UA sobre TCP/4840
- **Identificador de catálogo:** `03-opcua`
- **Tema:** escritura de un parámetro de proceso, integridad del canal y modelo de confianza

> **Aislamiento y uso legal obligatorios.** Este laboratorio es exclusivamente educativo y defensivo. Ejecútelo en el repositorio clonado, con Docker, sin conectarlo a una red OT/ICS real, PLC, RTU, SIS, sensores, actuadores o equipos de terceros. No publique `4840/TCP`, `502/TCP` ni `20000/TCP`, no cambie los destinos fijos y no pruebe el escenario fuera de un entorno autorizado. Las acciones de este laboratorio son únicamente `opcua-write` y `reset`. El material no autoriza pruebas, escaneo o escritura contra sistemas ajenos.

## 1. Propósito y resultado esperado

La práctica muestra un cambio controlado de parámetro en una implementación didáctica: el contenedor `trainer` abre un cliente OPC UA real con `asyncua`, se conecta a `opc.tcp://plant:4840/ot-lab/`, localiza el namespace `urn:ot-ics-labs:planta` y escribe el nodo `Planta/SpeedSetpoint` con valor entero `75`. El servidor del contenedor `plant` aplica el valor al gemelo digital y el panel muestra una velocidad fuera del nominal de la maqueta (`<=60 Hz`).

El objetivo **no** es afirmar que se atacó una planta, que el navegador generó el protocolo industrial o que una pantalla es prueba suficiente. El alumno debe triangular, al menos, estas fuentes:

1. **Transacción técnica:** cliente `trainer` → servidor `plant`, OPC UA/TCP `4840`.
2. **Estado de proceso:** `GET /api/state` y vista SCADA/3D que lee el gemelo.
3. **Observación de aplicación:** `/api/events` y, si corresponde, registros EVE de Suricata.
4. **Evidencia de red:** PCAP de la interfaz del namespace de `plant`, analizado con `tshark` o Wireshark.

OPC UA tiene servicios de escritura definidos por el estándar; la especificación describe que los atributos de una Variable pueden leerse y escribirse mediante los servicios de atributos ([OPC UA Part 4, §4.1](https://reference.opcfoundation.org/specs/OPC-10000-4/4)). Esta maqueta, sin embargo, deja el endpoint con `SecurityPolicy None` y marca el setpoint como escribible para que se pueda observar una configuración débil. **No es un diseño de producción.**

## 2. Modelo técnico de la maqueta

```text
Navegador anfitrión (127.0.0.1:8080)
        │ HTTP/JSON: activa escenario y lee API; no OPC UA
        ▼
[plant:8000 API + gemelo + servidor OPC UA:4840]
        ▲                         │
        │ OPC UA/TCP 4840         │ captura pasiva del namespace
        │                         ▼
[trainer: cliente OPC UA]      [suricata: EVE JSON]
```

| Nodo | Rol real en este laboratorio | Zona representada | Qué no debe inferirse |
|---|---|---|---|
| Navegador / consola | HTTP/JSON, estado, eventos y visualización 3D | `dashboard`, publicado solo en loopback | No es el cliente OPC UA y sus bytes HTTP no son bytes de 4840 |
| `trainer` | Cliente OPC UA del escenario; también genera FC03 de línea base | `control`, red Docker `internal` | No es una estación de ingeniería de producción |
| `plant` | API, servidor OPC UA, proceso software y estado del gemelo | `control` | No es PLC, RTU, SIS ni proceso físico |
| `suricata` | Sensor pasivo en el namespace de `plant`; almacena EVE JSON | `control` | No es un espejo completo ni una autoridad de atribución |

El puente entre `dashboard` y `control` es una decisión didáctica y **no** una DMZ industrial. Los puertos industriales no se publican al anfitrión. `trainer` usa el nombre fijo `plant`; no admite que el navegador elija otro destino.

### Maqueta 3D y límites físicos

La vista Three.js representa un gemelo de nivel, caudal, temperatura, bomba, cartel y semáforo. No hay hardware: la función de proceso y el “trip” de seguridad están implementados en software. No hay un PLC físico, un SIS, firmware, sensores, válvulas, relés ni una función de seguridad instrumentada certificada. Un cambio de color, una alarma o un valor de la consola solo demuestran el estado del modelo que entrega la API.

## 3. Prerrequisitos y arranque

En el repositorio:

```bash
docker compose version
docker compose up -d --build
docker compose ps
docker compose exec -T trainer python /lab/scripts/health.py trainer
curl --noproxy '*' -fsS http://127.0.0.1:${DASHBOARD_PORT:-8080}/api/health
```

Se espera que `plant` y `trainer` estén saludables. Abra `http://127.0.0.1:${DASHBOARD_PORT:-8080}/` en el mismo anfitrión. El panel está destinado a la observación; si no puede cargarlo, use los comandos Docker y las rutas API internas, no publique el puerto en `0.0.0.0`.

Para esta práctica no es necesario ejecutar una verificación que dispare todos los escenarios del repositorio. No se debe activar `modbus-write`, `dnp3-signal` ni `intercept`: están fuera del alcance de `03-opcua`.

## 4. Paso a paso

### Paso 0 — Restablecer antes de medir

Pulse **Restablecer laboratorio** en la consola o ejecute la acción local siguiente:

```bash
docker compose exec -T plant python -c "import urllib.request; r=urllib.request.Request('http://127.0.0.1:8000/api/scenario/reset', method='POST'); print(urllib.request.urlopen(r, timeout=10).read().decode())"
```

Registre una captura de la vista nominal y el estado de velocidad. `reset` reinicia el estado simulado y refresca el contexto; **no** borra eventos históricos, PCAP ni volúmenes de evidencia.

### Paso 1 — Observar una línea base sin inventar protocolos

La tarea de línea base del `trainer` ejecuta lecturas Modbus FC03 cada tres segundos; el script explícito también permite generar cinco lecturas controladas:

```bash
docker compose exec -T trainer python /lab/scripts/generate-traffic.py --count 5
```

FC03 es una lectura de registros de mantenimiento/estado en este laboratorio. Sirve para entender el contraste entre tráfico periódico y el evento OPC UA puntual. **No se debe describir tráfico periódico OPC UA o DNP3 que no se haya observado.** El servidor OPC UA actualiza internamente variables del gemelo, pero eso no equivale a inventar una secuencia de solicitudes de un cliente por la red.

Anote:

- la dirección lógica fija `trainer` → `plant`;
- que el cliente de la consola solo habla HTTP/JSON con la API;
- la diferencia entre un registro de aplicación y un paquete capturado.

### Paso 2 — Ejecutar la escritura OPC UA

En la consola, pulse **Escritura OPC UA**, o use la misma API desde un contenedor, sin introducir destinos ni parámetros:

```bash
docker compose exec -T plant python -c "import urllib.request; r=urllib.request.Request('http://127.0.0.1:8000/api/scenario/opcua-write', method='POST'); print(urllib.request.urlopen(r, timeout=20).read().decode())"
```

La secuencia real del operador es, resumidamente:

1. crear un `Client` para `opc.tcp://plant:4840/ot-lab/`;
2. obtener el índice del namespace `urn:ot-ics-labs:planta`;
3. buscar `Planta/SpeedSetpoint`;
4. ejecutar `Write` con `75` como `Int64`;
5. observar el callback del servidor y actualizar el gemelo.

Compruebe el estado por API:

```bash
curl --noproxy '*' -fsS http://127.0.0.1:${DASHBOARD_PORT:-8080}/api/state
curl --noproxy '*' -fsS http://127.0.0.1:${DASHBOARD_PORT:-8080}/api/events
```

La respuesta debe permitir localizar `speed_setpoint: 75` y un evento de OPC UA semejante a “cliente → servidor / Write Planta/SpeedSetpoint = 75”. La redacción exacta del timestamp y del evento puede variar.

En la vista SCADA/3D registre:

- velocidad antes y después;
- indicador de atención por estar sobre el nominal de la maqueta;
- nivel, temperatura y caudal, sin atribuirlos a sensores físicos;
- hora de la observación y origen de cada captura.

### Paso 3 — Capturar el PCAP del conducto interno

La captura debe ejecutarse en el contenedor `plant`, no en la interfaz del anfitrión. Abra una terminal A y déjela correr:

```bash
docker compose exec -T plant timeout 20 tcpdump -i any -U -s 0 -w /captures/03-opcua.pcap 'tcp port 4840'
```

Mientras la terminal A captura, en una terminal B ejecute una sola vez la acción permitida:

```bash
docker compose exec -T plant python -c "import urllib.request; r=urllib.request.Request('http://127.0.0.1:8000/api/scenario/opcua-write', method='POST'); print(urllib.request.urlopen(r, timeout=20).read().decode())"
```

La ruta `/captures/03-opcua.pcap` del contenedor está montada como `pcaps/03-opcua.pcap` en el repositorio. Verifique sin abrir otros destinos:

```bash
test -s pcaps/03-opcua.pcap
ls -lh pcaps/03-opcua.pcap
```

El filtro solo solicita TCP/4840 en el namespace visible a `plant`. La captura no ve una red OT externa, no es SPAN/TAP industrial y no prueba por sí sola quién autorizó una escritura.

### Paso 4 — Analizar con tshark

Si `tshark` está instalado en el anfitrión:

```bash
PCAP=pcaps/03-opcua.pcap
tshark -r "$PCAP" -Y 'tcp.port == 4840' \
  -T fields -E header=y -E separator=, \
  -e frame.number -e frame.time -e ip.src -e ip.dst \
  -e tcp.srcport -e tcp.dstport -e frame.len -e _ws.col.Info
```

Si la versión incluye disector OPC UA, pruebe además:

```bash
tshark -r pcaps/03-opcua.pcap -Y 'opcua' \
  -T fields -E header=y -E separator=, \
  -e frame.number -e frame.time -e ip.src -e ip.dst \
  -e tcp.srcport -e tcp.dstport -e _ws.col.Info
```

Si el segundo filtro no devuelve filas o la columna `Info` no identifica un servicio, conserve el resultado de `tcp.port == 4840` y documente la limitación del disector. No adivine un `WriteRequest`, un NodeId binario o una identidad a partir de una columna vacía. El estándar define el servicio, pero la capacidad del disector y la segmentación de una captura determinan qué campos se pueden leer.

Busque al menos:

- extremos correspondientes a `trainer` y `plant`;
- apertura/establecimiento de TCP y el flujo de aplicación posterior;
- duración, número de frames y tamaños;
- coincidencia temporal aproximada con el evento de `/api/events`.

No es requisito que un PCAP de una sola ejecución sea idéntico al PCAP de referencia. La versión de Docker, librerías, resolución de nombres y disector pueden cambiarlo.

### Paso 5 — Separar la acción, la observación y la atribución

| Evidencia | Demuestra | No demuestra |
|---|---|---|
| Código/resultado del escenario | Que el operador didáctico hizo que `trainer` llamara al cliente OPC UA y que este intentó el Write | Que un adversario actuó o que el canal tenía autenticación fuerte |
| PCAP filtrado a 4840 | Que hubo tráfico TCP del conducto observado, si la captura lo contiene | Que el navegador generó los bytes, ni que el tráfico sea visible fuera del namespace |
| `/api/state` | Estado actual del gemelo, incluido `75` Hz | Un valor de un sensor físico o una medición de campo independiente |
| `/api/events` | Registro de aplicación emitido por `plant`/operador | Un espejo completo de paquetes o una prueba criptográfica de identidad |
| Vista SCADA/3D | Representación visual del estado que entrega la API | PLC, SIS, actuador o respuesta humana real |
| EVE de Suricata | Una alerta o evento que el sensor haya registrado | Que la ausencia de alerta implique ausencia de ataque; no hay firma OPC UA general en esta práctica |

La petición del navegador a `127.0.0.1:8080` llega a la API publicada solo en loopback. La API solicita al `trainer` el escenario; el `trainer` es quien abre el canal OPC UA a `plant:4840`. Por ello, **no atribuya bytes del navegador a un PCAP OPC UA**. El panel “Tráfico en vivo” muestra observaciones de aplicación y no pretende sustituir Wireshark/tshark.

### Paso 6 — Restablecer al terminar

```bash
docker compose exec -T plant python -c "import urllib.request; r=urllib.request.Request('http://127.0.0.1:8000/api/scenario/reset', method='POST'); print(urllib.request.urlopen(r, timeout=10).read().decode())"
```

Guarde la ficha, el PCAP y las salidas de `tshark` antes de apagar. La finalización ordinaria es:

```bash
docker compose down
```

No use `docker compose down -v` si necesita conservar volúmenes de evidencia.

## 5. Análisis de integridad OPC UA

### 5.1 Qué significa `SecurityPolicy None` aquí

La [OPC UA Part 2: Security Model, §4](https://reference.opcfoundation.org/specs/OPC-10000-2/4) separa varios elementos que deben analizarse juntos:

- Una **SecurityPolicy** define mecanismos y algoritmos de firma, cifrado y derivación de claves.
- Los modos de seguridad incluyen `None`, `Sign` y `SignAndEncrypt`.
- `None` solo se usa con el perfil `None`; el perfil `None` está destinado a pruebas y la especificación indica que, si hay perfiles más seguros, se deshabilita por defecto.
- `Sign` aporta autenticidad/integridad del mensaje según la política y el contexto, pero no confidencialidad.
- `SignAndEncrypt` agrega confidencialidad al canal además de proteger la integridad/autenticidad criptográfica.
- La autenticación de aplicación usa un certificado de `ApplicationInstance`; el receptor comprueba confianza mediante una **TrustList** administrada. Una CA y sus listas de revocación pueden formar parte del almacén de confianza.
- La autenticación del usuario se trata durante la sesión; no es lo mismo que autenticación de la aplicación.
- La autorización determina qué puede hacer una identidad autenticada. OPC UA contempla roles y permisos que pueden aplicarse a nodos o namespaces.

En esta maqueta, `plant` anuncia deliberadamente `NoSecurity`, no carga un despliegue productivo de certificados y permite la variable escribible para que el alumno vea la diferencia. Por tanto, “OPC UA es inseguro” es una conclusión incorrecta: la afirmación válida es “**este endpoint de laboratorio está configurado con None**”.

### 5.2 Qué autorizar en un despliegue objetivo

La [OPC UA Part 18: Role Model](https://reference.opcfoundation.org/specs/OPC-10000-18/4) describe la separación entre autenticación y autorización: se asignan permisos a roles para cada nodo y una sesión recibe roles según la información de identidad. La [Part 2, §4.12](https://reference.opcfoundation.org/specs/OPC-10000-2/4) enumera roles conocidos como `Observer`, `Operator`, `Engineer` y `Supervisor`, entre otros.

Una política de ingeniería razonable, que el alumno debe expresar como diseño y no como funcionalidad ya implementada, sería:

1. **Supervisión:** `Observer`/`Operator` con lectura y suscripción, sin `CurrentWrite` en `Planta/SpeedSetpoint`.
2. **Ingeniería:** rol `Engineer` solo mediante identidad de usuario y certificado de aplicación confiable, con permiso de Write en el nodo exacto, ventana de cambio, ticket y rango aprobado.
3. **Administración:** cambios de TrustList, roles y endpoints reservados a `SecurityAdmin`/administradores por canal cifrado y doble control.
4. **Servidor:** rechazar clientes no confiables, endpoints `None` y operaciones fuera de rango; validar precondiciones del proceso, no solo el tipo `Int64`.
5. **Auditoría:** registrar identidad de aplicación, usuario, NodeId/BrowsePath, valor anterior/nuevo, resultado, timestamp y aprobación; correlacionar con estado independiente.
6. **Red:** permitir el conducto mínimo entre estación de supervisión/ingeniería y servidor, sin elevar toda la red al nivel de escritura.

El laboratorio no implementa ese modelo: `setpoint.set_writable()` y `SecurityPolicy NoSecurity` son mecanismos mínimos de la demostración.

## 6. MITRE ATT&CK for ICS: relación y límites

MITRE define [T0836 — Modify Parameter](https://attack.mitre.org/techniques/T0836/) dentro de la táctica **Impair Process Control**: describe modificar parámetros usados para instruir dispositivos ICS y advierte que valores peligrosos o fuera de rango pueden alterar el proceso. La relación didáctica de esta práctica es concreta: se escribe un setpoint de proceso y el gemelo cambia su estado.

| Elemento | Tratamiento en `03-opcua` |
|---|---|
| Técnica principal | `T0836 Modify Parameter`, como analogía técnica del tipo de cambio de parámetro |
| Evidencia | Write real a `Planta/SpeedSetpoint=75`, estado del gemelo, evento y PCAP de 4840 |
| Alcance | El operador del laboratorio dispara una acción predefinida; no se simula compromiso, persistencia, acceso inicial ni adversario |
| Mitigaciones a discutir | M0947 Audit, M0800 Authorization Enforcement, M0804 Human User Authentication, M0818 Validate Program Inputs, certificados/roles, segmentación y allowlist |
| Lo que no se debe afirmar | Una lectura de PCAP o una alarma de la consola no atribuye una campaña ni prueba que el mensaje fuera no autorizado |

La página oficial de [T1692.001 — Command Message](https://attack.mitre.org/techniques/T1692/001/) incluye como ejemplo que INCONTROLLER puede escribir tags en servidores OPC UA. Puede usarse como **comparación de un escenario adversario**, no como etiqueta automática de esta práctica: aquí el cliente está controlado por el instructor, el comando está previsto y el endpoint acepta la operación por configuración didáctica. No se asignan técnicas adicionales por ver TCP, una pantalla o un evento de aplicación.

## 7. Mapeo conceptual IEC 62443

La referencia de [IEC SyC Smart Energy sobre IEC 62443](https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/) explica que las FR agrupan requisitos técnicos, que las zonas y conductos deben definirse según riesgo, y que los niveles de seguridad se expresan por requisitos y mejoras. Este laboratorio **no certifica** un producto, componente, sistema, `SL-A`, `SL-T` ni un nivel de seguridad. La siguiente tabla es un mapa de diseño para discusión:

| FR | Aplicación conceptual al Write OPC UA | Control objetivo / evidencia futura |
|---|---|---|
| FR1 Identificación y autenticación | Distinguir la aplicación `trainer` del usuario que la opera | Certificado de aplicación confiable, TrustList/CA, autenticación de usuario, rotación y revocación |
| FR2 Use control | No toda sesión que puede leer debe poder escribir | Rol por nodo, `Observer`/`Operator` lectura, `Engineer` escritura acotada, ventana, ticket y aprobación |
| FR3 System integrity | Evitar alteración silenciosa y valores inválidos | `Sign`/`SignAndEncrypt`, validación de rango/precondición, protección de escritura, auditoría y reconciliación |
| FR4 Data confidentiality | Evitar que un tercero lea el canal si el riesgo lo requiere | `SignAndEncrypt`, gestión de claves y política criptográfica; `None` no aporta confidencialidad |
| FR5 Restricted data flow | Mantener un conducto mínimo y zonas con funciones distintas | Allowlist de clientes/puertos, segmentación y DMZ industrial; `control: internal` es solo maqueta |
| FR6 Timely response | Detectar y responder a cambios inesperados | Correlación de Write, proceso, alarma y auditoría; playbook y responsable en producción |
| FR7 Resource availability | Mantener control seguro ante exceso, fallo o recuperación | límites de tasa/CPU, redundancia, recuperación y fail-safe; el trip software no es SIS |

El alumno debe decir qué parte es visible en este laboratorio y qué parte queda como recomendación. Una frase válida es “la maqueta ilustra el requisito conceptual y deja una brecha intencional”, no “el repositorio cumple IEC 62443”.

## 8. Contexto legal chileno, sin sobreafirmar

La ficha oficial de [Ley 21.663 en Ley Chile](https://www.bcn.cl/leychile/navegar?idNorma=1202434) identifica la **Ley Marco de Ciberseguridad** y describe su objeto general, institucionalidad y normativa aplicable a acciones de ciberseguridad. En este laboratorio se usa únicamente como contexto para conversar sobre gobierno, gestión y responsabilidad: no se concluye que la maqueta sea un operador de importancia vital, un servicio esencial o una entidad regulada, y no se citan plazos, multas o sanciones sin revisar la versión oficial y la asesoría jurídica correspondiente. Esta guía no es asesoría legal ni una evaluación de cumplimiento.

## 9. Entregables y evidencias

Entregue una carpeta o informe con:

- ficha del escenario: fecha, versión del repositorio, Docker/Compose y estado nominal;
- diagrama `trainer` → `plant:4840` y explicación de por qué el navegador no es el cliente OPC UA;
- captura de la vista 3D/SCADA antes y después, con valor `75 Hz` y su naturaleza de gemelo;
- salida JSON de `/api/state` y evento de `/api/events` asociado al Write;
- PCAP `03-opcua.pcap`, filtro usado y salida de `tshark`;
- una tabla “demuestra / no demuestra” para evento, pantalla, PCAP y EVE;
- propuesta de confianza: certificados, TrustLists, autenticación de usuario, roles, permisos del nodo y ventana de cambio;
- matriz MITRE con `T0836` como analogía y una explicación explícita de por qué no se atribuye intrusión;
- matriz conceptual IEC FR1–FR7, con controles y límites;
- tres antipatrones corregidos y una sección final de límites/aislamiento.

## 10. Antipatrones frecuentes

1. **“OPC UA siempre es seguro” o “OPC UA siempre es inseguro”.** La práctica usa `None`; el estándar también define `Sign`, `SignAndEncrypt`, autenticación y confianza.
2. **“La consola envió los bytes OPC UA”.** La consola envió HTTP/JSON a la API; el `trainer` creó el cliente OPC UA hacia `plant:4840`.
3. **“El panel de tráfico es un PCAP”.** Es una colección de observaciones de aplicación; el PCAP requiere captura y análisis separado.
4. **“75 Hz demuestra un cambio en un PLC”.** Demuestra el valor del gemelo software y su vista 3D, no hardware ni SIS.
5. **“Encontré un frame en 4840, por tanto fue malicioso”.** Un frame demuestra tráfico observado, no intención, autorización ni identidad criptográfica.
6. **“El proxy Modbus es un MITM transparente”.** El repositorio lo describe como una PDU editada enviada directamente al destino fijo; no escucha terceros, no hace ARP spoofing y no es parte de esta práctica.
7. **“La línea base contiene OPC UA/DNP3 periódico”.** La línea base implementada por `trainer` es FC03 Modbus; no invente conversaciones que no aparezcan en el PCAP.
8. **“Un mapeo MITRE es una certificación o atribución”.** `T0836` ayuda a nombrar el tipo de modificación; no convierte una acción didáctica autorizada en incidente.
9. **“FR1–FR7 son una lista de casillas cumplidas”.** Son requisitos conceptuales para analizar zonas, conductos, componentes y riesgo; la maqueta no certifica IEC 62443.
10. **“El endpoint de laboratorio puede publicarse”.** `None`, token de demostración y usuario de contenedor no son controles adecuados para producción; mantenga 4840 interno y el panel en loopback.

## 11. Referencias oficiales y técnicas

- [OPC Foundation — OPC UA Part 2: Security Model, §4](https://reference.opcfoundation.org/specs/OPC-10000-2/4): SecurityPolicies, perfiles, modos `None`/`Sign`/`SignAndEncrypt`, autenticación de aplicación/usuario y roles.
- [OPC Foundation — OPC UA Part 4: Services, §4](https://reference.opcfoundation.org/specs/OPC-10000-4/4): servicios, SecureChannel, Session y Attribute Service Set para leer/escribir Variables.
- [OPC Foundation — OPC UA Part 18: Role Model, §4](https://reference.opcfoundation.org/specs/OPC-10000-18/4): separación de autenticación/autorización, roles y permisos por nodo.
- [MITRE ATT&CK for ICS — T0836 Modify Parameter](https://attack.mitre.org/techniques/T0836/): relación didáctica principal y mitigaciones para cambios de parámetros.
- [MITRE ATT&CK for ICS — T1692.001 Command Message](https://attack.mitre.org/techniques/T1692/001/): comparación oficial de mensajes de comando no autorizados; no se asigna automáticamente a esta práctica autorizada.
- [MITRE ATT&CK for ICS — matriz](https://attack.mitre.org/matrices/ics/): consultar la versión actual antes de reutilizar identificadores.
- [IEC SyC Smart Energy — IEC 62443](https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/): FR1–FR7, zonas/conductos, requisitos y niveles; no es una certificación de este repositorio.
- [NIST SP 800-82 Rev. 3](https://csrc.nist.gov/pubs/sp/800/82/r3/final): contexto de seguridad OT y necesidad de adaptar controles al entorno operativo.
- [Ley Chile — Ley 21.663, Ley Marco de Ciberseguridad](https://www.bcn.cl/leychile/navegar?idNorma=1202434): contexto legal oficial; revisar versión vigente y asesoría jurídica antes de extraer obligaciones.
- [Repositorio — arquitectura de la maqueta](../arquitectura.md): topología Docker, observabilidad, límites del proxy y del gemelo.
- [Repositorio — README de PCAP](../../pcaps/README.md): captura en la interfaz de `plant` y filtros de protocolo.

## 12. Cierre

Una conclusión técnicamente correcta puede ser:

> “Se observó una escritura OPC UA real desde `trainer` hacia `plant:4840`, con valor `75` en el nodo `Planta/SpeedSetpoint`, y el gemelo digital reflejó el cambio. El endpoint usa `SecurityPolicy None`, por lo que la práctica no demuestra firma, cifrado, confianza de certificados ni autorización de producción. El PCAP prueba tráfico en el namespace capturado, mientras que la consola y los eventos son observaciones separadas. La relación con T0836 es una analogía del cambio de parámetro, no una atribución de adversario; FR1–FR7 son un mapa conceptual y no una certificación.”
