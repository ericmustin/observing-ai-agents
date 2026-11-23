# Query cheat sheet

Copy these into **Discover** (switch to ES|QL with the **Query in ES|QL** button) or into a dashboard panel (**Add > Visualization (query)**). Set the time picker to **Last 30 minutes**. Every query here has been run against the workshop stack.

Where the data lives:

| Data | Index pattern | Written by |
|---|---|---|
| Spans | `traces-*.otel-*` | the app, through the collector |
| Evaluation events (judge and guardrails) | `logs-genai.otel-*` | the app, through the collector |
| Other app logs and span events | `logs-*.otel-*` | the app, through the collector |
| GenAI metrics derived from spans and events | `metrics-genai.otel-*` | the collector's `signal_to_metrics` connector |
| The same metrics, scraped by Prometheus | `metrics-generic.prometheus-*` | Prometheus remote write |

## Lab 1: what is the agent emitting?

Every span the travel planner sent, by name and by the library that created it:

```esql
FROM traces-*.otel-*
| WHERE resource.attributes.service.name == "travel-planner"
| STATS spans = COUNT(*) BY name, scope.name
| SORT spans DESC
```

The AI SDK's legacy `ai.*` operations, and the tokens they report. (After Lab 2 the normalizer removes `ai.operationId`, so this returns only older spans.)

```esql
SET unmapped_fields="nullify";
FROM traces-*.otel-*
| WHERE attributes.ai.operationId IS NOT NULL
| STATS spans = COUNT(*), input_tokens = SUM(attributes.gen_ai.usage.input_tokens) BY attributes.ai.operationId
```

