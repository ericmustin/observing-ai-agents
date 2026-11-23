import { tool } from "ai";
import { z } from "zod";

import { ADVISORY } from "../fixtures/travel";
import { FCDOResponse } from "../model/fcdo.model";

const offline = () => process.env.TOOLS_MODE === "offline";

export const fcdoTool = tool({
  description: "Display the UK FCDO travel advice for a destination country",
  inputSchema: z.object({
    country: z
      .string()
      .describe("The destination country as a GOV.UK slug, e.g. netherlands, spain, usa, czech-republic"),
  }),
  outputSchema: z.object({
    country: z.string(),
    status: z.string().optional().describe("The current FCDO alert status"),
    url: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async ({ country }) => {
    const slug = country.toLowerCase().trim().replace(/\s+/g, "-");
    const url = `https://www.gov.uk/foreign-travel-advice/${slug}`;
    if (!offline()) {
      try {
        const res = await fetch(`https://www.gov.uk/api/content/foreign-travel-advice/${slug}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) throw new Error(`GOV.UK returned ${res.status}`);
        const body: FCDOResponse = await res.json();
        const status = body.details.alert_status.length === 0 ? "OK" : body.details.alert_status[0].replaceAll("_", " ");
        return { country: slug, status, url };
      } catch (e) {
        console.warn(`fcdo: live lookup failed, using fixture (${e})`);
      }
    }
    const status = ADVISORY[slug];
    return status ? { country: slug, status, url } : { country: slug, message: "Unable to obtain FCDO information" };
  },
});
