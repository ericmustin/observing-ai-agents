#!/usr/bin/env bash
# Runs once Kibana is healthy: data views, dashboards and the (disabled) Lab 4 alert rule.
# Idempotent: safe to re-run with `docker compose up kibana-setup`.
set -uo pipefail
KB=http://kibana:5601
AUTH="elastic:${ELASTIC_PASSWORD}"

kb() { curl -s -u "$AUTH" -H 'kbn-xsrf: true' -H 'Content-Type: application/json' "$@"; }
status() { kb -o /dev/null -w '%{http_code}' "$@"; }

data_view() { # id, index pattern, name
  local code attempt
  for attempt in 1 2 3 4 5; do
    # Kibana sometimes answers 400 for a moment right after the space's solution changes: retry.
    code=$(status -X POST "$KB/api/data_views/data_view" -d "{
      \"override\": true,
      \"data_view\": { \"id\": \"$1\", \"title\": \"$2\", \"name\": \"$3\", \"timeFieldName\": \"@timestamp\" }
    }")
    [ "$code" = "200" ] && break
    sleep 2
  done
  echo "  data view  $3 ($2): HTTP $code"
}

# The Observability solution view turns on context-aware Discover: span overviews and the
# full trace timeline (waterfall) for OTel-native traces, with no Elastic-specific processing.
echo "Switching the default space to the Observability solution view..."
echo "  space      default: HTTP $(status -X PUT "$KB/api/spaces/space/default" \
  -d '{"id":"default","name":"Default","solution":"oblt","disabledFeatures":[]}')"

echo "Creating data views..."
data_view llm-o11y-traces      'traces-*.otel-*'              'Agent traces (OTel)'
data_view llm-o11y-logs        'logs-*.otel-*'                'Agent logs and events (OTel)'
data_view llm-o11y-evals       'logs-genai.otel-*'            'GenAI evaluation events'
data_view llm-o11y-metrics     'metrics-genai.otel-*'         'GenAI metrics (from the collector)'
data_view llm-o11y-prometheus  'metrics-generic.prometheus-*' 'Prometheus remote write'

echo "Loading dashboards..."
# Only create missing dashboards: this runs on every `make up`, and attendees add panels in Lab 4.
# `make reset` deletes everything, so it reloads them.
for f in /kibana/dashboards/*.json; do
  id=$(basename "$f" .json)
  if [ "$(status "$KB/api/dashboards/$id")" = "200" ]; then
    echo "  dashboard  $id: already exists, leaving it alone"
    continue
  fi
  code=$(status -X PUT "$KB/api/dashboards/$id" --data-binary "@$f")
  echo "  dashboard  $id: HTTP $code"
  [ "$code" = "200" ] || [ "$code" = "201" ] || { kb -X PUT "$KB/api/dashboards/$id" --data-binary "@$f"; echo; exit 1; }
done

echo "Creating alert rules (disabled; you enable them in Lab 4)..."
for f in /kibana/rules/*.json; do
  id=$(basename "$f" .json)
  code=$(status -X POST "$KB/api/alerting/rule/$id" --data-binary "@$f")
  case "$code" in
    200) echo "  rule       $id: created" ;;
    409) echo "  rule       $id: already exists, leaving it alone" ;;
    *)   echo "  rule       $id: HTTP $code"; kb -X POST "$KB/api/alerting/rule/$id" --data-binary "@$f"; echo; exit 1 ;;
  esac
done

echo "Kibana setup done."
