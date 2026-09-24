#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose config --quiet
docker compose up -d
ready=false
for attempt in $(seq 1 30); do
  if docker compose exec -T trainer python /lab/scripts/health.py trainer >/dev/null 2>&1 && \
     docker compose exec -T trainer python /lab/dnp3/native_master.py observe >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo "El operador o la estación DNP3 no estuvieron disponibles tras 30 intentos." >&2
  docker compose ps >&2
  exit 1
fi
docker compose exec -T trainer python /lab/scripts/check_integration.py
