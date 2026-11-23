import { tool } from "ai";
import { z } from "zod";

import { describeWeatherCode, WEATHER } from "../fixtures/travel";

const offline = () => process.env.TOOLS_MODE === "offline";

async function liveWeather(location: string) {
  // Open-Meteo: free, no API key. Two HTTP calls -> two child spans in your trace.
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(location)}`,
    { signal: AbortSignal.timeout(4000) },
  ).then((r) => r.json());
  const place = geo.results?.[0];
  if (!place) throw new Error(`Unknown location ${location}`);

  const forecast = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code`,
    { signal: AbortSignal.timeout(4000) },
  ).then((r) => r.json());
  const c = forecast.current;
  return { temperature: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, code: c.weather_code };
}

export const weatherTool = tool({
  description: "Display the current weather for a holiday location",
  inputSchema: z.object({
    location: z.string().describe("The city to get the weather for, e.g. Amsterdam"),
  }),
  outputSchema: z.object({
    location: z.string(),
    condition: z.string().optional(),
    condition_emoji: z.string().optional(),
    temperature: z.number().optional().describe("Current temperature in Celsius"),
    feels_like_temperature: z.number().optional(),
    humidity: z.number().optional(),
    message: z.string().optional(),
  }),
  execute: async ({ location }) => {
    let w = WEATHER[location.toLowerCase()];
    if (!offline()) {
      try {
        w = await liveWeather(location);
      } catch (e) {
        console.warn(`weather: live lookup failed, using fixture (${e})`);
      }
    }
    if (!w) return { location, message: "Unable to obtain weather information" };
    const { condition, emoji } = describeWeatherCode(w.code);
    return {
      location,
      condition,
      condition_emoji: emoji,
      temperature: Math.round(w.temperature),
      feels_like_temperature: Math.round(w.feels),
      humidity: Math.round(w.humidity),
    };
  },
});
