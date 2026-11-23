import { context, logs, propagation, trace, type Context } from "@opentelemetry/api";

export const tracer = trace.getTracer("travel-planner");
export const logger = logs.getLogger("travel-planner");

/** Returns a context that carries the conversation id as baggage (see instrumentation.node.ts). */
export function withConversation(ctx: Context, conversationId: string): Context {
  const baggage = (propagation.getBaggage(ctx) ?? propagation.createBaggage()).setEntry(
    "gen_ai.conversation.id",
    { value: conversationId },
  );
  return propagation.setBaggage(ctx, baggage);
}

export type EvaluationResult = {
  /** gen_ai.evaluation.name, e.g. "hallucination" or "guardrail.pii" */
  name: string;
  /** gen_ai.evaluation.score.value */
  score: number;
  /** gen_ai.evaluation.score.label: low-cardinality, e.g. "pass" | "fail" */
  label: string;
  /** gen_ai.evaluation.explanation */
  explanation?: string;
  /** gen_ai.response.id: correlates the score with the model response it judged */
  responseId?: string;
  /** Extra, non-semconv attributes (use your own namespace!) */
  extra?: Record<string, string | number | boolean>;
};

/**
 * Emits an OpenTelemetry GenAI `gen_ai.evaluation.result` event as an OTel log record.
 * https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-events.md
 *
 * Passing `ctx` ties the event to the active trace, so you can jump from a bad score to the trace.
 */
export function emitEvaluationResult(result: EvaluationResult, ctx: Context = context.active()) {
  logger.emit({
    eventName: "gen_ai.evaluation.result",
    context: ctx,
    body: `${result.name}: ${result.label}`,
    attributes: {
      "gen_ai.evaluation.name": result.name,
      "gen_ai.evaluation.score.value": result.score,
      "gen_ai.evaluation.score.label": result.label,
      ...(result.explanation ? { "gen_ai.evaluation.explanation": result.explanation } : {}),
      ...(result.responseId ? { "gen_ai.response.id": result.responseId } : {}),
      ...result.extra,
    },
  });
}
