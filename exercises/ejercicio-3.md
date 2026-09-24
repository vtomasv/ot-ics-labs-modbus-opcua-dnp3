# Práctica 3 — Escritura OPC UA y política de seguridad

**Duración:** 35 min. **Escenario controlado de laboratorio; endpoint inseguro solo a propósito.** El servidor de la maqueta escucha en `opc.tcp://plant:4840/ot-lab/`, disponible únicamente a los otros contenedores. `Planta/SpeedSetpoint` admite escritura por una política `None`; ese diseño es la debilidad que el alumno debe explicar, no una limitación intrínseca del estándar. OPC UA define `Sign`, `SignAndEncrypt`, confianza de certificados y autenticación de usuario. [1]

Restablezca el estado nominal. Pulse **Escritura OPC UA** y registre el nodo, el valor nuevo (75 Hz) y el cambio en la representación 3D. Localice en el PCAP el establecimiento de sesión hacia `4840/TCP`. Responda por escrito: ¿qué aportan firmas y cifrado?, ¿qué controles autorizan a un cliente a escribir este nodo?, ¿cómo se instala la confianza en certificados y se evita aceptar cualquier cliente?, ¿qué evidencia permite atribuir el cambio a una identidad? Proponga una política que permita lectura a supervisión y escritura a ingeniería en ventana de cambio, sin elevar automáticamente una red completa al mismo nivel.

**Entregable:** ficha del nodo, captura del antes/después, flujo del cliente al servidor y un mini diseño de confianza, identidades, roles y auditoría. Señale que el laboratorio **no** implementa en modo seguro el endpoint y, por tanto, no valida certificados ni demuestra un despliegue de producción.

**Criterio de éxito:** se verifica un `Write` auténtico, el setpoint final de 75 y una propuesta que exige al menos canal firmado/cifrado, certificados confiables y autorización del nodo. Mapeo: T0836 y requisitos FR1, FR2, FR3 y FR4 de IEC 62443. [2] [3]

## Referencias

[1]: https://reference.opcfoundation.org/specs/OPC-10000-2/4 "OPC UA Part 2: Security Model"
[2]: https://attack.mitre.org/techniques/T0836/ "MITRE ATT&CK ICS: Modify Parameter"
[3]: https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/ "IEC 62443: Foundational Requirements"
