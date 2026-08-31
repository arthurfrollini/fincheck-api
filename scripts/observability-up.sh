#!/bin/bash
# Brings up just the observability services (Jaeger, Prometheus, Loki,
# Grafana) without touching db/redis/redisinsight, which are usually
# already running independently during normal dev work. Waits for each
# service's own health/ready endpoint before printing the access URLs, so
# the printed list is only shown once everything is actually reachable.
set -uo pipefail

cd "$(dirname "$0")/.."

echo "Starting jaeger, prometheus, loki, grafana..."
docker compose up -d jaeger prometheus loki grafana

wait_for() {
  local name="$1" url="$2" tries=30
  until curl -sf "$url" >/dev/null 2>&1; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      echo "$name did not become ready in time ($url)."
      exit 1
    fi
    sleep 1
  done
}

wait_for "Jaeger" "http://localhost:16686"
wait_for "Prometheus" "http://localhost:9090/-/ready"
wait_for "Loki" "http://localhost:3100/ready"
wait_for "Grafana" "http://localhost:3001/api/health"

cat <<'EOF'

All observability services are up:

  Jaeger UI       http://localhost:16686
  Prometheus UI   http://localhost:9090
  Grafana UI      http://localhost:3001   (login: admin / admin)
  App metrics     http://localhost:9464/metrics   (once `npm run start:dev` is running)

Loki has no UI of its own — query it through Grafana's Explore view.
EOF
