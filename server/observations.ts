import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");
const OBS_FILE = path.join(DATA_DIR, "observations.json");
const LOG_FILE = path.join(DATA_DIR, "activity-log.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
  needs_web_enrichment?: boolean;
  enrichment_query?: string;
  pattern_note?: string;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  session_id: string;
  type: "session_start" | "session_end" | "ai_spoke" | "observation" | "export" | "enrichment" | "correction";
  summary: string;
}

class ObservationStore {
  private observations: Observation[] = [];
  private activityLog: ActivityEvent[] = [];
  private listeners: ((obs: Observation) => void)[] = [];
  private exportListeners: ((observations: Observation[]) => void)[] = [];
  private exportThreshold = 10;
  private lastExportCount = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromDisk();
  }

  // ─── Persistence ───

  private loadFromDisk() {
    try {
      if (fs.existsSync(OBS_FILE)) {
        this.observations = JSON.parse(fs.readFileSync(OBS_FILE, "utf-8"));
        console.log(`[Store] Loaded ${this.observations.length} observations from disk`);
      }
    } catch (err) {
      console.error("[Store] Failed to load observations:", err);
    }
    try {
      if (fs.existsSync(LOG_FILE)) {
        this.activityLog = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
        console.log(`[Store] Loaded ${this.activityLog.length} activity events from disk`);
      }
    } catch (err) {
      console.error("[Store] Failed to load activity log:", err);
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return; // Already scheduled
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.writeFileSync(OBS_FILE, JSON.stringify(this.observations, null, 2));
        fs.writeFileSync(LOG_FILE, JSON.stringify(this.activityLog, null, 2));
      } catch (err) {
        console.error("[Store] Save error:", err);
      }
    }, 1000); // Debounce saves to 1s
  }

  // ─── Observations ───

  add(partial: Omit<Observation, "id" | "timestamp">): Observation {
    const obs: Observation = {
      ...partial,
      id: uuid(),
      timestamp: new Date().toISOString(),
    };
    this.observations.push(obs);
    console.log(
      `[Store] Added: "${obs.visual_description.slice(0, 60)}..." (${obs.category}) [${this.observations.length} total]`
    );

    // Log activity
    this.logActivity(obs.session_id, "observation", obs.visual_description.slice(0, 100));

    // Notify listeners
    for (const fn of this.listeners) fn(obs);

    // Check export threshold
    if (
      this.observations.length >= this.exportThreshold &&
      this.observations.length - this.lastExportCount >= this.exportThreshold
    ) {
      this.lastExportCount = this.observations.length;
      for (const fn of this.exportListeners) fn(this.observations);
    }

    this.scheduleSave();
    return obs;
  }

  getAll(): Observation[] {
    return [...this.observations];
  }

  getBySession(sessionId: string): Observation[] {
    return this.observations.filter((o) => o.session_id === sessionId);
  }

  getById(id: string): Observation | undefined {
    return this.observations.find((o) => o.id === id);
  }

  update(id: string, updates: Partial<Observation>): Observation | undefined {
    const idx = this.observations.findIndex((o) => o.id === id);
    if (idx === -1) return undefined;
    this.observations[idx] = { ...this.observations[idx], ...updates };
    this.scheduleSave();
    return this.observations[idx];
  }

  addCorrection(id: string, correction: string): Observation | undefined {
    const obs = this.getById(id);
    if (!obs) return undefined;
    obs.corrections = obs.corrections || [];
    obs.corrections.push(correction);
    this.logActivity(obs.session_id, "correction", `Corrected: ${correction}`);
    this.scheduleSave();
    return obs;
  }

  getSessions(): string[] {
    return [...new Set(this.observations.map((o) => o.session_id))];
  }

  getCategories(): Record<string, number> {
    const cats: Record<string, number> = {};
    for (const o of this.observations) {
      cats[o.category] = (cats[o.category] || 0) + 1;
    }
    return cats;
  }

  onNewObservation(fn: (obs: Observation) => void) {
    this.listeners.push(fn);
  }

  onExportThreshold(fn: (observations: Observation[]) => void) {
    this.exportListeners.push(fn);
  }

  count(): number {
    return this.observations.length;
  }

  getCorrections(): string[] {
    return this.observations
      .filter((o) => o.corrections && o.corrections.length > 0)
      .flatMap((o) =>
        o.corrections!.map((c) => `For "${o.visual_description}": ${c}`)
      );
  }

  // ─── Activity Log ───

  logActivity(sessionId: string, type: ActivityEvent["type"], summary: string) {
    this.activityLog.push({
      id: uuid(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      type,
      summary,
    });
    this.scheduleSave();
  }

  getActivityLog(sessionId?: string): ActivityEvent[] {
    if (sessionId) return this.activityLog.filter((e) => e.session_id === sessionId);
    return [...this.activityLog];
  }

  getFullContext(): string {
    const obs = this.observations;
    const log = this.activityLog;
    const sessions = this.getSessions();

    let context = `=== FIELD NOTES KNOWLEDGE BASE ===\n`;
    context += `Total observations: ${obs.length}\n`;
    context += `Sessions: ${sessions.length}\n`;
    context += `Categories: ${JSON.stringify(this.getCategories())}\n\n`;

    for (const sid of sessions) {
      const sessionObs = obs.filter((o) => o.session_id === sid);
      const sessionLog = log.filter((e) => e.session_id === sid);
      context += `--- Session: ${sid} (${sessionObs.length} observations) ---\n`;

      // Merge observations and activity chronologically
      const events = [
        ...sessionObs.map((o) => ({
          time: o.timestamp,
          text: `[OBS] ${o.category}: ${o.visual_description}${o.web_enrichment ? ` | Web: ${o.web_enrichment.summary}` : ""}${o.corrections?.length ? ` | Corrections: ${o.corrections.join(", ")}` : ""}`,
        })),
        ...sessionLog
          .filter((e) => e.type === "session_start" || e.type === "session_end") // Only include session boundaries, not internal events
          .map((e) => ({ time: e.timestamp, text: `[${e.type.toUpperCase()}] ${e.summary}` })),
      ].sort((a, b) => a.time.localeCompare(b.time));

      for (const ev of events) {
        context += `  ${ev.time} ${ev.text}\n`;
      }
      context += "\n";
    }

    return context;
  }
}

export const store = new ObservationStore();
