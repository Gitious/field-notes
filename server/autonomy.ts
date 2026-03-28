import { store, Observation } from "./observations.js";
import { setupAutoEnrichment } from "./tavily.js";
import { setupSensoSync } from "./senso.js";
import { setupAutoExport } from "./nexla.js";

// Pattern detection — runs after each observation
function detectPatterns(obs: Observation) {
  const all = store.getAll();
  if (all.length < 3) return;

  // Check for category clustering
  const categories = store.getCategories();
  for (const [cat, count] of Object.entries(categories)) {
    if (count === 3 || count === 5 || count === 10) {
      const patternNote = `Pattern detected: ${count} observations in category "${cat}"`;
      console.log(`[Autonomy] ${patternNote}`);
      // Add pattern note to the latest observation in that category
      const latest = all.filter((o) => o.category === cat).pop();
      if (latest && !latest.pattern_note) {
        store.update(latest.id, { pattern_note: patternNote });
      }
    }
  }

  // Check for tag frequency
  const tagCounts: Record<string, number> = {};
  for (const o of all) {
    for (const tag of o.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  for (const [tag, count] of Object.entries(tagCounts)) {
    if (count === 3) {
      console.log(`[Autonomy] Recurring tag: "${tag}" seen ${count} times`);
    }
  }
}

export function setupAutonomy() {
  console.log("[Autonomy] Initializing autonomous behaviors...");

  // 1. Auto-enrichment via Tavily
  setupAutoEnrichment();

  // 2. Auto-sync to Senso
  setupSensoSync();

  // 3. Auto-export via Nexla
  setupAutoExport();

  // 4. Pattern detection
  store.onNewObservation((obs) => {
    detectPatterns(obs);
  });

  console.log("[Autonomy] All autonomous behaviors active:");
  console.log("  - Tavily auto-enrichment (on needs_web_enrichment)");
  console.log("  - Senso auto-sync (every observation)");
  console.log("  - Nexla auto-export (every 10 observations)");
  console.log("  - Pattern detection (every observation)");
}
