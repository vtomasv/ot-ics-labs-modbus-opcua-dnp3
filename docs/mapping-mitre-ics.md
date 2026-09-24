# Mapeo de observables del laboratorio

Esta tabla asocia comportamientos **simulados** con técnicas de [MITRE ATT&CK for ICS](https://attack.mitre.org/matrices/ics/). El identificador técnico describe una conducta, no atribuye una campaña real. Los requisitos IEC 62443 son una guía de diseño; la maqueta no certifica un **SL-A**. **SL-T** expresa la meta por zona o conducto tras evaluar riesgos, y puede variar por requisito fundamental. [1]

| Evidencia verificable | Técnica, táctica y alcance | IEC 62443 / diseño compensatorio | Métrica sugerida |
|---|---|---|---|
| FC03 y mapa de flujo | T0842 Network Sniffing, **riesgo a discutir**; no se presupone intrusión por una lectura | FR5 restringe conductos, FR6 monitoriza eventos | % de flujos Modbus inventariados |
| FC06 registra 45→85 Hz | T0836 Modify Parameter; Impair Process Control [2] | FR1 autenticación, FR2 autorización, FR3 integridad, FR6 respuesta | Tiempo desde escritura a alerta confirmada |
| Proxy fijo registra `2D`→`5A` | T0830 Adversary-in-the-Middle, analogía **solo de integridad del mensaje** | FR3 protección, FR5 origen permitido | % de cambios fuera de rango rechazados |
| Nodo OPC UA acepta `Write` sin cifrado | T0836 como comportamiento final, no una propiedad inherente a OPC UA | FR1–FR4: certificados, roles, firma y confidencialidad | % de endpoints sin política `None` |
| Master DNP3 cambia luz verde→roja | T0831 Manipulation of Control; Impact [3] | FR2, FR3, FR5, FR6; control del conducto y validación independiente | Latencia de correlación trama/estado físico |
| Medida HMI difiere de sensor fuera de banda | T0832 Manipulation of View, **solo un ejercicio de análisis** | FR3, FR6, FR7: verificación y continuidad | Tiempo para confirmar origen del dato |

Este mapeo se refiere solo a los paquetes y estados verificables de la maqueta. Consulte la matriz actual de MITRE al interpretar los identificadores, porque sus técnicas y tácticas pueden cambiar. **Una lectura legítima no demuestra intrusión** y el proxy de una trama no demuestra intercepción de terceros. [4]

## Referencias

[1]: https://syc-se.iec.ch/deliveries/cybersecurity-guidelines/security-standards-and-best-practices/iec-62443/ "IEC 62443 Foundational Requirements and security levels"
[2]: https://attack.mitre.org/techniques/T0836/ "MITRE ATT&CK ICS T0836: Modify Parameter"
[3]: https://attack.mitre.org/techniques/T0831/ "MITRE ATT&CK ICS T0831: Manipulation of Control"
[4]: https://attack.mitre.org/tactics/ics/ "MITRE ATT&CK ICS Tactics"
