---
name: field-notes
description: An autonomous AI field research agent that observes the real world through video, builds a persistent knowledge base, and takes action without human intervention.
version: 1.0.0
author: varun
tags: [multimodal, gemini-live-api, autonomous-agent, field-research, context-engineering]
---

# Field Notes Agent Skill

## What it does
Field Notes is an autonomous AI agent that uses your phone camera to observe the physical world, automatically identifies noteworthy observations, enriches them with web context, and builds a searchable knowledge base.

## How to use
1. Open the camera view on your phone
2. Point at anything — the agent autonomously creates observations
3. Open the dashboard to query: "What did I see?" "Find patterns" "Compare sessions"

## Technologies
- Gemini Live API for real-time multimodal understanding
- Senso Context OS for persistent memory
- Tavily for web enrichment
- Assistant UI for chat interface
- Nexla Express.Dev for data export

## Setup
```bash
npm install
cp .env.example .env  # Add your API keys
npm run dev
cloudflared tunnel --url http://localhost:3000
```
