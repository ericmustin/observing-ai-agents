/**
 * Loads ~90 days of synthetic flights into Elasticsearch. Idempotent: drops and recreates the index.
 * Run with `npm run ingest` (the `flights-loader` compose service does this for you).
 */
import { Client } from "@elastic/elasticsearch";

import { LOCATIONS, type Flight, type Location } from "../src/app/model/flight.model";

const index = "upcoming-flight-data";
const client = new Client({
  node: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
  auth: {
    username: process.env.ELASTICSEARCH_USER ?? "elastic",
    password: process.env.ELASTICSEARCH_PASSWORD ?? "changeme",
  },
});

const AIRLINES = ["Elastic Air", "Kibana Airways", "Beats Jet", "Logstash Express"];
const LONG_HAUL = new Set<Location>(["Mauritius", "New York", "Las Vegas", "Seattle", "Sao Paulo", "Sydney", "Iran"]);
const DAY = 24 * 60 * 60 * 1000;
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

function flight(origin: Location, destination: Location): Flight {
  const longHaul = LONG_HAUL.has(origin) || LONG_HAUL.has(destination);
  const departure = new Date(Date.now() + (0.1 + Math.random() * 89.9) * DAY);
  departure.setUTCMinutes(Math.floor(Math.random() * 12) * 5, 0, 0);
  return {
    origin,
    destination,
    airline: pick(AIRLINES),
    flight_number: `ES${100 + Math.floor(Math.random() * 9000)}`,
    departure_date: departure,
    currency: "GBP",
    price: Math.round(longHaul ? 350 + Math.random() * 900 : 40 + Math.random() * 260),
  };
}

function* flights(): Generator<Flight> {
  // Every destination gets plenty of flights to and from London (the demo's home airport)...
  for (const city of LOCATIONS) {
    if (city === "London") continue;
    for (let i = 0; i < 40; i++) {
      yield flight("London", city);
      yield flight(city, "London");
    }
  }
  // ...plus some random point-to-point routes.
  for (let i = 0; i < 1500; i++) {
    const origin = pick(LOCATIONS);
    const destination = pick(LOCATIONS.filter((l) => l !== origin));
    yield flight(origin, destination);
  }
}

async function main() {
  await client.indices.delete({ index, ignore_unavailable: true });
  await client.indices.create({
    index,
    settings: {
      number_of_replicas: 0,
      analysis: { normalizer: { lowercase: { type: "custom", filter: ["lowercase", "asciifolding"] } } },
    },
    mappings: {
      properties: {
        origin: { type: "keyword", normalizer: "lowercase" },
        destination: { type: "keyword", normalizer: "lowercase" },
        airline: { type: "keyword" },
        flight_number: { type: "keyword" },
        departure_date: { type: "date" },
        currency: { type: "keyword" },
        price: { type: "float" },
      },
    },
  });

  const result = await client.helpers.bulk({
    datasource: [...flights()],
    onDocument: () => ({ index: { _index: index } }),
    refreshOnCompletion: index,
  });
  console.log(`Indexed ${result.successful} flights into ${index} (${result.failed} failed)`);
  if (result.failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
