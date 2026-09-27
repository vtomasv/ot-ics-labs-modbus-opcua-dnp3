# Capturas del laboratorio

`bash scripts/baseline-capture.sh` genera archivos `.pcap` únicamente a partir de la interfaz de red **del contenedor `plant`**, con filtro de puertos 502, 4840 y 20000. No capture interfaces del anfitrión o de una red OT real para reproducir las prácticas. Abra el archivo en Wireshark y use filtros `modbus`, `opcua` o `dnp3`, según los disectores disponibles.

Si se incluye `ejemplo-referencia.pcap`, habrá sido creado en un entorno Docker de prueba y contendrá únicamente tráfico de la maqueta; no contiene muestras reales de incidentes industriales. Los nuevos PCAP se excluyen del repositorio Git por defecto para no compartir accidentalmente datos de otras prácticas.

El contenedor **`sensor`** produce aparte un PCAP continuo en el volumen Docker `live-captures`, rotado en tres segmentos de 16 MB. El visor `/api/packets` lee el segmento más reciente y `/api/capture/download` lo descarga. Estos archivos **no** aparecen automáticamente en este directorio; descargue/guarde el segmento antes de que rote si necesita evidencia perenne. `docker compose down` conserva el volumen, mientras que `docker compose down -v` lo elimina.
