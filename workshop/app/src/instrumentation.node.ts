/**
 * OpenTelemetry bootstrap for the travel planner (upstream OTel JS SDK, no vendor distro).
 *
 *  - Traces and logs go to the OTel Collector over OTLP (OTEL_EXPORTER_OTLP_ENDPOINT).
 *  - No metrics are produced here: the collector derives GenAI metrics from spans/events.
 *  - The AI SDK's telemetry integration creates the agent / LLM / tool spans.
 */
import { propagation, type Context } from "@opentelemetry/api";
import { startNodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, type Span, type SpanProcessor } from "@opentelemetry/sdk-trace";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { registerTelemetry } from "ai";
import { LegacyOpenTelemetry, OpenTelemetry } from "@ai-sdk/otel";

/**
 * Copies the conversation id from OTel baggage onto every span started for a request,
 * so agent, LLM, tool and Elasticsearch spans can all be grouped by conversation.
 */
class ConversationIdSpanProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    const id = propagation.getBaggage(parentContext)?.getEntry("gen_ai.conversation.id")?.value;
    if (id) span.setAttribute("gen_ai.conversation.id", id);
  }
  onEnd(): void {}
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

const g = globalThis as typeof globalThis & { __workshopOtel?: boolean };

if (!g.__workshopOtel) {
  g.__workshopOtel = true;

  startNodeSDK({
    resourceAttributes: {
      "service.version": "1.0.0",
      "deployment.environment.name": "workshop",
    },
    spanProcessors: [
      new ConversationIdSpanProcessor(),
      new BatchSpanProcessor({ exporter: new OTLPTraceExporter(), scheduledDelayMillis: 1000 }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter(), scheduledDelayMillis: 1000 }),
    ],
    // Outgoing HTTP from tools and the LLM client. Next.js creates the incoming-request span itself.
    instrumentations: [new UndiciInstrumentation()],
  });

  // Register the AI SDK telemetry integration exactly once (hot reloads re-run route modules,
  // and registerTelemetry() appends to a global list, so it must not live in route.ts).
  const mode = process.env.AI_TELEMETRY === "semconv" ? "semconv" : "legacy";
  registerTelemetry(
    mode === "semconv"
      ? // OpenTelemetry GenAI semantic conventions: invoke_agent / chat / execute_tool spans
        new OpenTelemetry({ agentSpanName: "functionId" })
      : // The AI SDK's legacy shape (ai.* attributes): what most AI SDK apps in production emit today
        new LegacyOpenTelemetry(),
  );
  console.log(`[otel] SDK started, AI SDK telemetry mode: ${mode}`);
}