How many spans from the last 5 minutes follow the GenAI semantic conventions? (Zero until you finish Lab 2. Until then the field doesn't exist at all, so `SET unmapped_fields="nullify"` stops the query failing.)

```esql
SET unmapped_fields="nullify";
FROM traces-*.otel-*
| WHERE resource.attributes.service.name == "travel-planner" AND @timestamp > NOW() - 5 minutes
| STATS semconv_spans = COUNT(attributes.gen_ai.operation.name), all_spans = COUNT(*)
```

## Lab 2: GenAI semantic conventions

What the agent does, in semconv terms:

```esql
FROM traces-*.otel-*
| WHERE attributes.gen_ai.operation.name IS NOT NULL
| STATS spans = COUNT(*), p95_ms = PERCENTILE(duration, 95) / 1000000 BY attributes.gen_ai.operation.name, attributes.gen_ai.provider.name
```

Token usage per conversation, straight from the `chat` spans:

```esql
FROM traces-*.otel-*
| WHERE attributes.gen_ai.operation.name == "chat"
| STATS llm_calls = COUNT(*), input_tokens = SUM(attributes.gen_ai.usage.input_tokens), output_tokens = SUM(attributes.gen_ai.usage.output_tokens) BY attributes.gen_ai.conversation.id
| SORT input_tokens DESC
| LIMIT 10
```

Which tools the agent calls, and how slow they are:

```esql
FROM traces-*.otel-*
| WHERE attributes.gen_ai.operation.name == "execute_tool"
| STATS calls = COUNT(*), p95_ms = PERCENTILE(duration, 95) / 1000000 BY attributes.gen_ai.tool.name
| SORT p95_ms DESC
```

The `gen_ai.client.token.usage` metric the collector derives from those spans:

```esql
FROM metrics-genai.otel-*
| WHERE gen_ai.client.token.usage IS NOT NULL
| STATS tokens = SUM(gen_ai.client.token.usage) BY attributes.gen_ai.token.type, attributes.gen_ai.request.model
```

Estimated cost. Cost isn't in the semantic conventions, so work it out at query time. The prices are illustrative list prices in USD per million tokens; edit them for your models:

```esql
FROM metrics-genai.otel-*
| WHERE gen_ai.client.token.usage IS NOT NULL
| STATS tokens = SUM(gen_ai.client.token.usage) BY model = attributes.gen_ai.request.model, type = attributes.gen_ai.token.type
| EVAL usd_per_1m = CASE(
    model LIKE "gpt-4o-mini*", CASE(type == "input", 0.15, 0.60),
    model LIKE "gpt-4.1-mini*", CASE(type == "input", 0.40, 1.60),
    model LIKE "gpt-4o*", CASE(type == "input", 2.50, 10.00),
    CASE(type == "input", 1.00, 4.00))
| STATS cost_usd = SUM(tokens * usd_per_1m / 1000000.0) BY model
```

### The same metrics with PromQL

Prometheus scrapes the collector and remote-writes into Elasticsearch, and ES|QL can run PromQL against it. Prometheus naming rules apply: dots become underscores, and histograms become `_bucket`, `_sum` and `_count` series.

Tokens per token type over the last 5 minutes:

```promql
PROMQL index=metrics-generic.prometheus-* step=1m sum by (gen_ai_token_type) (increase(gen_ai_client_token_usage_sum[5m]))
```

p95 LLM call latency in seconds, from the histogram buckets:

```promql
PROMQL index=metrics-generic.prometheus-* step=1m histogram_quantile(0.95, sum by (le, gen_ai_request_model) (rate(gen_ai_client_operation_duration_seconds_bucket[5m])))
```

Tool calls per tool:

```promql
PROMQL index=metrics-generic.prometheus-* step=1m sum by (gen_ai_tool_name) (increase(travel_planner_tool_calls_total[5m]))
```

## Lab 3: guardrails and evaluations

Every evaluation result, from the judge (`hallucination`, `relevance`, `toxicity`, `pii`) and from the guardrails (`guardrail.*`):

```esql
FROM logs-genai.otel-*
| STATS events = COUNT(*) BY attributes.gen_ai.evaluation.name, attributes.gen_ai.evaluation.score.label
| SORT attributes.gen_ai.evaluation.name
```

Blocked requests, why they were blocked, and the trace to open:

```esql
FROM logs-genai.otel-*
| WHERE attributes.travel_planner.guardrail.action == "deny"
| KEEP @timestamp, attributes.gen_ai.evaluation.name, attributes.gen_ai.evaluation.explanation, trace_id
| SORT @timestamp DESC
```

Answers the judge thinks are hallucinated, with its reasoning:

```esql
FROM logs-genai.otel-*
| WHERE attributes.gen_ai.evaluation.name == "hallucination" AND attributes.gen_ai.evaluation.score.label == "fail"
| KEEP @timestamp, attributes.gen_ai.evaluation.score.value, attributes.gen_ai.evaluation.explanation, attributes.gen_ai.response.id, trace_id
| SORT @timestamp DESC
```

Bypasses: requests the judge failed that no guardrail blocked. These are what your guardrails missed:

```esql
SET unmapped_fields="nullify";
FROM logs-genai.otel-*
| STATS judge_failed = COUNT(*) WHERE attributes.travel_planner.evaluator == "llm-judge" AND attributes.gen_ai.evaluation.score.label == "fail",
        guardrail_denied = COUNT(*) WHERE attributes.travel_planner.guardrail.action == "deny",
        checks = VALUES(attributes.gen_ai.evaluation.name) WHERE attributes.gen_ai.evaluation.score.label == "fail"
  BY trace_id
| WHERE judge_failed > 0 AND guardrail_denied == 0
```

Guardrail decisions as a Prometheus counter:

```promql
PROMQL index=metrics-generic.prometheus-* step=1m sum by (gen_ai_evaluation_name, travel_planner_guardrail_action) (increase(travel_planner_guardrail_decisions_total[15m]))
```

## Lab 4: alerting

The token-budget rule (**Alerts > Manage rules > Agent token budget**) runs this every minute over the last minute. Each row it returns is an alert, one per model:

```esql
FROM metrics-genai.otel-*
| WHERE gen_ai.client.token.usage IS NOT NULL
| STATS tokens = SUM(gen_ai.client.token.usage) BY model = attributes.gen_ai.request.model
| WHERE tokens > 5000
```

Other ideas for rules: a hallucination rate above 20%, more than 3 guardrail denials a minute (someone is probing your agent), or a p95 LLM latency above 10 seconds.
