# Pruebas del repositorio

La maqueta se probó en **Linux x86_64/amd64 con Docker Compose v2**. Los cuatro servicios se iniciaron; `plant` y `trainer` quedaron saludables. La API web se publicó únicamente en `127.0.0.1:8080` y los puertos OT `502`, `4840` y `20000` permanecieron privados. La construcción necesita acceso a Debian, PyPI y Docker Hub; sobre ARM **no** se ha validado la rueda DNP3. El sensor IDS selecciona su interfaz según la ruta hacia `trainer` en lugar de requerir una versión concreta de Docker Engine.

| Comprobación | Resultado esperado y observado en la prueba |
|---|---|
| `docker compose config --quiet` | Archivo válido, red de control interna y red de panel diferenciadas |
| `docker compose up -d` sin imagen local + `docker compose ps` | Construcción automática; `plant` y `trainer` healthy; `dnp3` y `suricata` running |
| `bash scripts/verify-lab.sh` | `PASS` en FC06 a 85 Hz, OPC UA a 75 Hz, DNP3 señal roja, proxy a 90 Hz, firma FC06 reciente y dos tramas preservadas |
| Recreación de servicios + `verify-lab.sh` | La espera acotada del script evita disparar escenarios antes de que el operador y la RTU respondan |
| `docker compose exec -T plant python /lab/dnp3/test_native_unit.py` | Comprobaciones de CRC-DNP y codificación de tramas |
| `docker compose exec -T dnp3 python /lab/dnp3/smoke.py` | Binding OpenDNP3 de la RTU e inicialización de objetos |
| `docker compose exec -T trainer python /lab/scripts/generate-traffic.py --count 2` | Dos lecturas FC03 con valores de proceso |
| `docker compose exec -T trainer python /lab/scripts/attack-modbus-write.py --lab-only` | Una escritura FC06 con lectura de retorno |
| `bash scripts/baseline-capture.sh` | PCAP local decodificable por Wireshark/Tshark con Modbus, OPC UA y DNP3 |

Para reproducir la validación en otra máquina, use los comandos de la portada y guarde su salida. **No hay garantía de comportamiento industrial fuera de esta maqueta**. En particular, la RTU usa `dnp3-python==0.3.0b1`, cuya distribución fue retirada; el master DNP3 solo soporta el intercambio acotado de este repositorio. OPC UA opera intencionalmente con política `None`. La protección por software del proceso no es un SIS real.

Si falla un paso, preserve sus logs y PCAP, consulte [diagnóstico](diagnostico.md) y reporte la diferencia observada. No registre como detección de Suricata una alerta que solo calculó el gemelo.
