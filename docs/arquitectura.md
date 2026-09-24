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
       cliente/maestro                         EVE JSON al panel
```

El servicio `trainer` solo está conectado a `control`, una red Docker interna. `plant` conecta `control` y `dashboard` para que el navegador local vea la maqueta. **Ese puente no satisface la arquitectura de DMZ industrial**: representa precisamente una decisión de acceso que los alumnos deben cuestionar. El tablero, además, se publica solo en loopback. Para separar usos didácticos del anfitrión, ni 502 ni 4840 ni 20000 se publican. El sensor Suricata usa `network_mode: service:plant` y `ids/start-suricata.sh` resuelve `trainer` para capturar **la interfaz que lleva al conducto `control`**, aunque Docker le asigne otro nombre. No se promete visibilidad de tráfico ajeno al namespace. En un entorno industrial se preferiría SPAN/TAP autorizado, evitando cargas activas sobre controladores. [1]

**Modelo Purdue aproximado:** `trainer` actúa como aplicación de supervisión/ingeniería (nivel 2–3), `plant` agrupa controlador y proceso (nivel 0–1 emulados), mientras que la consola está fuera de la zona de control; esta agregación de funciones en contenedores **no reproduce la separación física ni funcional real**. El conducto autorizado sería supervisión→RTU para lecturas; la escritura exigiría un conjunto mucho menor de identidades, horarios, rangos y aprobaciones. La simulación no implementa MFA, sesión grabada, hardware PLC, firmware ni un SIS auténtico.

**Seguridad incorporada al proyecto:** destinos fijos dentro de Docker; `trainer` sin puertos publicados; API del outstation accesible solo por loopback; token interno para observaciones; comando de semáforo DNP3 restringido a tres valores; comandos manuales limitados a 0–60 Hz; tamaño acotado del histórico. El token por defecto, el usuario de contenedor y el endpoint OPC UA sin firma/cifrado **no son controles adecuados para producción**. El alumno debe proponer una versión con autenticación/roles/certificados OPC UA, segmentación independiente, administración de cambios y límites de proceso.

**Límites de observabilidad:** el feed de eventos incluye mensajes de aplicación y una colección separada de registros IDS EVE JSON. No equivale a espejo completo de paquetes. La firma Suricata de FC06 analiza un offset fijo en la PDU Modbus/TCP de este ejercicio. Un IDS de producción requiere identificación de protocolo, reensamblado y prueba frente a fragmentación/variantes, no esta firma simplificada. Para DNP3 la firma busca el preámbulo `05 64`; ese indicio no prueba por sí solo un comando malicioso.

El escenario `intercept` envía directamente un PDU Modbus/TCP editado desde una función de proxy de aula. Muestra el principio de integridad de mensajes y permite comparar bytes. **No** instala un proxy transparente ni realiza ARP spoofing. OPC UA en esta maqueta utiliza `SecurityPolicy None` de forma visible y deliberada: la OPC Foundation define `Sign` y `SignAndEncrypt` y recomienda no habilitar `None` por defecto cuando hay perfiles seguros. [2]

## Referencias

[1]: https://csrc.nist.gov/pubs/sp/800/82/r3/final "NIST SP 800-82 Rev. 3, OT Security"
[2]: https://reference.opcfoundation.org/specs/OPC-10000-2/4 "OPC UA Part 2: Security Model"
[3]: https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/ "IEC 62443: zonas, conductos y requisitos"
