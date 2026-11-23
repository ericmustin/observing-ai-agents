import { context, SpanKind, type Context } from "@opentelemetry/api";

import { emitEvaluationResult, tracer } from "./telemetry";

/**
 * Tiny, dependency-free guardrails for the travel planner.
 *
 * Real deployments would use a classifier model or a guardrail service, but the
 * observability story is the same: every check produces a result you want to see.
 */

export type Stage = "preflight" | "postflight";
/** allow = passed, deny = request blocked (preflight), flag = logged only (postflight) */
export type Action = "allow" | "deny" | "flag";

export type GuardResult = {
  guard: string;
  passed: boolean;
  /** 0 = no risk detected, 1 = certain violation */
  score: number;
  explanation: string;
};

export type GuardrailDecision = {
  action: Action;
  results: GuardResult[];
  denied?: GuardResult;
};

const CITIES =
  /\b(amsterdam|berlin|munich|dublin|barcelona|madrid|paris|prague|warsaw|new york|las vegas|seattle|sydney|sao paulo|mauritius|glasgow|london|rome|lisbon|tokyo)\b/i;
const TRAVEL =
  /\b(flights?|fly|airlines?|airports?|depart\w*|arriv\w*|trips?|travel\w*|holidays?|vacations?|getaway|weekend|break|visit\w*|itinerar\w*|tours?|sights?|sightseeing|museums?|hotels?|restaurants?|destinations?|passport|visa|weather|forecast|beach|canals?)\b/i;
const OFF_TOPIC: [RegExp, string][] = [
  [/\b(politic\w*|government|elections?|parliament|president|prime minister)\b/i, "politics"],
  [/\b(financ\w*|invest\w*|stocks?|crypto\w*|bitcoin|tax(es)?|econom\w*)\b/i, "finance"],
  [/\b(code|coding|program\w*|javascript|python|bug|compile)\b/i, "computing"],
];

/** Only travel-related requests are allowed. */
function topicRestriction(text: string): GuardResult {
  const offTopic = OFF_TOPIC.find(([re]) => re.test(text));
  const onTopic = TRAVEL.test(text) || CITIES.test(text);
  const passed = onTopic && !offTopic;
  return {
    guard: "topic_restriction",
    passed,
    score: passed ? 0 : 1,
    explanation: passed
      ? "Request is about travel."
      : `Request is not about travel${offTopic ? ` (detected topic: ${offTopic[1]})` : ""}.`,
  };
}

const INJECTION = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /(reveal|print|show|repeat|leak) (me )?(your|the) (system )?(prompt|instructions)/i,
  /\bsystem prompt\b/i,
  /\b(you are now|act as|pretend to be)\b/i,
  /\b(jailbreak|developer mode|DAN mode)\b/i,
];

/** Heuristic prompt-injection detection (OWASP LLM01). */
function promptInjection(text: string): GuardResult {
  const hit = INJECTION.find((re) => re.test(text));
  return {
    guard: "prompt_injection",
    passed: !hit,
    score: hit ? 0.95 : 0,
    explanation: hit ? `Matched injection pattern ${hit}.` : "No injection patterns found.",
  };
}

const PII: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/, "an email address"],
  [/\b(?:\d[ -]?){13,16}\b/, "a payment card number"],
  [/(\+44\s?7\d{3}|\b07\d{3})\s?\d{3}\s?\d{3}\b/, "a UK phone number"],
  [/\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/i, "a National Insurance number"],
];

/** Sensitive information disclosure (OWASP LLM02), on the way in and on the way out. */
function pii(text: string): GuardResult {
  const hit = PII.find(([re]) => re.test(text));
  return {
    guard: "pii",
    passed: !hit,
    score: hit ? 1 : 0,
    explanation: hit ? `Found ${hit[1]}.` : "No personal data found.",
  };
}

const GUARDS: Record<Stage, ((text: string) => GuardResult)[]> = {
  preflight: [promptInjection, pii, topicRestriction],
  postflight: [pii],
};

/**
 * LAB 3 TODO: make every guardrail decision observable.
 *
 * Emit one OpenTelemetry GenAI `gen_ai.evaluation.result` event per guard result, using
 * `emitEvaluationResult` from ./telemetry. Suggested mapping:
 *
 *   name   -> `guardrail.${result.guard}`              (gen_ai.evaluation.name)
 *   score  -> result.score                              (gen_ai.evaluation.score.value)
 *   label  -> result.passed ? "pass" : "fail"          (gen_ai.evaluation.score.label)
 *   explanation -> result.explanation                   (gen_ai.evaluation.explanation)
 *   extra  -> { "travel_planner.guardrail.stage": stage,
 *               "travel_planner.guardrail.action": action }
 *
 * Semconv has no guardrail attributes yet, so stage/action live in our own
 * `travel_planner.*` namespace. The collector turns `travel_planner.guardrail.action`
 * into the `travel_planner.guardrail.decisions` metric.
 */
function recordGuardResult(stage: Stage, result: GuardResult, action: Action, ctx: Context) {
  // TODO (Lab 3): replace this console.log with an emitEvaluationResult(...) call.
  // Remember to pass `ctx` so the event is linked to the trace.
  void ctx;
  console.log(`[guardrail] ${stage} ${result.guard}: ${action}`);
}

/** Runs all guards for a stage inside a `guardrail {stage}` span. */
export function runGuardrails(stage: Stage, text: string, parent: Context = context.active()): GuardrailDecision {
  return tracer.startActiveSpan(
    `guardrail ${stage}`,
    { kind: SpanKind.INTERNAL, attributes: { "travel_planner.guardrail.stage": stage } },
    parent,
    (span) => {
      const ctx = context.active(); // the guardrail span's context
      const results = GUARDS[stage].map((guard) => guard(text));
      const denied = results.find((r) => !r.passed);

      for (const result of results) {
        const action: Action = result.passed ? "allow" : stage === "preflight" ? "deny" : "flag";
        recordGuardResult(stage, result, action, ctx);
      }

      const action: Action = !denied ? "allow" : stage === "preflight" ? "deny" : "flag";
      span.setAttribute("travel_planner.guardrail.action", action);
      if (denied) span.setAttribute("travel_planner.guardrail.denied_by", denied.guard);
      span.end();
      return { action, results, denied };
    },
  );
}
