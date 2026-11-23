// Liveness probe for docker compose. Its spans are dropped by the collector (filter/next_internals).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
