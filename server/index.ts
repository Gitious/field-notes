import "dotenv/config";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import WsWebSocket from "ws";
import http from "http";
import path from "path";
import { queryObservations, analyzeFrame } from "./gemini.js";
import { store } from "./observations.js";
import { exportToNexla, getExportHistory } from "./nexla.js";
import { searchObservations, storeObservation } from "./senso.js";
import { setupAutonomy } from "./autonomy.js";

const PORT = parseInt(process.env.PORT || "3001");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_LIVE_MODEL = "models/gemini-3.1-flash-live-preview";
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

const LIVE_SYSTEM_PROMPT = `You are an autonomous AI field research agent at a hackathon. You see the world through a live camera feed and hear the user.

CRITICAL — AUTONOMOUS OBSERVATION:
- You have a tool called log_observation. Call it AUTONOMOUSLY whenever you see something new or interesting — do NOT wait for the user to ask.
- Call log_observation every 10-15 seconds if the scene has changed at all.
- Observe EVERYTHING: people, screens, projects, text, logos, food, furniture, signs, presentations, equipment.
- If you see a brand or logo, set needs_web_enrichment=true with a search query.
- Don't log the same thing twice — only log when the scene changes.

CONVERSATION:
- While logging observations, maintain natural audio conversation with the user.
- Comment on interesting things you see. Ask questions. Be enthusiastic.
- If the user asks "what do you see?", describe the current view AND call log_observation.
- If you can't understand them, say "I didn't quite catch that."
- Keep responses to 1-2 sentences so conversation flows naturally.

You are at a hackathon in San Francisco. Be an excited, observant field researcher.`;

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);

// ─── REST API ───

app.post("/api/analyze", async (req, res) => {
  const { frame, session_id } = req.body;
  console.log(`[API] /analyze called, frame size: ${frame?.length || 0} chars, session: ${session_id}`);
  if (!frame) return res.status(400).json({ error: "frame required" });
  const result = await analyzeFrame(frame, session_id || `session_${Date.now()}`);
  res.json(result || { observation: null });
});

app.post("/api/observations", (req, res) => {
  const obs = store.add({
    session_id: req.body.session_id || `session_${Date.now()}`,
    visual_description: req.body.visual_description || "",
    category: req.body.category || "uncategorized",
    tags: req.body.tags || [],
    confidence: req.body.confidence || 0.5,
    needs_web_enrichment: req.body.needs_web_enrichment || false,
    enrichment_query: req.body.enrichment_query,
  });
  res.json(obs);
});

app.get("/api/observations", (_req, res) => res.json(store.getAll()));
app.get("/api/sessions", (_req, res) => res.json(store.getSessions()));
app.get("/api/categories", (_req, res) => res.json(store.getCategories()));

app.get("/api/stats", (_req, res) => {
  res.json({
    totalObservations: store.count(),
    sessions: store.getSessions().length,
    categories: store.getCategories(),
    exports: getExportHistory(),
  });
});

app.post("/api/query", async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "question is required" });
  const answer = await queryObservations(question);
  res.json({ answer, observations: store.getAll() });
});

app.post("/api/observations/:id/correct", (req, res) => {
  const { correction } = req.body;
  if (!correction) return res.status(400).json({ error: "correction is required" });
  const obs = store.addCorrection(req.params.id, correction);
  if (!obs) return res.status(404).json({ error: "not found" });
  res.json(obs);
});

app.post("/api/export", async (_req, res) => {
  const result = await exportToNexla(store.getAll());
  res.json(result);
});

app.get("/api/exports", (_req, res) => res.json(getExportHistory()));

// Activity log
app.get("/api/activity", (req, res) => {
  const sessionId = req.query.session as string | undefined;
  res.json(store.getActivityLog(sessionId));
});

// Full context dump (for debugging / Nexla export)
app.get("/api/context", (_req, res) => {
  res.type("text/plain").send(store.getFullContext());
});

