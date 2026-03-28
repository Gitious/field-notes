// In dev, Vite proxies /api and /ws to the backend.
// In production or when accessing from phone, use the explicit backend URL.
const API_BASE = import.meta.env.VITE_API_URL || "";

export interface WebEnrichment {
  source: string;
  summary: string;
  url: string;
}

export interface Observation {
  id: string;
  timestamp: string;
  session_id: string;
  visual_description: string;
  audio_context?: string;
  category: string;
  tags: string[];
  confidence: number;
  web_enrichment?: WebEnrichment;
  corrections?: string[];
  senso_content_id?: string;
  pattern_note?: string;
}

export interface Stats {
  totalObservations: number;
  sessions: number;
  categories: Record<string, number>;
  exports: any[];
}

export async function fetchObservations(): Promise<Observation[]> {
  const res = await fetch(`${API_BASE}/api/observations`);
  return res.json();
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${API_BASE}/api/stats`);
  return res.json();
}

export async function queryObservations(question: string): Promise<{ answer: string; observations: Observation[] }> {
  const res = await fetch(`${API_BASE}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  return res.json();
}

export async function correctObservation(id: string, correction: string): Promise<Observation> {
  const res = await fetch(`${API_BASE}/api/observations/${id}/correct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correction }),
  });
  return res.json();
}

export async function triggerExport(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/export`, { method: "POST" });
  return res.json();
}

export function getWsUrl(mode: "camera" | "dashboard", sessionId?: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  if (mode === "camera") {
    return `${proto}//${host}/ws?mode=camera&session=${sessionId || `session_${Date.now()}`}`;
  }
  return `${proto}//${host}/ws?mode=dashboard`;
}
