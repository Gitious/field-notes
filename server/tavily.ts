import { Observation, store } from "./observations.js";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

export async function enrichObservation(obs: Observation): Promise<void> {
  if (!obs.needs_web_enrichment || !obs.enrichment_query) return;
  if (!TAVILY_API_KEY) {
    console.log("[Tavily] No API key, skipping enrichment");
    return;
  }

  try {
    console.log(`[Tavily] Searching: "${obs.enrichment_query}"`);
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query: obs.enrichment_query,
        max_results: 3,
        search_depth: "basic",
        include_answer: true,
      }),
    });

    if (!res.ok) {
      console.error(`[Tavily] HTTP ${res.status}`);
      return;
    }

    const data = await res.json();
    const topResult = data.results?.[0];

    if (topResult) {
      store.update(obs.id, {
        web_enrichment: {
          source: topResult.title || "Web",
          summary: data.answer || topResult.content?.slice(0, 300) || "",
          url: topResult.url || "",
        },
        needs_web_enrichment: false,
      });
      console.log(`[Tavily] Enriched observation ${obs.id} with: ${topResult.title}`);
    }
  } catch (err) {
    console.error("[Tavily] Error:", err);
  }
}

export function setupAutoEnrichment() {
  store.onNewObservation(async (obs) => {
    if (obs.needs_web_enrichment) {
      // Small delay to not overwhelm the API
      setTimeout(() => enrichObservation(obs), 500);
    }
  });
  console.log("[Tavily] Auto-enrichment listener active");
}
