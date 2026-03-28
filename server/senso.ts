import { Observation, store } from "./observations.js";
import crypto from "crypto";

const SENSO_API_KEY = process.env.SENSO_API_KEY || "";
const SENSO_BASE = "https://apiv2.senso.ai/api/v1/org";

async function sensoFetch(path: string, options: RequestInit = {}) {
  if (!SENSO_API_KEY) return null;

  const res = await fetch(`${SENSO_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": SENSO_API_KEY,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Senso] HTTP ${res.status}: ${text.slice(0, 100)}`);
    return null;
  }

  return res.json();
}

// Store observation as a text file via S3 presigned upload
export async function storeObservation(obs: Observation): Promise<string | null> {
  if (!SENSO_API_KEY) return null;

  const content = `# Observation: ${obs.category}
Time: ${obs.timestamp}
Session: ${obs.session_id}
Confidence: ${obs.confidence}

${obs.visual_description}

Tags: ${obs.tags.join(", ")}
${obs.web_enrichment ? `\nWeb Context: ${obs.web_enrichment.summary}\nSource: ${obs.web_enrichment.url}` : ""}
${obs.corrections?.length ? `\nCorrections: ${obs.corrections.join("; ")}` : ""}`;

  const filename = `observation-${obs.id.slice(0, 8)}.txt`;
  const contentBuffer = Buffer.from(content, "utf-8");
  const contentHash = crypto.createHash("md5").update(contentBuffer).digest("hex");

  try {
    // Step 1: Get presigned upload URL
    const uploadRes = await sensoFetch("/kb/upload", {
      method: "POST",
      body: JSON.stringify({
        files: [{
          filename,
          file_size_bytes: contentBuffer.length,
          content_type: "text/plain",
          content_hash_md5: contentHash,
        }],
      }),
    });

    // Log the full response so we can see the actual shape
    console.log("[Senso] Upload response:", JSON.stringify(uploadRes, null, 2));

    // Try every possible response shape
    const fileResult = uploadRes?.results?.[0] || uploadRes?.files?.[0] || uploadRes?.data?.[0] || uploadRes;
    const uploadUrl = fileResult?.upload_url || fileResult?.presigned_url || fileResult?.url;
    const contentId = fileResult?.content_id || fileResult?.id || fileResult?.file_id;

    if (!uploadUrl) {
      console.error("[Senso] No upload URL found in response");
      return null;
    }

    // Step 2: PUT file to S3
    const s3Res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: contentBuffer,
    });

    if (!s3Res.ok) {
      console.error(`[Senso] S3 upload failed: ${s3Res.status}`);
      return null;
    }

    console.log(`[Senso] Stored observation ${obs.id.slice(0, 8)} → content_id: ${contentId}`);
    store.update(obs.id, { senso_content_id: contentId || "uploaded" });
    store.logActivity(obs.session_id, "enrichment", `Synced to Senso: ${obs.visual_description.slice(0, 50)}`);
    return contentId;
  } catch (err) {
    console.error("[Senso] Store error:", err);
    return null;
  }
}

// Search Senso knowledge base
export async function searchObservations(query: string): Promise<any> {
  if (!SENSO_API_KEY) return null;

  try {
    const data = await sensoFetch("/search", {
      method: "POST",
      body: JSON.stringify({ query }),
    });
    console.log(`[Senso] Search "${query}" → ${data?.total_results || 0} results`);
    return data;
  } catch (err) {
    console.error("[Senso] Search error:", err);
    return null;
  }
}

export function setupSensoSync() {
  if (!SENSO_API_KEY) {
    console.log("[Senso] No API key, skipping sync");
    return;
  }

  store.onNewObservation(async (obs) => {
    // Store in Senso after a delay (let enrichment happen first)
    setTimeout(() => storeObservation(obs), 3000);
  });
  console.log("[Senso] Auto-sync active (S3 upload flow)");
}
