// Offline fixtures, used when TOOLS_MODE=offline or when a live API call fails.

export const ADVISORY: Record<string, string> = {
  netherlands: "OK", germany: "OK", ireland: "OK", spain: "OK", france: "OK",
  "czech-republic": "OK", poland: "OK", usa: "OK", australia: "OK", brazil: "OK",
  mauritius: "OK", italy: "OK", portugal: "OK", japan: "OK",
  iran: "avoid all travel",
};

export const WEATHER: Record<string, { temperature: number; feels: number; humidity: number; code: number }> = {
  amsterdam: { temperature: 11, feels: 8, humidity: 81, code: 3 },
  berlin: { temperature: 9, feels: 6, humidity: 74, code: 2 },
  munich: { temperature: 8, feels: 5, humidity: 70, code: 1 },
  dublin: { temperature: 10, feels: 7, humidity: 85, code: 61 },
  barcelona: { temperature: 19, feels: 19, humidity: 60, code: 0 },
  madrid: { temperature: 16, feels: 15, humidity: 45, code: 0 },
  paris: { temperature: 12, feels: 10, humidity: 77, code: 3 },
  prague: { temperature: 7, feels: 4, humidity: 79, code: 45 },
  warsaw: { temperature: 6, feels: 2, humidity: 83, code: 3 },
  "new york": { temperature: 13, feels: 11, humidity: 58, code: 1 },
  sydney: { temperature: 24, feels: 25, humidity: 64, code: 0 },
};

/** WMO weather interpretation codes (used by Open-Meteo) -> text + emoji */
export function describeWeatherCode(code: number): { condition: string; emoji: string } {
  if (code === 0) return { condition: "Clear sky", emoji: "☀️" };
  if (code <= 2) return { condition: "Partly cloudy", emoji: "⛅" };
  if (code === 3) return { condition: "Overcast", emoji: "☁️" };
  if (code <= 48) return { condition: "Fog", emoji: "🌫️" };
  if (code <= 67) return { condition: "Rain", emoji: "🌧️" };
  if (code <= 77) return { condition: "Snow", emoji: "🌨️" };
  if (code <= 82) return { condition: "Rain showers", emoji: "🌦️" };
  return { condition: "Thunderstorm", emoji: "⛈️" };
}
