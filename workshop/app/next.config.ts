import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Some container engines (Podman on macOS) don't pass file-change events into containers.
  // WATCHPACK_POLLING=true makes `next dev` poll for changes instead, so Lab 3 still hot-reloads.
  ...(process.env.WATCHPACK_POLLING === "true" ? { watchOptions: { pollIntervalMs: 1000 } } : {}),
  // Keep the OpenTelemetry SDK out of the bundle: it patches Node modules at runtime and
  // @opentelemetry/api must be a single shared instance so every library sees the same
  // global tracer/logger providers. (Leave `ai` and `@ai-sdk/*` bundled.)
  serverExternalPackages: [
    "@opentelemetry/api",
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-logs",
    "@opentelemetry/sdk-trace",
    "@opentelemetry/resources",
    "@opentelemetry/exporter-trace-otlp-proto",
    "@opentelemetry/exporter-logs-otlp-proto",
    "@opentelemetry/instrumentation-undici",
    "@elastic/elasticsearch",
  ],
};

export default nextConfig;
