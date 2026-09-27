# Diagnóstico y reproducción segura

## Fallo al construir la imagen en ARM64

Si `docker compose up -d` muestra `pull access denied for ot-ics-labs` seguido de `ERROR: No matching distribution found for dnp3-python==0.3.0b1`, **el fallo real es el segundo mensaje**: pip no encontró una rueda de esa versión para la arquitectura del contenedor. La imagen `ot-ics-labs:local` no es un repositorio publicado; el mensaje de `pull` era consecuencia de que Compose intentaba descargarla antes de construirla. La configuración corregida añade `pull_policy: build` y fija `platform: linux/amd64` para los tres servicios Python. La versión fijada de DNP3 solo dispone de rueda CPython 3.11 para Linux x86_64. [1] [2]

Dentro del clon del repositorio, actualice sin borrar sus capturas ni volúmenes y repita la construcción:

```bash
git pull --ff-only
docker compose config --quiet
docker compose up -d
docker compose ps
bash scripts/verify-lab.sh
```

En Apple Silicon, habilite la emulación amd64 que corresponda a su instalación de Docker Desktop; la opción Rosetta, cuando esté disponible, puede acelerar binarios Intel. [3] La emulación requiere más tiempo que una ejecución nativa. Si después de actualizar aparece `exec format error` o `no matching manifest for linux/amd64`, compruebe que su entorno Docker admita emulación `linux/amd64` y que pudo descargar `python:3.11-slim-bookworm`. **No use `docker compose down -v` para resolver errores de construcción**: borra volúmenes de evidencia y no cambia la arquitectura de una rueda Python.

Si la consola indica **SIN TELEMETRÍA** en lugar de **API CONECTADA**, conserva la última lectura y no fabrica estados, eventos ni paquetes. Compruebe `docker compose ps`, `docker compose logs --tail=100 plant trainer dnp3 suricata sensor` y `curl -fsS http://127.0.0.1:8080/api/health` antes de evaluar una práctica. Si el visor dice **SENSOR NO DISPONIBLE**, revise `docker compose logs sensor` y `/api/packets`; el PCAP se guarda en el volumen `live-captures`, no en el histórico de eventos JSON.

Si el operador responde `Name or service not known` o `timed out`, confirme que `trainer` y `plant` están unidos a `control` con `docker compose config`, que el DNS `plant` resuelve dentro del contenedor y que `docker compose exec -T trainer python /lab/scripts/generate-traffic.py --count 2` funciona. Algunas instalaciones Linux tienen reglas **iptables-legacy** y **nftables** contradictorias tras instalar Docker: una política heredada `FORWARD DROP` puede bloquear hasta el bridge privado aunque Docker añada reglas nft. Revise ambas cadenas (`sudo iptables-legacy -nvL FORWARD`, `sudo iptables-nft -nvL FORWARD`) y consulte al administrador antes de cambiar reglas del anfitrión; **no** copie reglas de un laboratorio a un host industrial o compartido. En este repositorio el único puerto publicado es `127.0.0.1:8080`; no abra 502, 4840 o 20000 como “solución rápida”.

Si `sensor` reinicia con `Permission denied` al abrir `live.pcap0`, confirme que está ejecutando la versión actual de `scripts/start-sensor.sh` (opción `tcpdump -Z root`) y reconstruya con `docker compose up -d --build` sin borrar volúmenes. Si `sensor` está **running** pero la captura solo tiene 24 bytes, es la cabecera PCAP: genere una lectura FC03 y compruebe que los contenedores pueden comunicarse antes de concluir que no hubo tráfico.

Si un comando Modbus cambia el modelo pero **no** aparece firma de Suricata, no convierta la alarma `OT-ANOMALY` del gemelo en “detección IDS”. Revise que el sensor haya iniciado, que `suricata -T -S /rules/ot.rules` valide las reglas y que `docker compose logs suricata` muestre `Suricata: interfaz de control ... hacia trainer`. `ids/start-suricata.sh` determina la interfaz mediante la ruta al operador en `control`; si el DNS `trainer` no se resuelve, no captura tráfico del panel por error. Los registros de firma viven en el volumen `suricata-logs`, archivo `eve.json`.

Si el ejercicio DNP3 no cambia la señal, contraste `docker compose logs dnp3 trainer`, presencia de TCP 20000 en una captura y valor de `traffic_signal` en `/api/state`. Una sesión TCP o una firma que detecta la cabecera `05 64` **no bastan** para confirmar la ejecución de la orden de salida analógica. El binding `dnp3-python==0.3.0b1` de la estación remota está marcado como *yanked* por su distribuidor: el uso está limitado a este ejercicio y requiere las pruebas de integración documentadas en este repositorio. No lo recomiende para producción ni para estaciones remotas reales.

Para un resultado reproducible ejecute `bash scripts/verify-lab.sh`, después `bash scripts/baseline-capture.sh` y abra el archivo `.pcap` de `pcaps/` con Wireshark. Al final pulse el botón **Restablecer laboratorio** para que la siguiente práctica comience en el estado nominal. Ese botón conserva el histórico de eventos del volumen; `docker compose down -v` **lo borra**.

## Referencias

[1]: https://pypi.org/pypi/dnp3-python/0.3.0b1/json "PyPI: archivos de dnp3-python 0.3.0b1"
[2]: https://docs.docker.com/reference/compose-file/build/ "Docker Compose: build, image y pull_policy"
[3]: https://docs.docker.com/desktop/settings-and-maintenance/settings/ "Docker Desktop: emulación x86_64/amd64 con Rosetta"
