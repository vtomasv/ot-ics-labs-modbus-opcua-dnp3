# Práctica 2 — FC06, cambio de setpoint y proxy didáctico

**Duración:** 45 min. **Solo escenario controlado de laboratorio.** La meta es demostrar el efecto de una escritura industrial cuando el origen carece de autorización efectiva, y separar una alarma analítica de una firma de Suricata.

Restablezca la planta desde la consola y registre la velocidad nominal de 45 Hz. Pulse **Escritura Modbus**. Compruebe el cambio a 85 Hz, el caudal y el color de advertencia. Encuentre en la captura la petición a `502/TCP`; para la dirección base cero `2`, identifique el FC06 y el valor escrito. Lea `/api/alerts` y distinga `engine: Suricata` de una alarma de proceso. Revise `docker compose logs suricata` solo si no encuentra firma IDS.

Restablezca otra vez y pulse **Proxy de trama Modbus**. **La implementación es un proxy explícito de una sola trama a `plant:502`, no un MITM transparente ni un ataque a terceros**. En la ventana MBAP, compare `00 11 00 00 00 06 01 06 00 02 00 2D` (45) con el mismo encabezado terminado en `00 5A` (90). Verifique que la planta responde a 90 Hz y explique por qué un cambio de valor sin cambio de función puede evadir un control que solo alerta por FC06.

**Entregable:** captura con ambas tramas, ocho campos/bytes rotulados, estado físico antes/después, entrada del evento, captura de una firma del IDS si aparece, y diseño de una regla defensiva por origen + rango permitido. Si la firma no se observa, anote el resultado como fallo de visibilidad del sensor y proponga dónde ubicar un punto de captura pasiva.

**Criterio de éxito:** correlación de PCAP y gemelo; `0x2D`=45 y `0x5A`=90; distingue tráfico alterado **en el proxy** de una modificación de red externa. Mapeo: T0836 Modify Parameter; T0830 Adversary-in-the-Middle como analogía limitada; FR2, FR3, FR5 y FR6 de IEC 62443. [1] [2]

## Referencias

[1]: https://attack.mitre.org/techniques/T0836/ "MITRE ATT&CK ICS T0836: Modify Parameter"
[2]: https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/ "IEC 62443: siete requisitos fundamentales"
