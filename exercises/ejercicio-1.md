# Práctica 1 — Línea base y mapa de flujos

**Duración:** 40 min. **Escenario controlado de laboratorio; no capture interfaces de una planta real.** Objetivo medible: reconocer una lectura Modbus FC03, una sesión OPC UA y un intercambio DNP3 de la red privada Docker, e identificar los activos del conducto.

Inicie `docker compose up -d` y verifique `docker compose ps`. Abra `http://127.0.0.1:8080/` y espere a que aparezca “API CONECTADA”. Registre nivel, velocidad, caudal y estado del semáforo; anote que un dato HMI no es por sí solo una medida independiente. Ejecute `bash scripts/baseline-capture.sh`; el script genera el PCAP en `pcaps/` mientras dispara escenarios **dentro de la maqueta**, de modo que la captura contendrá también escrituras para comparación. En Wireshark utilice `tcp.port == 502`, `tcp.port == 4840` y `tcp.port == 20000` como filtros preliminares. Identifique una petición FC03, su respuesta y al menos un intercambio en cada uno de los otros dos puertos. Si Wireshark no reconoce DNP3 automáticamente, use “Decode As… DNP3” y contraste el preámbulo `05 64`.

**Entregable:** archivo PCAP; tabla con hora, origen, destino, función/protocolo, finalidad prevista y qué indicador permitiría detectar un acceso no esperado. Incluya una captura de pantalla del nivel del tanque y una explicación de por qué una dirección IP no constituye identidad autorizada.

**Criterio de éxito:** identifica al menos cinco paquetes relevantes, distingue una consulta FC03 de un comando FC06 y no confunde un evento de la API con un paquete observado. Si el sensor no reporta firmas, indique “sin evidencia IDS” en lugar de atribuir una detección inexistente.

## Referencias

[1]: https://www.modbus.org/file/secure/modbusprotocolspecification.pdf "MODBUS Application Protocol Specification V1.1b3"
[2]: https://dnp3.github.io/docs/guide/3.0.0/api/outstations/ "OpenDNP3: comportamiento de una outstation"
