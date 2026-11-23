import { createOpenAI } from "@ai-sdk/openai";

/**
 * One OpenAI-compatible client for everything (agent + judge).
 *  - LLM_MODE=live: any OpenAI-compatible endpoint (Ollama, OpenAI, LiteLLM, Azure v1, ...)
 *  - LLM_MODE=mock: the bundled offline mock LLM
 */
const mode = process.env.LLM_MODE === "live" ? "live" : "mock";

const provider = createOpenAI(
  mode === "live"
    ? { baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY }
    : { baseURL: process.env.MOCK_LLM_URL ?? "http://mock-llm:8080/v1", apiKey: "mock" },
);

// The mock always answers as gpt-4o-mini, so switching back from a live model only needs LLM_MODE=mock.
export const modelId = mode === "live" ? (process.env.LLM_MODEL ?? "gpt-4o-mini") : "gpt-4o-mini";

// .chat() = Chat Completions API: the most widely supported OpenAI-compatible surface.
export const model = provider.chat(modelId);
