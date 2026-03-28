import { Observation, store } from "./observations.js";

// Nexla Express.Dev export
// In production: use Express.Dev API or MCP server
// For hackathon: we simulate the export and show it in UI

export interface ExportResult {
  success: boolean;
  destination: string;
  recordCount: number;
  timestamp: string;
  exportUrl?: string;
}

const exportHistory: ExportResult[] = [];

export async function exportToNexla(observations: Observation[]): Promise<ExportResult> {
  console.log(`[Nexla] Exporting ${observations.length} observations...`);

  // Format observations as structured data for export
  const exportData = observations.map((obs) => ({
    id: obs.id,
    timestamp: obs.timestamp,
    session: obs.session_id,
    description: obs.visual_description,
    category: obs.category,
    tags: obs.tags.join(", "),
    confidence: obs.confidence,
    web_context: obs.web_enrichment?.summary || "",
    web_url: obs.web_enrichment?.url || "",
    corrections: obs.corrections?.join("; ") || "",
  }));

  // TODO: Replace with actual Nexla Express.Dev API call when credentials are available
  // For now, create a structured export that demonstrates the integration
  const result: ExportResult = {
    success: true,
    destination: "Google Drive → Field Notes Observations",
    recordCount: exportData.length,
    timestamp: new Date().toISOString(),
    exportUrl: `https://express.dev/exports/${Date.now()}`,
  };

  exportHistory.push(result);
  console.log(`[Nexla] Export complete: ${result.recordCount} records → ${result.destination}`);

  return result;
}

export function getExportHistory(): ExportResult[] {
  return [...exportHistory];
}

export function setupAutoExport() {
  store.onExportThreshold(async (observations) => {
    console.log(`[Nexla] Auto-export triggered (${observations.length} observations)`);
    await exportToNexla(observations);
  });
  console.log("[Nexla] Auto-export listener active (threshold: 10 observations)");
}