// Download observations as CSV (for Nexla Express.Dev demo)
app.get("/api/export/csv", (_req, res) => {
  const obs = store.getAll();
  const header = "id,timestamp,session,category,description,tags,confidence,web_context,web_url,corrections\n";
  const rows = obs.map(o => [
    o.id,
    o.timestamp,
    o.session_id,
    o.category,
    `"${(o.visual_description || "").replace(/"/g, '""')}"`,
    `"${o.tags.join(", ")}"`,
    o.confidence,
    `"${(o.web_enrichment?.summary || "").replace(/"/g, '""')}"`,
    o.web_enrichment?.url || "",
    `"${(o.corrections?.join("; ") || "").replace(/"/g, '""')}"`,
  ].join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=field-notes-observations.csv");
  res.send(header + rows);
});

// Generate field research report
app.post("/api/report", async (_req, res) => {
  const observations = store.getAll();
  if (observations.length === 0) {
    return res.json({ report: "No observations collected yet." });
  }

  const obsText = observations.map((o, i) =>
    `${i+1}. [${o.category}] ${o.visual_description} (confidence: ${o.confidence}, tags: ${o.tags.join(", ")})${o.web_enrichment ? ` — Web: ${o.web_enrichment.summary}` : ""}${o.corrections?.length ? ` — Corrections: ${o.corrections.join(", ")}` : ""}`
  ).join("\n");

  const categories = store.getCategories();
  const activity = store.getActivityLog();
  const sessions = store.getSessions();

  const prompt = `Generate a structured field research report from these autonomous observations collected by an AI field agent at a hackathon event.

OBSERVATIONS (${observations.length} total across ${sessions.length} sessions):
${obsText}

CATEGORIES: ${JSON.stringify(categories)}
TOTAL SESSIONS: ${sessions.length}
ACTIVITY EVENTS: ${activity.length} (including ${activity.filter(a => a.type === "ai_spoke").length} AI conversations)

Generate a professional markdown report with these sections:
# Field Research Report
## Executive Summary (2-3 sentences)
## Key Findings (organized by category, reference specific observations)
## Patterns Detected (what recurring themes or trends appear?)
## Environment Assessment (what does this tell us about the space/event?)
## Recommendations (what should be investigated further?)

Be specific, cite observation numbers. Make it feel like a real field research report.`;

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        }),
      }
    );
    const data = await r.json();
    const report = data.candidates?.[0]?.content?.parts?.[0]?.text || "Failed to generate report.";

    // Auto-export report to Nexla/Google Drive
    const nexlaResult = await exportToNexla(observations, report);
    console.log(`[Report] Generated + exported to Nexla: ${nexlaResult.success}`);

    res.json({ report, exported: nexlaResult.success, nexla: nexlaResult });
  } catch (err) {
    console.error("[Report] Error:", err);
    res.json({ report: "Error generating report." });
  }
});

