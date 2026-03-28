# Field Notes

An autonomous AI field research agent that uses your phone camera to observe the real world, builds a persistent knowledge base of observations, and takes autonomous actions without human intervention.

## What It Does

Point your phone camera at anything. The AI agent:

- **Sees and talks** — bidirectional audio conversation via Gemini Live API
- **Observes autonomously** — calls `log_observation` via function calling when it sees something noteworthy (no button press needed)
- **Builds memory** — stores observations locally and syncs to Senso Context OS for persistent semantic search
- **Enriches with context** — automatically searches the web via Tavily when it spots brands or logos
- **Generates reports** — synthesizes all observations into structured field research reports
- **Exports data** — CSV download and Nexla Express.Dev integration for data pipelines

## Architecture

```
Phone (camera + mic)
  -> WebSocket -> Express backend
    -> Gemini Live API (audio + video + function calling)
      <- Audio responses -> phone speaker
      <- log_observation() tool calls -> observation store
          -> Senso (persistent memory)
          -> Tavily (web enrichment)
          -> Nexla (data export)
          -> Dashboard (real-time updates)
```

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4
- **Chat UI:** assistant-ui (Thread, AssistantRuntimeProvider, ChatModelAdapter)
- **Backend:** Express 5, WebSocket (ws)
- **AI - Live:** Gemini Live API (`gemini-3.1-flash-live-preview`) with function calling
- **AI - Chat/Report:** Gemini REST API (`gemini-2.5-flash`)
- **Memory:** Senso Context OS (S3 upload + semantic search)
- **Enrichment:** Tavily Search API
- **Export:** CSV + Nexla Express.Dev

## Sponsor Tools Used (5)

1. **Gemini Live API** (Google DeepMind) — bidirectional audio + video + autonomous function calling
2. **Senso Context OS** — persistent knowledge base with semantic search
3. **Tavily** — autonomous web enrichment for brands and logos
4. **Nexla Express.Dev** — structured data export pipeline
5. **assistant-ui** — chat interface with custom backend adapter

## Setup

```bash
# Install dependencies
npm install

# Configure API keys
cp .env.example .env
# Edit .env with your keys

# Build frontend
npx vite build

# Start server
npx tsx server/index.ts

# In another terminal - HTTPS tunnel for phone access
cloudflared tunnel --url http://localhost:3001
```

## Usage

- **Phone:** Open the cloudflare tunnel URL + `/camera`, tap "Start Observing"
- **Desktop:** Open `http://localhost:3001/dashboard`
- **Chat:** Ask questions about observations in the Chat tab
- **Report:** Click "Generate Report" for a synthesized field research report
- **Export:** Click "Export CSV + Nexla" to download data

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/query` | Chat query over all observations |
| POST | `/api/report` | Generate field research report |
| GET | `/api/observations` | Get all observations |
| GET | `/api/stats` | Aggregate stats |
| GET | `/api/export/csv` | Download CSV |
| GET | `/api/activity` | Activity log |
| POST | `/api/search` | Senso semantic search |
| WS | `/live?mode=camera` | Camera relay to Gemini |
| WS | `/live?mode=dashboard` | Dashboard real-time updates |

## Project Structure

```
server/
  index.ts          Express + WebSocket relay + Gemini function calling
  gemini.ts         Gemini REST API for chat queries
  observations.ts   Observation store with file persistence
  senso.ts          Senso S3 upload + search
  tavily.ts         Tavily web enrichment
  nexla.ts          Nexla export
  autonomy.ts       Autonomous behavior wiring

src/
  pages/
    CameraView.tsx  Phone camera + mic + audio playback
    Dashboard.tsx   Timeline, chat, report, stats, activity feed
  components/
    ObservationCard.tsx
    Timeline.tsx
```
