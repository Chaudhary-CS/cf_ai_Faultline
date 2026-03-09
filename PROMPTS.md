# AI Prompts Used — cf_ai_faultline

This file documents the key prompts used with Cursor (Claude claude-4.6-sonnet-medium-thinking) to build Faultline. Prompts are shown in the order they were used, grouped by feature area.

---

## 1. Initial project scaffold

> Build a production-ready AI-powered Internet Outage Storyteller agent deployed on Cloudflare's stack. This is a submission for a Cloudflare SWE internship application — it must use Cloudflare's native tools exclusively and demonstrate mastery of their platform.
>
> LLM: Llama 3.3 via Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
> Workflow/coordination: Cloudflare Agents SDK (`AIChatAgent`) + Durable Objects for state
> User input: Chat UI via Pages with WebSocket real-time streaming
> Memory/state: Durable Objects SQL database via Agents SDK to persist full conversation history per session
>
> Worker (`server.ts`): Extends `AIChatAgent`, defines 5 tools hitting Cloudflare Radar API using `env.CLOUDFLARE_RADAR_TOKEN`. System prompt for Llama 3.3.
> Frontend: React + TypeScript using `useAgentChat` hook from `@cloudflare/agents/react`
> UI Design: Cloudflare aesthetic — dark theme, orange (#f6821f) accents, Inter font, dot-grid background
>
> Generate all files: `src/server.ts`, `src/app.tsx`, `src/client.tsx`, `src/styles.css`, `wrangler.toml`, `package.json`, `README.md`

---

## 2. Architecture pivot — RAG pattern

> The LLM is outputting raw JSON tool calls as text: `{"type": "function", "name": "getCurrentOutages", "parameters": {}}`. Tool calling isn't working with llama-3.3-70b-instruct-fp8-fast in streaming mode via the Workers AI binding.
>
> Switch to a RAG architecture instead: detect user intent from message keywords, pre-fetch the relevant Cloudflare Radar endpoints in parallel, inject the data directly into the system prompt, then call streamText with no tools. The LLM narrates the provided context rather than calling tools itself.

---

## 3. UI polish — 6 features pass

> Add these 6 features to maximize interview impact:
> 1. Hide tool call JSON messages — filter content starting with `{"type": "function"`, show "Querying Cloudflare Radar..." pill instead
> 2. Suggested query chips above input — 6 clickable chips, hidden after first message
> 3. Severity badges on responses — red Critical, yellow Warning, green Normal
> 4. Copy button on agent responses
> 5. Fix status bar — add `/api/stats` endpoint fetching real BGP routes and active outages from Radar
> 6. Page title "Faultline — Internet Intelligence" and orange radar favicon

---

## 4. Smarter severity + hide raw JSON

> Fix these 3 issues:
>
> 1. HIDE RAW JSON TOOL CALLS COMPLETELY — add `shouldHide(content)` that checks for `{"type": "function"` and `"parameters":` patterns, render nothing for matching messages
>
> 2. SMARTER CRITICAL BADGE — replace with: INFO if response says "unavailable/no specific/cannot provide", CRITICAL if hijack/shutdown/disconnection (but not "no hijack"), WARNING if anomaly/outage/leak/elevated, null (no badge) for everything else
>
> 3. HIDE SUGGESTED CHIPS AFTER FIRST MESSAGE — `const [hasStarted, setHasStarted] = useState(false)`, set true on first send, `{!hasStarted && <QueryChips />}`
>
> Update chips to: "What's broken right now?", "Any BGP hijacks today?", "Recent route leaks", "Internet health status", "Traffic anomalies in Asia", "Iran internet shutdown details"

---

## 5. Three major features

> Add these 3 features to Faultline. Each must work end-to-end and be production ready.
>
> **FEATURE 1: ASN/REGION WATCHLIST**
> User types "Watch AS13335" or "Watch Brazil" — Faultline remembers this and automatically cross-references every Radar response against their watchlist, highlighting matches.
>
> Backend: detect watchlist commands in `onChatMessage`, parse `[watching:X,Y]` meta prefix from messages. Include watchlist in system prompt: "The user is monitoring these ASNs/regions: {watchlist}. If any tool results mention these, prefix your response with 🔴 WATCHLIST ALERT:"
>
> Frontend: localStorage watchlist, watchlist pill in header, "My Watchlist" panel with X-to-remove, pulsing red border on WATCHLIST ALERT responses
>
> Commands: "Watch AS13335", "Monitor Iran", "Show my watchlist", "Remove Brazil from watchlist", "Clear watchlist"
>
> **FEATURE 2: INCIDENT TIMELINE GENERATOR**
> User asks "Build me a timeline of the Iran shutdown" — fires 3 Radar calls in parallel (outages + hijacks + leaks), Llama synthesizes into structured chronological incident report.
>
> Backend: detect trigger phrases (incident report, build timeline, what happened with, post-mortem), fetch all 3 sources in parallel, instruct LLM to format as: # Incident Report, ## Summary, ## Timeline, ## Impact, ## Technical Details, ## Current Status
>
> Frontend: special card with orange top border, "📋 Copy Report" + "⬇ Download .md" buttons, animated loading steps showing "Fetching outages... ✓", "Fetching BGP hijacks... ✓", etc.
>
> **FEATURE 3: MORNING EMAIL DIGEST**
> Daily 9am UTC cron job. DigestAgent Durable Object stores email subscribers. `scheduled()` handler fetches overnight Radar data, generates briefing via Llama, sends via Resend API.
>
> Frontend: "📧 Get daily digest" link → inline email form → sends "Subscribe email@x.com to digest" as message

---

## 6. Watchlist targeted fetch fix

> The watchlist cross-reference isn't working because the backend only injects a system prompt instruction but doesn't actually fetch Radar data ABOUT the watched ASN/country.
>
> Fix: in `fetchRadarContext`, for each watchlist item:
> - If ASN (e.g. AS13335): fetch `/radar/bgp/hijacks/events?affectedAsn=13335`, `/radar/bgp/leaks/events?involvedAsn=13335`, `/radar/entities/asns/13335`
> - If country (e.g. Iran): map to ISO code using a country-to-code lookup table, fetch `/radar/annotations/outages?location=IR`
>
> Label these sections "(watched)" in the context. Update system prompt to tell LLM: always mention watched items explicitly — either WATCHLIST ALERT if events found, or explicit "AS13335 shows no issues in the last 7 days" if clean.

---

## 7. Submission files

> The repository needs a `cf_ai_` prefix. Rewrite README.md to accurately reflect the current RAG architecture (not the old tool-calling one), include the live demo URL, setup instructions, architecture diagram, all features documented, and a table of Radar endpoints used. Create PROMPTS.md documenting all AI prompts used to build this project.

---

## System prompt used by the Faultline agent itself

This is the LLM system prompt injected on every request (from `server.ts`):

```
You are an internet intelligence analyst powered by Cloudflare Radar. You translate raw internet infrastructure data — BGP events, route leaks, traffic anomalies, outages — into clear, human-readable narratives.

Be concise, specific, and use plain English. Never use jargon without explaining it. If there is no data or the data shows no issues, say so clearly.

When describing outages or BGP events, always mention: what happened, where, when, and potential impact.

Format your response as:
- A one-sentence headline summarizing the situation
- Key findings as bullet points (use "- " prefix)
- A brief plain-English explanation of what it means for regular internet users

If the Radar data shows errors or is unavailable, explain that Radar data is temporarily unavailable and describe what you would normally look for.

[LIVE CLOUDFLARE RADAR DATA injected here at request time]
```

For incident reports, additional instructions are appended:

```
When responding to this incident timeline request, structure your response EXACTLY as follows:

# Incident Report: {subject}
Generated: {time}

## Summary
## Timeline
## Impact
## Technical Details
## Current Status

---
*Generated by Faultline using Cloudflare Radar data*
```

For watchlist cross-reference, additional instructions are appended:

```
WATCHLIST: The user is actively monitoring {items}. The Radar data below includes sections labelled "(watched)" with data fetched specifically for these entities.

Rules:
- If a "(watched)" section shows ANY events, PREFIX your entire response with "🔴 WATCHLIST ALERT: "
- If a "(watched)" section shows no events, explicitly confirm this — e.g. "AS13335 (Cloudflare) shows no hijacks or route leaks in the last 7 days."
- Always mention the watched items by name in your response.
```
