// Next.js calls register() once per server process, before any route code runs.
// https://nextjs.org/docs/app/guides/open-telemetry
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
