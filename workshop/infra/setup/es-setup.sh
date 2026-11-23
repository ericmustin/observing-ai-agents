#!/usr/bin/env bash
# Runs once after Elasticsearch is healthy, before the collector sends any data.
set -euo pipefail
ES=http://elasticsearch:9200
es() { curl -sf -u "elastic:${ELASTIC_PASSWORD}" -H 'Content-Type: application/json' "$@"; }

echo "Setting kibana_system password..."
until es -X POST "$ES/_security/user/kibana_system/_password" -d "{\"password\":\"${KIBANA_PASSWORD}\"}" | grep -q '^{}'; do
  sleep 2
done

# ecs@mappings has a dynamic template that maps every `*.score.*` field to float. That
# includes the GenAI semconv string attribute `gen_ai.evaluation.score.label` ("pass"/"fail"),
# which would then be silently dropped. Map it as a keyword before any data arrives.
echo "Installing logs-otel@custom (gen_ai.evaluation.score.label -> keyword)..."
es -X PUT "$ES/_component_template/logs-otel@custom" -d '{
  "template": {
    "mappings": {
      "dynamic_templates": [
        { "gen_ai_evaluation_score_label": {
            "path_match": ["attributes.gen_ai.evaluation.score.label"],
            "mapping": { "type": "keyword" } } }
      ]
    }
  },
  "_meta": { "description": "LLM o11y 101: keep gen_ai.evaluation.score.label a keyword (ecs@mappings maps *.score.* to float)" }
}' >/dev/null

echo "Elasticsearch setup done."
