# Capturas del laboratorio

`bash scripts/baseline-capture.sh` genera archivos `.pcap` únicamente a partir de la interfaz de red **del contenedor `plant`**, con filtro de puertos 502, 4840 y 20000. No capture interfaces del anfitrión o de una red OT real para reproducir las prácticas. Abra el archivo en Wireshark y use filtros `modbus`, `opcua` o `dnp3`, según los disectores disponibles.

Si se incluye `ejemplo-referencia.pcap`, habrá sido creado en un entorno Docker de prueba y contendrá únicamente tráfico de la maqueta; no contiene muestras reales de incidentes industriales. Los nuevos PCAP se excluyen del repositorio Git por defecto para no compartir accidentalmente datos de otras prácticas.
