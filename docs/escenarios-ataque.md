# Escenarios implementados y evidencia esperada

Todos los comandos del proyecto están limitados a `plant` en la red privada Docker. La etiqueta «ataque» significa una **acción consentida sobre un gemelo digital**; no hay explotación de CVE, descubrimiento de redes externas, modificación de terceros ni equipos físicos. Los protocolos de campo sí son reales dentro de la maqueta.

| Escenario | Transacción verificable | Efecto en el gemelo | Limitación explícita |
|---|---|---|---|
| Línea base | FC03 desde `trainer` a `plant:502` cada 3 s | No altera consignas | Una lectura autorizada no demuestra intrusión |
| Escritura Modbus | FC06 sobre registro 2, `45→85` | Velocidad y caudal aumentan; cartel de advertencia | Solo destino interno fijo |
| Escritura OPC UA | `Write` a `Planta/SpeedSetpoint=75` en `plant:4840` | La bomba opera a 75 Hz | Endpoint de ensayo `NoSecurity`, deliberadamente inseguro |
| Control DNP3 | Salida analógica índice 0 a `plant:20000`, lectura DNP3 de retorno | Semáforo rojo (`0`) | Sin DNP3 Secure Authentication; no controla semáforos reales |
| Proxy de trama Modbus | PDU FC06 preparada para `45`, enviada con valor `90` | Velocidad 90 Hz y comparación antes/después | **No** es MITM transparente ni ARP spoofing |
| Restablecimiento | Endpoint interno devuelve valores de línea base | Bomba 45 Hz y señal verde | No borra histórico, PCAP ni volumen de evidencia |

Use un PCAP para afirmar que observó una transacción de protocolo, `/api/state` para el estado simulado, y un registro `engine: Suricata` para afirmar que una **firma IDS** se activó. Un evento generado por la lógica de la planta no demuestra por sí mismo que el sensor pasivo haya visto el paquete. La tabla de [MITRE/IEC](mapping-mitre-ics.md) traduce estas evidencias a controles defensivos, sin atribuir campañas reales al tráfico simulado.

El proxy solo permite comparar integridad de una orden preparada por el laboratorio. En una instalación OT genuina, cualquier cambio en límites, accesos y conductos requiere análisis de seguridad de proceso y coordinación con operaciones. [1]

## Referencias

[1]: https://csrc.nist.gov/pubs/sp/800/82/r3/final "NIST SP 800-82 Rev. 3: Guide to Operational Technology Security"
