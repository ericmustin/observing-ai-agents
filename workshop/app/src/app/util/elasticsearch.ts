import { Client } from "@elastic/elasticsearch";

export const flightIndex = "upcoming-flight-data";

// The Elasticsearch client emits OpenTelemetry spans natively (no instrumentation needed),
// so every flight search shows up as a child of the `flights` tool call.
export const client = new Client({
  node: process.env.ELASTICSEARCH_URL ?? "http://elasticsearch:9200",
  auth: {
    username: process.env.ELASTICSEARCH_USER ?? "elastic",
    password: process.env.ELASTICSEARCH_PASSWORD ?? "changeme",
  },
});
