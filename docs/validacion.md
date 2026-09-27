# Validación reproducible y límites de la evidencia

Fecha de esta validación: **2026-09-27**, sandbox Ubuntu 24.04 amd64, Docker 29.1.3, Compose 2.40.3, contenedores Python 3.11 amd64. La imagen DNP3 fija `dnp3-python==0.3.0b1`, rueda *yanked* x86_64, y no se probó hardware ni una plataforma ARM física. La CI configura QEMU para su runner ARM64; un runner emulado no es validación nativa de Apple Silicon/Windows.

| Comprobación | Resultado observado y criterio de repetición |
|---|---|
| `docker compose config --quiet` y `up -d --build` | Cinco servicios: `plant`/`trainer` healthy; `dnp3`/`suricata`/`sensor` running; solo `127.0.0.1:8080` publicado. Red `control` internal. |
| `bash scripts/verify-lab.sh` | `PASS` FC06 → 85 Hz, OPC UA Write → 75 Hz, DNP3 control → señal 0, proxy explícito → 90 Hz, firma Suricata FC06 reciente y comparación de ADU. |
| `python3 scripts/verify-workspaces.py` | `PASS` cuatro rutas/guías/matrices, acciones cruzadas y valores fuera de rango rechazados, FC03 y FC06 en PCAP/estado, OPC UA en 4840 con Read, DNP3 en 20000 con readback, PCAP descargable, reset estable durante dos segundos. |
| `docker compose exec -T plant python -m unittest discover -s app/tests -v` | Siete pruebas tras reconstruir imagen: cuatro del gemelo/contexto Modbus y tres de bytes PCAP, fragmentos y resumen OPC UA conservador. |
| `docker compose exec -T plant python /lab/dnp3/test_native_unit.py` | CRC-DNP y constructores de tramas; `dnp3/smoke.py` comprueba binding y destino fijo. |
| `GET /api/packets` tras FC03 | `source=sensor pasivo / PCAP`, paquete Ethernet/IP/TCP, FC03 real en petición/respuesta y hex del payload. |
| `GET /api/capture/download` | Cabecera PCAP válida de un segmento rotativo; abrir en Wireshark/Tshark para disección completa. |
| Chromium headless con `/labs/02-modbus` | Navegación, mapa con conducto observado, vista Three.js nominal y visor PCAP aparecen tras carga; vista capturada en [`workspaces-preview.png`](workspaces-preview.png). |

**Condición particular del sandbox de validación:** Docker arrancó con iptables-nft porque el kernel no ofrecía la tabla `raw` de iptables-legacy; además una política `FORWARD DROP` de reglas heredadas bloqueaba el tráfico entre contenedores del bridge privado. Se permitió **únicamente el reenvío intra-bridge de esa red de prueba**, sin abrir puertos OT ni añadir esa regla al repositorio. En otro anfitrión, diagnostique las políticas instaladas con su administrador, nunca copie una regla de este sandbox a un sistema industrial. Vea [diagnóstico](diagnostico.md).

**Fuentes separadas:** el PCAP procede de `sensor/tcpdump`, las firmas de `suricata/eve.json`, los eventos y alarmas analíticas del proceso de `plant`, y la HMI/escena 3D es una visualización. Una coincidencia temporal entre PCAP y estado simulado apoya un análisis de aula, no demuestra efectos en equipos físicos ni intención adversaria. OPC UA UACP `MSG` no equivale a decodificación de `Write` sin reensamblado; la firma DNP3 de preámbulo detecta presencia, no una orden. El proxy Modbus modifica un mensaje construido, no intercepta terceros. El reset no elimina PCAP ni históricos.

Para repetir en otro host, conserve salida de `docker compose ps`, ambos scripts de verificación, PCAP/sha256, los eventos relevantes con hora UTC, versión de Compose, reglas IDS y captura de pantalla antes/después. Si una comprobación falla, **registre el fallo** y consulte [diagnóstico](diagnostico.md); no sustituya el protocolo por una animación o un evento ficticio.
