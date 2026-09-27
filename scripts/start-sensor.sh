#!/usr/bin/env bash
set -euo pipefail
# Sensor shares only plant's network namespace: no host interface or published port.
peer=''
for attempt in $(seq 1 30); do
  peer="$(getent ahostsv4 trainer | awk 'NR == 1 {print $1}' || true)"
  [[ -n "$peer" ]] && break
  sleep 1
done
[[ -n "$peer" ]] || { echo 'Sensor: trainer DNS unavailable' >&2; exit 1; }
iface="$(ip -o route get "$peer" | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}')"
[[ -n "$iface" && "$iface" != 'lo' ]] || { echo 'Sensor: invalid control interface' >&2; exit 1; }
mkdir -p /captures/live
printf 'Sensor: capturing control interface %s toward trainer=%s (502, 4840, 20000 TCP)\n' "$iface" "$peer"
# Bounded disk usage: three rotating 16 MB segments. The UI reads the newest.
exec tcpdump -Z root -i "$iface" -nn -s 1024 -U -C 16 -W 3 \
  -w /captures/live/live.pcap 'tcp and (port 502 or port 4840 or port 20000)'
