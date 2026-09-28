# Arquitectura de la maqueta y modelo de confianza

El proceso físico es un **gemelo digital**. Una tarea de simulación calcula nivel, caudal y temperatura a partir de la velocidad de la bomba; una función local detiene la bomba si el nivel supera 92 % o la temperatura 78 °C. La consola Three.js solo visualiza estados servidos por la API y envía comandos predefinidos del laboratorio. No hay conexión a sensores, válvulas ni máquinas externas.

```text
 Navegador anfitrión 127.0.0.1:8080
            │ HTTP, no hacia RTU directamente
       [plant / API, HMI y gemelo] ────────── zona de visualización
            │       │       │
            │       │       └─ outstation DNP3 (20000/TCP, mismo namespace)
            │       └───────── OPC UA (4840/TCP, endpoint None de ensayo)
            └───────────────── Modbus/TCP (502/TCP)
              interfaz de ruta a trainer en red `control`, `internal: true`
            ▲                                    │
            │ tráfico real                        │ copia pasiva
       [trainer] ────────────────────────> [suricata en namespace plant]
       cliente/maestro                   └──────> [sensor tcpdump en namespace plant]
                                                  PCAP rotativo al visor
```

El servicio `trainer` solo está conectado a `control`, una red Docker interna. `plant` conecta `control` y `dashboard` para que el navegador local vea la maqueta. **Ese puente no satisface la arquitectura de DMZ industrial**: representa precisamente una decisión de acceso que los alumnos deben cuestionar. El tablero, además, se publica solo en loopback. Para separar usos didácticos del anfitrión, ni 502 ni 4840 ni 20000 se publican. Los dos sensores, `suricata` (firmas EVE) y `sensor` (PCAP Ethernet), comparten `network_mode: service:plant` y seleccionan la interfaz hacia `trainer` mediante la ruta, sin asumir `eth0` o `eth1`. Cada uno observa la ruta visible del namespace, no un SPAN/TAP industrial. En un entorno real se preferiría SPAN/TAP autorizado evitando cargas activas sobre controladores. [1]

**Modelo Purdue aproximado:** `trainer` actúa como aplicación de supervisión/ingeniería (nivel 2–3), `plant` agrupa controlador y proceso (nivel 0–1 emulados), mientras que la consola está fuera de la zona de control; esta agregación de funciones en contenedores **no reproduce la separación física ni funcional real**. El conducto autorizado sería supervisión→RTU para lecturas; la escritura exigiría un conjunto mucho menor de identidades, horarios, rangos y aprobaciones. La simulación no implementa MFA, sesión grabada, hardware PLC, firmware ni un SIS auténtico.

**Seguridad incorporada al proyecto:** destinos fijos dentro de Docker; `trainer` sin puertos publicados; API del outstation accesible solo por loopback; token interno para observaciones; lista blanca de acciones por laboratorio; límite de 1,5 segundos entre emisiones por práctica; comando DNP3 restringido a 0/1/2; FC03 de solo lectura y FC06 únicamente en registro 2 con 30–95; OPC UA Write solo en `Planta/SpeedSetpoint` con 30–95; controles manuales nominales de 0–60 Hz. No existe entrada para host, puerto, bytes arbitrarios, escaneo ni repetición masiva. El token por defecto, el usuario de contenedor y el endpoint OPC UA sin firma/cifrado **no son controles adecuados para producción**. El alumno debe proponer autenticación/roles/certificados OPC UA, segmentación independiente, administración de cambios y límites de proceso.

**Límites de observabilidad:** el feed de eventos incluye mensajes de aplicación y una colección separada de registros IDS EVE JSON. El endpoint `/api/packets` lee el **PCAP real** guardado por `tcpdump` en un volumen. Si libpcap no puede abrir la interfaz bajo QEMU/ARM (fallo de `ETHTOOL_GET_TS_INFO`), el mismo servicio cambia a `scripts/capture_sensor.py`: un socket Linux `AF_PACKET` pasivo vinculado a la interfaz hacia `trainer` guarda tramas Ethernet reales con cabecera PCAP clásica, sin transmitir nada. Su filtro local solo conserva IPv4/TCP con puertos 502/4840/20000, y puede forzarse con `CAPTURE_BACKEND=python` para ensayo. El lector muestra Ethernet/IP/TCP y hasta 192 bytes de payload por paquete, con resúmenes prudentes de Modbus FC03/FC06, tipo UACP OPC UA y función DNP3 cuando cabe en el segmento; no reensambla TCP, no valida CRC DNP ni descifra servicios OPC UA. Descargue el último segmento desde `/api/capture/download` y ábralo en Wireshark/Tshark para la disección completa. La captura rota en tres segmentos de 16 MB cada uno; su visor muestra el más reciente y no es un historial perenne. La firma Suricata FC06 usa un offset fijo; sus reglas de HEL OPC UA y cabecera DNP3 indican presencia, **no** prueban Write/Direct Operate. Un IDS de producción requiere identificación de protocolo, reensamblado y pruebas frente a fragmentación/variantes.

Las cuatro URLs `/labs/01-baseline`, `/labs/02-modbus`, `/labs/03-opcua` y `/labs/04-dnp3` muestran guías, mapas, paneles PCAP y MITRE distintos **sobre una misma planta Docker**; cambiar de pestaña no crea una planta nueva. Haga `reset` entre alumnos/prácticas, conserve las evidencias y no interprete una casilla de autoevaluación como una prueba automática o certificación.

El escenario `intercept` envía directamente un PDU Modbus/TCP editado desde una función de proxy de aula. Muestra el principio de integridad de mensajes y permite comparar bytes. **No** instala un proxy transparente ni realiza ARP spoofing. OPC UA en esta maqueta utiliza `SecurityPolicy None` de forma visible y deliberada: la OPC Foundation define `Sign` y `SignAndEncrypt` y recomienda no habilitar `None` por defecto cuando hay perfiles seguros. [2]

## Referencias

[1]: https://csrc.nist.gov/pubs/sp/800/82/r3/final "NIST SP 800-82 Rev. 3, OT Security"
[2]: https://reference.opcfoundation.org/specs/OPC-10000-2/4 "OPC UA Part 2: Security Model"
[3]: https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/ "IEC 62443: zonas, conductos y requisitos"
