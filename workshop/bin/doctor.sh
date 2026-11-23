#!/usr/bin/env bash
# Checks every part of the workshop stack and says what to do if something is wrong.
# Needs only bash, curl, sed and Docker (or Podman).
cd "$(dirname "$0")/.." || exit 1
[ -f .env ] && set -a && . ./.env && set +a
# Same choice as the Makefile: Docker if it's installed, otherwise Podman, unless CONTAINER_ENGINE is set.
if [ -z "${CONTAINER_ENGINE:-}" ]; then
  if command -v docker >/dev/null 2>&1; then CONTAINER_ENGINE=docker; else CONTAINER_ENGINE=podman; fi
fi
COMPOSE="$CONTAINER_ENGINE compose"
export PODMAN_COMPOSE_WARNING_LOGS=${PODMAN_COMPOSE_WARNING_LOGS:-false}

ES="http://localhost:${ES_PORT:-9200}"
KB="http://localhost:${KIBANA_PORT:-5601}"
PROM="http://localhost:${PROMETHEUS_PORT:-9090}"
APP="http://localhost:${APP_PORT:-3000}"
AUTH="elastic:${ELASTIC_PASSWORD:-changeme}"
fails=0

ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✘\033[0m %s\n      → %s\n' "$1" "$2"; fails=$((fails + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n      → %s\n' "$1" "$2"; }
# Runs an ES|QL query that returns one number, and prints it (0 if none).
esql() {
  local q=${1//\"/\\\"}
  curl -sf -u "$AUTH" -H 'Content-Type: application/json' "$ES/_query?format=csv" \
    -d "{\"query\": \"SET unmapped_fields=\\\"nullify\\\"; $q\"}" 2>/dev/null | sed -n '2p' | tr -d '\r'
}
# Number of Prometheus targets that are up (Prometheus needs a few seconds after a collector restart).
prom_targets() {
  curl -sf "$PROM/api/v1/query" --data-urlencode 'query=count(up == 1)' 2>/dev/null \
    | sed -n 's/.*"value":\[[^,]*,"\([0-9]*\)"\].*/\1/p'
}
kb_exists() { [ "$(curl -s -o /dev/null -w '%{http_code}' -u "$AUTH" "$KB/api/$1")" = "200" ]; }

echo "Stack"
es_up=false
if curl -sf -u "$AUTH" "$ES/_cluster/health" | grep -qE '"status":"(green|yellow)"'; then
  es_up=true; ok "Elasticsearch $ES"
else
  bad "Elasticsearch is not reachable" "it restarts on its own after a crash: wait a minute and run make doctor again. Still down? make up, then $COMPOSE logs elasticsearch"
fi
curl -sf -u "$AUTH" "$KB/api/status" | grep -q '"level":"available"' \
  && ok "Kibana $KB" || bad "Kibana is not ready" "it can take 2 minutes after start; $COMPOSE logs kibana"
kb_exists dashboards/llm-o11y-agent-overview && kb_exists alerting/rule/llm-o11y-token-budget \
  && ok "Dashboards and the alert rule are loaded" || bad "Dashboards or the alert rule are missing" "$COMPOSE logs kibana-setup, then make up"
curl -sf "localhost:${COLLECTOR_HEALTH_PORT:-13133}" >/dev/null \
  && ok "OpenTelemetry Collector" || bad "Collector is down" "$COMPOSE logs otel-collector (a YAML mistake from Lab 2? make lab-reset)"
for _ in 1 2 3 4 5 6; do
  targets=$(prom_targets)
  [ "${targets:-0}" -ge 2 ] && break
  sleep 5
done
[ "${targets:-0}" -ge 2 ] \
  && ok "Prometheus $PROM (scraping $targets targets)" || bad "Prometheus is not scraping the collector" "$COMPOSE logs prometheus"

echo "Agent"
curl -sf -o /dev/null "$APP/api/health" \
  && ok "Travel planner $APP" || bad "The app is not responding" "$COMPOSE logs app"
if $es_up; then
  flights=$(curl -sf -u "$AUTH" "$ES/upcoming-flight-data/_count" | sed -n 's/.*"count":\([0-9]*\).*/\1/p')
  [ "${flights:-0}" -gt 0 ] \
    && ok "Flight data loaded ($flights flights)" || bad "No flight data" "$COMPOSE up flights-loader"
fi
if [ "${LLM_MODE:-mock}" = "live" ]; then
  if models=$($COMPOSE exec -T app sh -c 'wget -qO- --header "Authorization: Bearer $LLM_API_KEY" "$LLM_BASE_URL/models"' 2>/dev/null); then
    ok "LLM endpoint ${LLM_BASE_URL} (live)"
    if printf '%s' "$models" | grep -qF "\"${LLM_MODEL:-gpt-4o-mini}"; then
      ok "Model ${LLM_MODEL:-gpt-4o-mini} is available"
    else
      warn "The endpoint doesn't list model ${LLM_MODEL:-gpt-4o-mini}" "Ollama: ollama pull ${LLM_MODEL:-gpt-4o-mini}. Otherwise check LLM_MODEL in .env (some providers don't list every model)"
    fi
  else
    bad "Cannot reach the LLM at ${LLM_BASE_URL}" "check LLM_BASE_URL / LLM_API_KEY in .env (Ollama: is the app running, and does ollama list show ${LLM_MODEL}?), or set LLM_MODE=mock and run make up"
  fi
else
  $COMPOSE exec -T mock-llm wget -qO- localhost:8080/health >/dev/null 2>&1 \
    && ok "Mock LLM (LLM_MODE=mock)" || bad "Mock LLM is down" "$COMPOSE logs mock-llm"
fi
# What the running app uses: `make semconv` / `make legacy` change it without touching .env.
mode=$($COMPOSE exec -T app printenv AI_TELEMETRY 2>/dev/null | tr -d '\r')
ok "AI SDK telemetry mode: ${mode:-${AI_TELEMETRY:-legacy}}"

echo "Telemetry"
if ! $es_up; then
  echo "  (skipped: Elasticsearch is down)"
else
# Chat requests only: page loads, health checks and make up's warm-up GET don't count.
chats=$(esql 'FROM traces-*.otel-* | WHERE name == "POST /api/chat" AND @timestamp > NOW() - 1 hour | STATS n = COUNT(*)')
[ "${chats:-0}" -gt 0 ] \
  && ok "Agent requests traced ($chats in the last hour)" \
  || warn "No agent requests traced yet" "chat with the agent at $APP or run make traffic"
# A short window, so this goes back to "!" soon after make lab-reset.
genai=$(esql 'FROM traces-*.otel-* | WHERE attributes.gen_ai.operation.name IS NOT NULL AND @timestamp > NOW() - 5 minutes | STATS n = COUNT(*)')
[ "${genai:-0}" -gt 0 ] \
  && ok "GenAI semconv spans ($genai with gen_ai.operation.name in the last 5 minutes)" \
  || warn "No gen_ai.operation.name on spans in the last 5 minutes" "expected before Lab 2. After it, run make traffic (this checks the last 5 minutes)"
evals=$(esql 'FROM logs-genai.otel-* | WHERE @timestamp > NOW() - 1 hour | STATS n = COUNT(*)')
[ "${evals:-0}" -gt 0 ] \
  && ok "Evaluation events ($evals gen_ai.evaluation.result in the last hour)" \
  || warn "No evaluation events yet" "run make traffic (judge scores arrive a few seconds after each answer)"
guards=$(esql 'FROM logs-genai.otel-* | WHERE attributes.gen_ai.evaluation.name LIKE "guardrail.*" AND @timestamp > NOW() - 5 minutes | STATS n = COUNT(*)')
[ "${guards:-0}" -gt 0 ] \
  && ok "Guardrail results ($guards guardrail.* evaluation events in the last 5 minutes)" \
  || warn "No guardrail.* evaluation events in the last 5 minutes" "expected before Lab 3. After it, run make traffic (this checks the last 5 minutes)"
fi

echo
if [ "$fails" -eq 0 ]; then echo "All good."; else echo "$fails problem(s) found."; exit 1; fi
