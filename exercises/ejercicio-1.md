# Ejercicio 1 — Línea base y observabilidad OT

**Laboratorio:** `01-baseline`
**Duración:** 60–75 min
**Modalidad:** individual o parejas, exclusivamente en la maqueta Docker.

## Aislamiento y uso legal — obligatorio

> Este ejercicio es solo educativo y defensivo. Ejecútelo en un equipo autorizado y sin conectar Docker a una red OT, planta, PLC, RTU, SIS, sensor, actuador, red corporativa o Internet. No escanee ni capture equipos de terceros. No publique `502/TCP`, `4840/TCP` ni `20000/TCP`, no cambie destinos de scripts y no reutilice los comandos fuera de este repositorio.

La instalación contiene una **maqueta 3D/software y un gemelo digital**, no hardware PLC, RTU, sensor, actuador ni SIS físico. `plant:502`, `plant:4840` y `plant:20000` son destinos fijos dentro de la red Docker interna. El proxy del repositorio no es una intercepción transparente: envía una trama editada a `plant:502`. Los bytes del panel o del navegador no son bytes de un PCAP.

## Situación

Eres responsable de documentar la línea base de un conducto OT de entrenamiento antes de analizar una desviación. Debes demostrar qué se observa en la red y qué solo aparece como evento de aplicación o estado de la interfaz.

El `trainer` genera lecturas Modbus/TCP FC03 hacia `plant:502`. FC03 es una lectura de holding registers; FC06 es una escritura de un holding register y no debe confundirse con ella [1]. El tráfico OPC UA y DNP3 no se considera periódico en este ejercicio: solo se espera observarlo si ejecutas el helper de captura, que activa explícitamente escenarios de laboratorio.

## Objetivos medibles

Al terminar, podrás:

1. Dibujar nodos, zonas y flujos fijos de `browser`, `trainer`, `plant`, `dnp3` y `suricata`.
2. Obtener una captura con al menos cinco pares de lectura FC03 y reconocer petición y respuesta.
3. Diferenciar FC03 de FC06 usando bytes/campos del PCAP y no solo la vista SCADA.
4. Correlacionar PCAP, eventos de API, vista 3D y EVE JSON, indicando la fuente de cada afirmación.
5. Relacionar observables con MITRE ATT&CK for ICS y con FR1–FR7 de IEC 62443 como mapeo conceptual, sin atribución ni certificación.

## Prerrequisitos

- Docker Engine y Compose v2.
- Navegador local.
- Wireshark o TShark opcional en el anfitrión para leer PCAP.
- Repositorio clonado en `/home/ubuntu/work/ot-ics-labs-modbus-opcua-dnp3`.

## Parte A — Preparación y estado nominal

1. Ve a la raíz del repo y valida el Compose:

   ```bash
   cd /home/ubuntu/work/ot-ics-labs-modbus-opcua-dnp3
   docker compose config --quiet
   docker compose up -d
   docker compose ps
   curl --noproxy '*' -fsS http://127.0.0.1:8080/api/health
   ```

2. Comprueba que `plant` y `trainer` estén `healthy`, y que `dnp3` y `suricata` estén `running`. No continúes si Docker publicó los puertos industriales.

3. Usa **Restablecer laboratorio** en `http://127.0.0.1:8080/`, o el endpoint local existente:

   ```bash
   curl --noproxy '*' -fsS -X POST http://127.0.0.1:8080/api/scenario/reset
   ```

4. Abre el panel y registra hora UTC, nivel, velocidad, temperatura, caudal, semáforo, cartel y estado de seguridad. Toma una captura de la vista 3D. Los valores iniciales del modelo son una referencia software, no una medición física independiente.

## Parte B — Línea base FC03

5. Ejecuta el generador limitado al destino fijo:

   ```bash
   docker compose exec -T trainer python /lab/scripts/generate-traffic.py --count 5
   ```

   Conserva la salida. Debes poder explicar que cada lectura solicita siete holding registers desde la dirección PDU 0. El servicio `trainer` también puede intentar FC03 aproximadamente cada 3 s mientras está activo.

6. Si quieres un PCAP de **solo Modbus/TCP FC03**, captura únicamente TCP/502 mientras repites la generación:

   ```bash
   set -u
   PCAP="pcaps/ejercicio-1-fc03-$(date -u +%Y%m%dT%H%M%SZ).pcap"
   docker compose exec -T plant timeout 12 tcpdump -i any -U -s 0 \
     -w "/captures/$(basename "$PCAP")" 'tcp port 502' >/dev/null 2>&1 &
   CAPTURE_PID=$!
   sleep 2
   docker compose exec -T trainer python /lab/scripts/generate-traffic.py --count 5
   CAPTURE_STATUS=0
   wait "$CAPTURE_PID" || CAPTURE_STATUS=$?
   test "$CAPTURE_STATUS" -eq 124
   sha256sum "$PCAP"
   ```

   El archivo se crea mediante el volumen de evidencias; el comando no escucha la red del anfitrión. No confundas el código 124 de `timeout` con un fallo si el PCAP existe y no está vacío.

