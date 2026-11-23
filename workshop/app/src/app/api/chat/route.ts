import { context } from "@opentelemetry/api";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";

import { fcdoTool } from "@/app/ai/fcdo.tool";
import { flightTool } from "@/app/ai/flights.tool";
import { weatherTool } from "@/app/ai/weather.tool";
import { evaluateResponse } from "@/app/lib/evals";
import { runGuardrails } from "@/app/lib/guardrails";
import { model } from "@/app/lib/llm";
import { withConversation } from "@/app/lib/telemetry";

export const maxDuration = 30;

// Tool keys matter: page.tsx renders `tool-flights`, `tool-weather` and `tool-fcdo` parts.
const tools = {
  flights: flightTool,
  weather: weatherTool,
  fcdo: fcdoTool,
};

const SYSTEM_PROMPT = `You are a helpful assistant that returns travel itineraries for trips from London.
Always call the fcdo tool (UK travel advice), the weather tool and the flights tool for the destination.
Use the flights tool results only to recommend possible flights in the itinerary.
Return a short day-by-day itinerary of sights to see and things to do, adapted to the weather result.
If the fcdo tool advises against travel, DO NOT recommend things to do, and explain why.`;

// LLM-as-a-judge costs tokens on every request. In production you would sample.
const EVAL_SAMPLE_RATE = Number(process.env.EVAL_SAMPLE_RATE ?? "1");

const lastUserText = (messages: UIMessage[]) =>
  (messages.at(-1)?.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();

export async function POST(req: Request) {
  const { messages, id } = (await req.json()) as { messages: UIMessage[]; id: string };
  const userText = lastUserText(messages);

  // Everything below runs in this context: the HTTP request span plus a baggage entry
  // that stamps gen_ai.conversation.id onto every span (see instrumentation.node.ts).
  const ctx = withConversation(context.active(), id);

  return context.with(ctx, async () => {
    // 1. Preflight guardrails: block before we spend a single token.
    const preflight = runGuardrails("preflight", userText, ctx);
    if (preflight.action === "deny") {
      return NextResponse.json(
        {
          code: "guardrail_denied",
          message:
            "I'm sorry, I can only help with travel-related queries. Please ask me about flights, destinations, weather, or itineraries.",
          explanation: preflight.denied?.explanation,
          guard: preflight.denied?.guard,
        },
        { status: 400 },
      );
    }

    try {
      // 2. The agent: an LLM call that may call tools, up to 3 steps.
      const result = streamText({
        model,
        instructions: SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages),
        tools,
        stopWhen: isStepCount(3),
        telemetry: { functionId: "travel-planner" },
        onEnd: async ({ text, steps, finalStep }) => {
          // 3. Postflight guardrails on the model's answer (flag, don't block).
          runGuardrails("postflight", text, ctx);

          // 4. LLM-as-a-judge, fire-and-forget so the user isn't kept waiting.
          if (Math.random() < EVAL_SAMPLE_RATE) {
            const toolResults = steps.flatMap((step) =>
              step.content.filter((c) => c.type === "tool-result").map((c) => JSON.stringify(c.output)),
            );
            void evaluateResponse({
              userRequest: userText,
              response: text,
              toolResults,
              responseId: finalStep.response?.id,
              ctx,
            }).catch((e) => console.warn(`[evals] judge failed: ${e instanceof Error ? e.message : e}`));
          }
        },
      });

      return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
    } catch (e) {
      console.error(e);
      return NextResponse.json(
        { code: "internal_error", message: "Unable to generate a plan. Please try again later!" },
        { status: 500 },
      );
    }
  });
}
