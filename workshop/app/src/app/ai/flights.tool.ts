import { tool } from "ai";
import { z } from "zod";

import { Flight } from "../model/flight.model";
import { client, flightIndex } from "../util/elasticsearch";

type Hits = { hits?: { hits?: { _source: Flight }[] } };

const flights = (response: Hits): Flight[] => (response.hits?.hits ?? []).map((h) => h._source);

const leg = (origin: string, destination: string, size: number) => ({
  query: {
    bool: {
      filter: [
        { match: { origin } },
        { match: { destination } },
        { range: { departure_date: { gte: "now" } } },
      ],
    },
  },
  sort: [{ departure_date: "asc" as const }],
  size,
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** The first return flight at least two days after the outbound one (else the first one after it). */
function returnFlight(outbound: Flight | undefined, candidates: Flight[]): Flight | undefined {
  if (!outbound) return candidates[0];
  const departs = new Date(outbound.departure_date).getTime();
  const after = (gap: number) => candidates.find((f) => new Date(f.departure_date).getTime() >= departs + gap);
  return after(2 * DAY_MS) ?? after(1);
}

export const flightTool = tool({
  description: "Get the next outbound and return flights for a destination from Elasticsearch",
  inputSchema: z.object({
    destination: z.string().describe("The destination city we are flying to, e.g. Amsterdam"),
    origin: z.string().describe("The origin city we are flying from").default("London"),
  }),
  outputSchema: z.object({
    outbound: z.unknown().optional().describe("Outbound flight"),
    inbound: z.unknown().optional().describe("Return flight"),
    message: z.string().optional().describe("Error message if flights are unavailable"),
  }),
  execute: async ({ destination, origin }) => {
    try {
      const { responses } = await client.msearch({
        searches: [{ index: flightIndex }, leg(origin, destination, 1), { index: flightIndex }, leg(destination, origin, 20)],
      });
      const outbound = flights(responses[0] as Hits)[0];
      return { outbound, inbound: returnFlight(outbound, flights(responses[1] as Hits)) };
    } catch (e) {
      console.error(e);
      return { message: "Unable to obtain flight information" };
    }
  },
});
