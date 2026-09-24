# Laboratorio 04 — Control DNP3 y señal virtual

**Duración estimada:** 35 minutos. **Uso exclusivamente educativo y defensivo.** El semáforo es una representación 3D local: no hay semáforos públicos ni equipos reales conectados. El master `dnp3/native_master.py` emite un comando DNP3/TCP de salida analógica índice 0 hacia el outstation OpenDNP3 `plant:20000`; comprueba la respuesta y lee el valor final por DNP3. El outstation comunica ese cambio al gemelo mediante una API interna en loopback. **La transacción de red entre cliente y RTU es DNP3 auténtico**; HTTP se usa solo dentro del emulador.

Inicie el repositorio con `docker compose up -d` y ejecute `bash scripts/verify-lab.sh`. Después pulse **Restablecer laboratorio** y confirme que la señal está verde. Active **Señal DNP3**. Observe el rojo en la consola, el cartel actualizado y el registro del comando en el panel de eventos. Ejecute `bash scripts/baseline-capture.sh` para guardar un PCAP y filtre `tcp.port == 20000` en Wireshark. Distinga en el tráfico la petición de control, la respuesta y la lectura de retorno. La simple presencia del preámbulo `05 64` no demuestra que un comando haya cambiado el proceso.

Documente en una tabla **hora, origen, función DNP3, valor solicitado, valor observado, estado de la señal y evidencia independiente**. Proponga una contención que preserve la supervisión y compruebe físicamente el estado antes de reabrir la vía: limitar el origen autorizado del conducto, revisar registros del master y validar el punto en la RTU. No confunda el interlock de software con un SIS certificado.

**Entregable:** PCAP o extracto verificable, dos capturas del semáforo antes/después y tabla de correlación. **Criterio de éxito:** demuestra control DNP3 a `20000/TCP`, valor final `traffic_signal=0`, lectura de retorno y la diferencia entre un paquete capturado y una alerta heurística del panel. Analice MITRE ATT&CK for ICS T0831 y los controles IEC 62443 FR2, FR3, FR5 y FR6. [1] [2]

Este laboratorio **no implementa DNP3 Secure Authentication**; no debe conectarse a activos industriales ni usarse para validar la seguridad de una RTU real.

## Referencias

[1]: https://attack.mitre.org/techniques/T0831/ "MITRE ATT&CK ICS T0831: Manipulation of Control"
[2]: https://dnp3.github.io/docs/guide/3.0.0/api/outstations/ "OpenDNP3: outstations and command handlers"