// Backfill unsynced observations to Senso
app.post("/api/senso/backfill", async (_req, res) => {
  const all = store.getAll();
  const unsynced = all.filter((o) => !o.senso_content_id);
  console.log(`[Senso] Backfilling ${unsynced.length} observations...`);
  // Respond immediately, backfill in background
  res.json({ total: unsynced.length, status: "started" });

  for (const obs of unsynced) {
    try {
      await storeObservation(obs);
    } catch (err) {
      console.error(`[Senso] Backfill error for ${obs.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`[Senso] Backfill complete`);
});

app.post("/api/search", async (req, res) => {
  const { query } = req.body;
  const results = await searchObservations(query);
  res.json(results || {
    results: store.getAll().filter(o =>
      o.visual_description.toLowerCase().includes((query || "").toLowerCase()) ||
      o.category.toLowerCase().includes((query || "").toLowerCase()) ||
      o.tags.some(t => t.toLowerCase().includes((query || "").toLowerCase()))
    ),
  });
});

// ─── Serve built frontend (bypasses Vite proxy for phone access) ───
const distPath = path.join(process.cwd(), "dist");
app.use(express.static(distPath));
app.use((req, res, next) => {
  // SPA fallback — serve index.html for non-API, non-file routes
  if (req.method === "GET" && !req.path.startsWith("/api") && !req.path.includes(".")) {
    return res.sendFile(path.join(distPath, "index.html"));
  }
  next();
});

// ─── WebSocket ───

const wss = new WebSocketServer({ server, path: "/live" });

const dashboardClients = new Set<WebSocket>();

store.onNewObservation((obs) => {
  const msg = JSON.stringify({ type: "new_observation", observation: obs });
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
});

wss.on("connection", (clientWs, req) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const mode = url.searchParams.get("mode");

  // ─── Dashboard client ───
  if (mode !== "camera") {
    console.log("[WS] Dashboard client connected");
    dashboardClients.add(clientWs);
    clientWs.on("close", () => dashboardClients.delete(clientWs));
    clientWs.send(JSON.stringify({ type: "init", observations: store.getAll() }));
    return;
  }

  // ─── Camera client — relay to Gemini Live API ───
  const sessionId = url.searchParams.get("session") || `session_${Date.now()}`;
  console.log(`[WS] Camera client connected, session: ${sessionId}`);

  let geminiWs: WsWebSocket | null = null;
  let geminiReady = false;
  let aiTurnCount = 0;

  store.logActivity(sessionId, "session_start", "Camera session started");

  // Connect to Gemini with function calling for autonomous observations
  geminiWs = new WsWebSocket(GEMINI_WS_URL);
  let nudgeInterval: ReturnType<typeof setInterval> | null = null;

  geminiWs.on("open", () => {
    console.log("[Gemini] Connected, sending setup with tools...");
    geminiWs!.send(JSON.stringify({
      setup: {
        model: GEMINI_LIVE_MODEL,
        generationConfig: { responseModalities: ["AUDIO"] },
        systemInstruction: { parts: [{ text: LIVE_SYSTEM_PROMPT }] },
        tools: [{
          functionDeclarations: [{
            name: "log_observation",
            description: "Log a noteworthy observation from the camera feed. Call this AUTONOMOUSLY whenever you see something interesting or new. Do not wait for the user to ask.",
            parameters: {
              type: "object",
              properties: {
                visual_description: { type: "string", description: "Detailed description of what you see" },
                category: { type: "string", description: "One of: hackathon_project, technology, signage, food, architecture, person, presentation, equipment, branding, environment, other" },
                tags: { type: "array", items: { type: "string" }, description: "Relevant tags" },
                confidence: { type: "number", description: "Noteworthiness 0.0-1.0" },
                needs_web_enrichment: { type: "boolean", description: "True if you see a brand/logo/product name" },
                enrichment_query: { type: "string", description: "Search query if needs_web_enrichment is true" },
              },
              required: ["visual_description", "category", "tags", "confidence"],
            },
          }],
        }],
        contextWindowCompression: { slidingWindow: {}, triggerTokens: 24000 },
        sessionResumption: {},
      },
    }));
  });

  geminiWs.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.setupComplete !== undefined) {
        console.log("[Gemini] Setup complete with function calling");
        geminiReady = true;
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "ready" }));
        }
        // Initial nudge after 3 seconds (once video frames start flowing)
        setTimeout(() => {
          if (geminiWs && geminiWs.readyState === WsWebSocket.OPEN) {
            console.log("[Gemini] Sending initial observation nudge");
            geminiWs.send(JSON.stringify({
              realtimeInput: { text: "Look at the video feed. Describe what you see and call log_observation to record it." },
            }));
          }
        }, 3000);
        // Continue nudging every 15s
        nudgeInterval = setInterval(() => {
          if (geminiWs && geminiWs.readyState === WsWebSocket.OPEN) {
            geminiWs.send(JSON.stringify({
              realtimeInput: { text: "Check the video feed again. If you see anything new or different, call log_observation." },
            }));
          }
        }, 15000);
        return;
      }

      // Handle tool calls (log_observation)
      if (msg.toolCall) {
        for (const fc of msg.toolCall.functionCalls) {
          if (fc.name === "log_observation") {
            const args = fc.args;
            console.log(`📸 Observation: [${args.category}] ${(args.visual_description || "").slice(0, 80)}`);

            const obs = store.add({
              session_id: sessionId,
              visual_description: args.visual_description || "",
              category: args.category || "other",
              tags: args.tags || [],
              confidence: args.confidence || 0.5,
              needs_web_enrichment: args.needs_web_enrichment || false,
              enrichment_query: args.enrichment_query || undefined,
            });

            // Send observation to camera client
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: "new_observation", observation: obs }));
            }

            // Send tool response back to Gemini
            if (geminiWs && geminiWs.readyState === WsWebSocket.OPEN) {
              geminiWs.send(JSON.stringify({
                toolResponse: {
                  functionResponses: [{
                    name: fc.name,
                    id: fc.id,
                    response: { result: { success: true, total_observations: store.count() } },
                  }],
                },
              }));
            }
          }
        }
        return; // Don't forward tool calls to browser
      }

      // Relay audio responses to the browser
      if (msg.serverContent?.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part.inlineData?.data) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: "audio",
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType,
              }));
            }
          }
        }
      }

      if (msg.serverContent?.turnComplete) {
        aiTurnCount++;
        store.logActivity(sessionId, "ai_spoke", `AI response #${aiTurnCount}`);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "turn_complete" }));
        }
      }

      if (msg.error) {
        console.error("[Gemini] Error:", msg.error);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "error", error: msg.error.message || "Gemini error" }));
        }
      }
    } catch (err) { console.error("[WS] Error:", err); }
  });

  geminiWs.on("close", (code, reason) => {
    console.log(`[Gemini] Closed: ${code} ${reason}`);
    geminiReady = false;
    if (nudgeInterval) clearInterval(nudgeInterval);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "gemini_closed", code }));
    }
  });

  geminiWs.on("error", (err) => {
    console.error("[Gemini] WS error:", err.message);
  });

  // Handle messages from the browser (audio + video frames)
  clientWs.on("message", (data) => {
    if (!geminiReady || !geminiWs || geminiWs.readyState !== WsWebSocket.OPEN) return;

    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "audio") {
        geminiWs.send(JSON.stringify({
          realtimeInput: { audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" } },
        }));
      } else if (msg.type === "video") {
        geminiWs.send(JSON.stringify({
          realtimeInput: { video: { data: msg.data, mimeType: "image/jpeg" } },
        }));
      }
    } catch (err) { console.error("[WS] Error:", err); }
  });

  clientWs.on("close", () => {
    console.log(`[WS] Camera client disconnected, session: ${sessionId}`);
    store.logActivity(sessionId, "session_end", `Session ended. ${aiTurnCount} AI responses.`);
    if (nudgeInterval) clearInterval(nudgeInterval);
    if (geminiWs) {
      geminiWs.close();
      geminiWs = null;
    }
  });
});

// ─── Initialize autonomous behaviors ───
setupAutonomy();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🔬 Field Notes server running on http://0.0.0.0:${PORT}`);
  console.log(`   Camera WS: ws://0.0.0.0:${PORT}/live?mode=camera`);
  console.log(`   Dashboard WS: ws://0.0.0.0:${PORT}/live`);
  console.log(`   API: http://0.0.0.0:${PORT}/api/observations\n`);
});