## Parte C — Captura completa opcional

7. Para analizar los tres protocolos, ejecuta el helper existente:

   ```bash
   bash scripts/baseline-capture.sh
   ```

   El helper captura 22 s en la interfaz visible de `plant`, y luego llama explícitamente a `modbus-write`, `opcua-write`, `dnp3-signal` e `intercept`. Por ello, un PCAP de este helper incluye tráfico inducido por escenarios; no lo llames “normalidad” ni inventes tráfico periódico OPC UA/DNP3. Conserva el nombre del PCAP y su hash:

   ```bash
   PCAP="$(ls -1t pcaps/ot-ics-labs-*.pcap | head -n 1)"
   sha256sum "$PCAP" | tee "${PCAP}.sha256"
   ```

## Parte D — Análisis PCAP

8. Reemplaza `PCAP` por el archivo que vas a analizar y ejecuta:

   ```bash
   tshark -r "$PCAP" -Y 'tcp.port == 502'
   tshark -r "$PCAP" -Y 'modbus && modbus.func_code == 3'
   tshark -r "$PCAP" -Y 'modbus && modbus.func_code == 6'
   tshark -r "$PCAP" -Y 'tcp.port == 4840'
   tshark -r "$PCAP" -Y 'tcp.port == 20000'
   tshark -r "$PCAP" -Y 'tcp contains 05:64'
   ```

9. Si DNP3 no es reconocido, usa en TShark o Wireshark `Decode As…` para `TCP/20000 → DNP3`. `05 64` es un indicio de preámbulo DNP3; contrástalo con el flujo TCP y no lo uses solo para atribuir una orden [2].

10. En la primera conversación Modbus, identifica:

    - cliente y servidor observados;
    - transaction ID y pares petición/respuesta;
    - función `03`, dirección inicial y cantidad;
    - timestamp relativo;
    - dirección/puerto de origen y destino.

    Busca luego cualquier `06` y explica por qué es una escritura. Si usaste solo la captura FC03, puede no existir FC06: escribe `no observado` en vez de inventarlo.

## Parte E — Correlación SCADA, API e IDS

11. Extrae las fuentes por separado:

    ```bash
    curl --noproxy '*' -fsS http://127.0.0.1:8080/api/state | python3 -m json.tool
    curl --noproxy '*' -fsS http://127.0.0.1:8080/api/events | python3 -m json.tool
    curl --noproxy '*' -fsS http://127.0.0.1:8080/api/traffic | python3 -m json.tool
    curl --noproxy '*' -fsS http://127.0.0.1:8080/api/alerts | python3 -m json.tool
    ```

12. Compara la captura con la vista 3D, los eventos y las alertas. Recuerda:

    - una fila de `/api/events` es un registro de aplicación;
    - una tarjeta del panel es estado expuesto por el gemelo;
    - una alerta con `engine: Suricata` es diferente de `OT-ANOMALY` del gemelo;
    - si no hay alerta EVE, registra **sin evidencia IDS**;
    - no atribuyas a un PCAP bytes que solo aparecen como texto o JSON en el navegador.

## Entregable

Entrega un informe breve con:

1. Diagrama de cinco nodos y tabla de flujos (`from`, `to`, protocolo, puerto).
2. PCAP y `sha256`.
3. Tabla de al menos cinco paquetes relevantes:

   | Frame | Hora relativa | Origen | Destino | Función/protocolo | Finalidad prevista | Evidencia | Desviación a detectar |
   |---:|---:|---|---|---|---|---|---|

4. Una captura de la vista SCADA/3D nominal.
5. Una explicación de FC03 frente a FC06 apoyada en la especificación y en el PCAP.
6. Una comparación de PCAP, API, SCADA/3D y EVE JSON.
7. Una matriz MITRE con alcance: relación técnica, analogía defensiva o `sin ID` para el proxy no transparente.
8. Un mapeo conceptual de IEC 62443 FR1–FR7 y controles sugeridos, sin decir “certificado”, “cumple” o “SL alcanzado”.
9. Una sección de límites que indique explícitamente que el hardware es simulación, que el proxy no es transparente, que no hay tráfico periódico OPC/DNP inventado y que la Ley 21.663 solo es contexto.

## Rúbrica — 100 puntos

