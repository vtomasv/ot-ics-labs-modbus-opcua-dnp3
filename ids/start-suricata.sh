#!/usr/bin/env bash
set -euo pipefail

# Suricata comparte la pila de red de plant. La interfaz de control puede
# llamarse eth0 o eth1 según Docker Engine; ubicarla por la ruta a trainer.
peer=""
for attempt in {1..30}; do
  peer="$(getent ahostsv4 trainer | awk 'NR == 1 {print $1}' || true)"
  if [[ -n "$peer" ]]; then
    break
  fi
  sleep 1
done
if [[ -z "$peer" ]]; then
  echo 'No se resolvió trainer dentro de la red privada OT.' >&2
  exit 1
fi
iface="$(ip -o route get "$peer" | awk '{for (i = 1; i <= NF; i++) if ($i == "dev") {print $(i+1); exit}}')"
if [[ -z "$iface" || "$iface" == "lo" ]]; then
  echo "Ruta de control inválida para trainer=$peer: interfaz '$iface'" >&2
  exit 1
fi
printf 'Suricata: interfaz de control %s hacia trainer=%s\n' "$iface" "$peer"
export SURICATA_OPTIONS="-i $iface -S /rules/ot.rules"
exec /docker-entrypoint.sh
