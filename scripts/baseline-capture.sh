#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
name="ot-ics-labs-$(date -u +%Y%m%dT%H%M%SZ).pcap"
echo "Capturando 22 s en la interfaz OT privada (sin escuchar la red del anfitrión): pcaps/$name"
curl --noproxy '*' -fsS -X POST "http://127.0.0.1:${DASHBOARD_PORT:-8080}/api/scenario/reset" >/dev/null
# timeout devuelve 124 al completar la ventana normal; el fichero queda en pcaps/.
docker compose exec -T plant timeout 22 tcpdump -i any -U -s 0 -w "/captures/$name" \
  'tcp port 502 or tcp port 4840 or tcp port 20000' >/dev/null 2>&1 &
pid=$!
sleep 4
for scenario in modbus-write opcua-write dnp3-signal intercept; do
  curl --noproxy '*' -fsS -X POST "http://127.0.0.1:${DASHBOARD_PORT:-8080}/api/scenario/$scenario" >/dev/null || \
    echo "AVISO: el escenario $scenario no respondió; revisar docker compose logs $scenario" >&2
  sleep 2
done
wait "$pid" || { code=$?; if [ "$code" -ne 124 ]; then exit "$code"; fi; }
test -s "pcaps/$name"
echo "Captura disponible: pcaps/$name"
echo "Leer: tshark -r pcaps/$name -Y 'modbus || opcua || dnp3'"
