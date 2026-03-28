import { store } from "./observations.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const VISION_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `You are a field research agent analyzing camera frames. For EVERY frame, identify what you see and create an observation. Be generous — observe everything: people, screens, objects, text, logos, food, furniture, equipment, rooms, presentations, anything visible.

OUTPUT ONLY valid JSON (no markdown, no backticks):
{"observation": {"visual_description": "what you see in detail", "category": "one of: hackathon_project, technology, signage, food, architecture, person, presentation, equipment, branding, environment, other", "tags": ["tag1", "tag2"], "confidence": 0.7, "needs_web_enrichment": false, "enrichment_query": ""}}

If you see a logo, brand, or product name, set needs_web_enrichment to true and enrichment_query to the brand/product name.

IMPORTANT: Almost every frame has SOMETHING worth observing. Only return {"observation": null} if the frame is completely black or unrecognizable.`;

// Analyze a single frame using Gemini REST API
export async function analyzeFrame(
  frameBase64: string,
  sessionId: string
): Promise<{ observation: any } | null> {
  if (!GEMINI_API_KEY) return null;

  const corrections = store.getCorrections();
  const correctionNote = corrections.length > 0
    ? `\n\nPREVIOUS CORRECTIONS (learn from these):\n${corrections.join("\n")}`
    : "";

  // Include only the LAST observation to avoid exact repeats, but still observe new details
  const recent = store.getAll().slice(-1);
  const recentNote = recent.length > 0
    ? `\n\nLAST OBSERVATION (don't repeat this exact same thing, but DO observe new details, different angles, or changes):\n- ${recent[0].visual_description}`
    : "";

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: SYSTEM_PROMPT + correctionNote + recentNote },
                { inlineData: { mimeType: "image/jpeg", data: frameBase64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 512,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Gemini] Vision API error: ${res.status} ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log("[Gemini] Raw vision response:", text?.slice(0, 200));
    if (!text) return null;

    // Parse response
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(cleaned);

    if (parsed.observation && parsed.observation !== null) {
      const obs = store.add({
        session_id: sessionId,
        visual_description: parsed.observation.visual_description || "",
        category: parsed.observation.category || "uncategorized",
        tags: parsed.observation.tags || [],
        confidence: parsed.observation.confidence || 0.5,
        needs_web_enrichment: parsed.observation.needs_web_enrichment || false,
        enrichment_query: parsed.observation.enrichment_query || undefined,
      });
      console.log(`[Gemini] Observation: "${obs.visual_description.slice(0, 80)}"`);
      return { observation: obs };
    }

    return { observation: null };
  } catch (err) {
    console.error("[Gemini] analyzeFrame error:", err);
    return null;
  }
}

// Chat query — uses Gemini to reason over ALL stored context (observations + activity)
export async function queryObservations(question: string): Promise<string> {
  const fullContext = store.getFullContext();

  const prompt = `You are a friendly, conversational field research assistant. A user has been walking around a hackathon with their phone camera, and an AI agent has been autonomously logging what it sees. You have all the observations below.

${fullContext}

USER QUESTION: ${question}

Answer naturally and conversationally — like a helpful colleague who was there with them. Rules:
- NEVER show raw session IDs like "session_1774730231395" — say "your first session", "your latest session", etc.
- NEVER show raw ISO timestamps — say "about 20 minutes ago" or "earlier today"
- Describe what was seen in plain, vivid language
- Use short bullet points, not giant paragraphs
- If they ask "what did you see?" give a concise summary, not every single detail`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Gemini] Query error: ${res.status} ${errText}`);
      return "Sorry, I couldn't process that query right now.";
    }

    const data = await res.json();
    return (
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response generated."
    );
  } catch (err) {
    console.error("[Gemini] Query error:", err);
    return "Error querying observations.";
  }
}
