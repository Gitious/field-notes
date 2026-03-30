import { Observation, store } from "./observations.js";

const NEXLA_WEBHOOK_URL = process.env.NEXLA_WEBHOOK_URL || "";

export interface ExportResult {
  success: boolean;
  destination: string;
  recordCount: number;
  timestamp: string;
  nexlaResponse?: any;
}

const exportHistory: ExportResult[] = [];

export async function exportToNexla(observations: Observation[], report?: string): Promise<ExportResult> {
  const timestamp = new Date().toISOString();

  if (!NEXLA_WEBHOOK_URL) {
    console.log("[Nexla] No webhook URL configured, skipping");
    return { success: false, destination: "Not configured", recordCount: 0, timestamp };
  }

  const payload = {
    title: `Field Notes Report — ${new Date().toLocaleDateString()}`,
    timestamp,
    observations_count: observations.length,
    sessions: [...new Set(observations.map(o => o.session_id))],
    categories: Object.entries(
      observations.reduce((acc, o) => { acc[o.category] = (acc[o.category] || 0) + 1; return acc; }, {} as Record<string, number>)
    ),
    report: report || null,
    observations: observations.map(o => ({
      id: o.id,
      timestamp: o.timestamp,
      session: o.session_id,
      category: o.category,
      description: o.visual_description,
      tags: o.tags.join(", "),
      confidence: o.confidence,
      web_context: o.web_enrichment?.summary || "",
      corrections: o.corrections?.join("; ") || "",
    })),
  };

  try {
    console.log(`[Nexla] Sending ${observations.length} observations to webhook...`);
    const res = await fetch(NEXLA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log(`[Nexla] Response:`, JSON.stringify(data));

    const result: ExportResult = {
      success: !!data.processed,
      destination: "Google Drive via Nexla",
      recordCount: observations.length,
      timestamp,
      nexlaResponse: data,
    };

    exportHistory.push(result);
    store.logActivity(observations[0]?.session_id || "export", "export", `Exported ${observations.length} observations to Nexla → Google Drive`);
    return result;
  } catch (err) {
    console.error("[Nexla] Export error:", err);
    const result: ExportResult = { success: false, destination: "Nexla (error)", recordCount: 0, timestamp };
    exportHistory.push(result);
    return result;
  }
}

export function getExportHistory(): ExportResult[] {
  return [...exportHistory];
}

export function setupAutoExport() {
  store.onExportThreshold(async (observations) => {
    console.log(`[Nexla] Auto-export triggered (${observations.length} observations)`);
    await exportToNexla(observations);
  });
  console.log(`[Nexla] Auto-export listener active (threshold: 10 observations)${NEXLA_WEBHOOK_URL ? " — webhook configured" : " — NO webhook URL"}`);
}
