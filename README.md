# Faultline — AI-Powered Internet Outage Storyteller

> **Find where the internet breaks.**

Faultline is a conversational AI agent that tells you what's happening on the internet right now, in plain English. Ask it about outages, BGP hijacks, route leaks, or traffic anomalies — it pulls live data from Cloudflare Radar, feeds it to Llama 3.3 running on Workers AI, and responds with clear, human-readable narratives. No dashboards to decode. No jargon walls.

**Live demo:** https://faultline.workers.dev *(deploy your own — see setup below)*

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| LLM | Llama 3.3 70B via **Cloudflare Workers AI** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) |
| Agent + State | **Cloudflare Agents SDK** (`AIChatAgent`) + Durable Objects |
| Memory | Durable Objects **SQLite** — full conversation history per session |
| Frontend | React 18 + **Cloudflare Workers Assets** (served from the same Worker) |
| Data | **Cloudflare Radar API** — live BGP, outage, and traffic data |

Everything runs on Cloudflare. No external services, no VMs, no cold starts.

---

## Architecture

```
Browser (React + useAgentChat)
        │  WebSocket
        ▼
┌─────────────────────────────────────────────────┐
│            Cloudflare Worker (server.ts)         │
│                                                  │
│  /api/chat/:sessionId  ──►  ChatAgent DO         │
│  (everything else)     ──►  Workers Assets       │
└──────────────┬──────────────────────────────────┘
               │  Durable Object (per session)
               ▼
┌─────────────────────────────────────────────────┐
│  ChatAgent extends AIChatAgent                   │
│  - SQLite conversation history (auto)            │
│  - streamText() via Workers AI binding           │
│  - 5 Radar tool calls via fetch()                │
└──────┬────────────────────┬───────────────────┘
       │ Workers AI         │ Cloudflare Radar API
       ▼                    ▼
  Llama 3.3 70B        /radar/bgp/hijacks/events
  (fp8-fast)           /radar/bgp/leaks/events
                       /radar/annotations/outages
                       /radar/bgp/route-stats
```

---

## Example Queries

- *"What's broken on the internet right now?"*
- *"Are there any BGP hijacks happening today?"*
- *"What happened to internet traffic in Asia yesterday?"*
- *"Show me recent route leaks"*
- *"Is there anything unusual with internet traffic right now?"*
- *"How healthy is the global routing table?"*

---

## Setup

### Prerequisites
- [Node.js](https://nodejs.org) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler`
- A Cloudflare account (free tier works)
- A Cloudflare Radar API token — get one at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with `Account:Cloudflare Radar:Read` permission

### Install & Deploy

```bash
# Clone the repo
git clone https://github.com/Chaudhary-CS/Faultline.git
cd Faultline

# Install deps
npm install

# Set your Radar API token as a secret
npx wrangler secret put CLOUDFLARE_RADAR_TOKEN
# paste your token when prompted

# Deploy to Cloudflare
npx wrangler deploy
```

### Local Development

```bash
npx wrangler dev --port 5173
```

Then open http://localhost:5173

---

## How it Works

1. **User sends a message** via the React chat UI over WebSocket
2. **ChatAgent** (Durable Object) receives it, stores it in SQLite via Agents SDK
3. **streamText()** calls Llama 3.3 on Workers AI with the full conversation history
4. **Llama 3.3 decides** which Radar tool(s) to call based on the question
5. **Radar API** returns live BGP/outage data as JSON
6. **Llama 3.3 synthesizes** the raw data into a plain-English narrative
7. **Response streams** back to the browser token-by-token via the Agents SDK

Conversation history persists indefinitely per browser session via Durable Objects SQLite — no external database needed.

---

## Radar Tools

| Tool | Radar Endpoint | Used For |
|------|---------------|----------|
| `getCurrentOutages` | `GET /radar/annotations/outages` | Current internet outages |
| `getBGPHijacks` | `GET /radar/bgp/hijacks/events` | BGP route hijacking events |
| `getRouteLeaks` | `GET /radar/bgp/leaks/events` | BGP route leak events |
| `getTrafficAnomalies` | `GET /radar/annotations/outages?location=X` | Regional traffic anomalies |
| `getInternetHealth` | `GET /radar/bgp/route-stats` | Global routing table health |

---

## Built By

**Kartik Chaudhary**
- Web: [getnav.app](https://getnav.app)
- GitHub: [github.com/Chaudhary-CS](https://github.com/Chaudhary-CS)

**Built for:** Cloudflare SWE Internship 2026 application
**Repository:** [github.com/Chaudhary-CS/Faultline](https://github.com/Chaudhary-CS/Faultline)