| Criterio | Puntos | Evidencia esperada |
|---|---:|---|
| Aislamiento y reproducibilidad | 15 | Docker interno, loopback, destinos fijos, comandos y hash del PCAP; ningún puerto industrial publicado. |
| Topología y flujo | 15 | Nodos/zonas/conductos correctos, roles de `trainer`, `plant`, `dnp3`, `suricata` y navegador. |
| Análisis FC03 | 20 | Cinco o más pares o cinco solicitudes claramente relacionadas, función 03, dirección/cantidad y respuesta. |
| Distinción FC03/FC06 | 10 | Diferencia correcta entre lectura y escritura, con evidencia de campo/bytes; `no observado` cuando aplique. |
| Correlación de fuentes | 15 | PCAP, eventos, SCADA/3D y EVE separados; ningún byte de navegador atribuido a PCAP; sin evidencia IDS cuando corresponda. |
| MITRE ATT&CK for ICS | 10 | IDs actuales y justificados; diferencia entre técnica representada, observación y atribución; proxy sin T0830. |
| IEC 62443 y contexto legal | 10 | FR1–FR7 y controles conceptuales; no certificación; Ley 21.663 citada solo como contexto sin plazos/multas no verificadas. |
| Límites y comunicación técnica | 5 | Declara maqueta software, no PLC/SIS, tráfico OPC/DNP solo por escenario y proxy no transparente. |

**Aprobación sugerida:** 70 puntos y ningún incumplimiento del aislamiento. Un informe que capture fuera de Docker o dirija tráfico a un destino no autorizado no es válido aunque su tabla de paquetes sea correcta.

---

# Solución de referencia — separada del enunciado

La siguiente solución es un patrón de razonamiento, no una lista de timestamps que deba coincidir entre equipos.

## Resultado técnico mínimo

La topología correcta es:

```text
browser  --HTTP 127.0.0.1:8080--> plant:8000
trainer  --Modbus/TCP 502-------> plant
trainer  --OPC UA 4840----------> plant (solo escenario explícito)
trainer  --DNP3/TCP 20000-------> plant (solo escenario explícito)
trainer  --ruta control visible--> suricata (copia pasiva)
```

La línea base pura debe contener conversaciones Modbus FC03. La petición representa una lectura de siete holding registers desde PDU address 0; la respuesta devuelve los registros. FC03 tiene código `0x03`. FC06, si aparece después del helper completo, es una escritura de un único holding register con código `0x06`; su presencia debe etiquetarse como escenario inducido, no como baseline.

## Respuesta de observabilidad

Una buena respuesta separa las fuentes:

- **PCAP:** demuestra que `tcpdump` vio un frame en la interfaz capturada y permite examinar MBAP/PDU, función, timestamps y conversaciones.
- **API/eventos:** demuestra que la aplicación registró una lectura o una acción, pero no sustituye el PCAP.
- **SCADA/3D:** demuestra el estado que el gemelo expuso; no hay sensor físico ni SIS.
- **EVE/Suricata:** demuestra una firma solo si existe una alerta EVE. Si no, se escribe `sin evidencia IDS`.

Una dirección IP de origen no es una identidad autorizada: puede ser un endpoint compartido, una dirección reasignada o un proceso no autenticado. La autorización requiere identidad y control de uso.

## Mapeo MITRE esperado

- **T0801 Monitor Process State:** relación técnica razonable con la lectura FC03 del estado del proceso; el actor observable aquí es el cliente didáctico autorizado, no un adversario.
- **T0842 Network Sniffing:** solo analogía defensiva del sensor autorizado que captura PCAP; no prueba sniffing adversario.
- **T0836 Modify Parameter:** solo si se analiza el FC06 generado por `modbus-write` o `intercept`; no se asigna a la lectura FC03.
- **T0831 Manipulation of Control:** solo como conducta de control software cuando se ejecutó DNP3/OPC UA; no es un control físico real.
- **Proxy:** `sin ID`. No corresponde T0830 porque el repositorio no instala un MITM transparente, no hace ARP spoofing y no intercepta terceros; solo envía una trama editada a `plant:502`.

No se asigna una técnica de escaneo a un diagrama estático, porque no hubo escaneo. Tampoco se atribuye campaña o malware.

## Mapeo IEC 62443 esperado

El alumno puede proponer, de forma conceptual:

- **FR1:** identidad, certificados OPC UA, roles y autenticación.
- **FR2:** autorización por función, rango, destino, horario y aprobación; separar FC03 de escrituras.
- **FR3:** validación de entradas, integridad de cambios, hash y correlación de fuentes.
- **FR4:** cifrado donde sea viable; `NoSecurity` se reconoce como debilidad de ensayo.
- **FR5:** zonas/conductos, `control` interna y dashboard de loopback; no DMZ certificada.
- **FR6:** tiempo entre frame, evento, visualización y alerta; registrar ausencia de firma con honestidad.
- **FR7:** límites de captura, healthchecks y reset; no extrapolar a disponibilidad de planta/SIS.

Esto es un razonamiento de diseño y defensa, no evidencia de certificación ni de un nivel de seguridad alcanzado.

## Referencias del ejercicio

[1]: https://www.modbus.org/file/secure/modbusprotocolspecification.pdf "MODBUS Application Protocol Specification V1.1b3"
[2]: https://www.dnp.org/Portals/0/AboutUs/DNP3%20Primer%20Rev%20A.pdf "DNP Users Group, A DNP3 Protocol Primer"
