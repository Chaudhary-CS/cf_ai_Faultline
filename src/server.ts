// Faultline — AI-powered internet outage storyteller
// Architecture: instead of relying on LLM tool calling (which has issues with
// llama-3.3-70b-instruct-fp8-fast streaming via binding.run), I pre-fetch the
// relevant Radar data based on the user's query, then inject it into the LLM
// context. This is the RAG pattern — reliable, fast, and works every time.

import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import {
  streamText,
  convertToModelMessages,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";

export interface Env {
  AI: Ai;
  ChatAgent: DurableObjectNamespace;
  CLOUDFLARE_RADAR_TOKEN: string;
  ASSETS: Fetcher;
}

const RADAR_BASE = "https://api.cloudflare.com/client/v4";

// Fetches a Radar endpoint — returns parsed JSON, or an error object.
// Logs the full error body on non-200 so I can debug param issues easily.
async function radarFetch(
  path: string,
  token: string,
  params?: Record<string, string>
): Promise<unknown> {
  try {
    const url = new URL(`${RADAR_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) return { error: "Rate limited by Radar API — try again in a moment" };

    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      console.error(`[radar] ${res.status} on ${path}:`, body.slice(0, 300));
      return { error: `Radar API returned HTTP ${res.status}`, detail: body.slice(0, 200) };
    }

    return await res.json();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fetch failed" };
  }
}

// Detect intent from the user's message and fetch the right Radar endpoints.
// I fetch a bit more than needed — LLM picks what's relevant.
async function fetchRadarContext(
  userMessage: string,
  token: string
): Promise<string> {
  const msg = userMessage.toLowerCase();

  const fetches: { label: string; path: string; params?: Record<string, string> }[] = [];

  // Always grab outages — relevant to almost any internet health question
  // /radar/annotations/outages uses "limit" (confirmed in Cloudflare docs)
  fetches.push({
    label: "Current Internet Outages & Annotations",
    path: "/radar/annotations/outages",
    params: { limit: "10", dateRange: "7d" },
  });

  // BGP hijacks — uses "per_page" not "limit", minConfidence is integer 0-10
  if (
    msg.includes("hijack") || msg.includes("bgp") ||
    msg.includes("route") || msg.includes("routing") ||
    msg.includes("intercept") || msg.includes("broken") ||
    msg.includes("right now") || msg.includes("unusual") || msg.includes("anomal")
  ) {
    fetches.push({
      label: "BGP Hijack Events",
      path: "/radar/bgp/hijacks/events",
      params: { per_page: "10", dateRange: "7d" },
    });
  }

  // Route leaks — also uses "per_page"
  if (msg.includes("leak") || msg.includes("bgp") || msg.includes("route")) {
    fetches.push({
      label: "BGP Route Leak Events",
      path: "/radar/bgp/leaks/events",
      params: { per_page: "10", dateRange: "7d" },
    });
  }

  // Internet health / routing table stats — needs dateRange
  if (
    msg.includes("health") || msg.includes("stable") ||
    msg.includes("global") || msg.includes("routing table") ||
    msg.includes("prefix") || msg.includes("status")
  ) {
    fetches.push({
      label: "Global BGP Routing Table Stats",
      path: "/radar/bgp/route-stats",
      params: { dateRange: "1d" },
    });
  }

  // Run all fetches in parallel
  const results = await Promise.all(
    fetches.map(async ({ label, path, params }) => {
      const data = await radarFetch(path, token, params);
      return `### ${label}\n${JSON.stringify(data, null, 2)}`;
    })
  );

  return results.join("\n\n");
}

// Extract the text content from the last user message
function getLastUserMessage(messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    // AI SDK v6 UIMessage format — content is in parts
    if (msg.parts) {
      const textPart = msg.parts.find((p) => p.type === "text");
      if (textPart?.text) return textPart.text;
    }
    // Fallback for string content
    if (typeof msg.content === "string") return msg.content;
  }
  return "";
}

const BASE_SYSTEM_PROMPT = `You are an internet intelligence analyst powered by Cloudflare Radar. You translate raw internet infrastructure data — BGP events, route leaks, traffic anomalies, outages — into clear, human-readable narratives.

Be concise, specific, and use plain English. Never use jargon without explaining it. If there is no data or the data shows no issues, say so clearly.

When describing outages or BGP events, always mention: what happened, where, when, and potential impact.

Format your response as:
- A one-sentence headline summarizing the situation
- Key findings as bullet points (use "- " prefix)
- A brief plain-English explanation of what it means for regular internet users

If the Radar data shows errors or is unavailable, explain that Radar data is temporarily unavailable and describe what you would normally look for.`;

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    // Figure out what the user is asking and pre-fetch the relevant Radar data
    const userMessage = getLastUserMessage(this.messages as Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }>);
    const radarData = await fetchRadarContext(
      userMessage,
      this.env.CLOUDFLARE_RADAR_TOKEN
    );

    // Inject live Radar data into the system prompt so the LLM has real context
    const systemPrompt = `${BASE_SYSTEM_PROMPT}

---
LIVE CLOUDFLARE RADAR DATA (fetched at ${new Date().toUTCString()}):

${radarData}
---

Use ONLY the data above when answering. Do not make up events or statistics.`;

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: systemPrompt,
      messages: await convertToModelMessages(this.messages),
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }
}

// Format a raw route count into "918K" or "1.2M" for the status bar
function formatRoutes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /api/stats — powers the live status bar at the bottom of the UI
    if (url.pathname === "/api/stats") {
      const [routeRes, outageRes] = await Promise.allSettled([
        radarFetch("/radar/bgp/route-stats", env.CLOUDFLARE_RADAR_TOKEN, { dateRange: "1d" }),
        radarFetch("/radar/annotations/outages", env.CLOUDFLARE_RADAR_TOKEN, { limit: "50", dateRange: "7d" }),
      ]);

      let routes = 0;
      let outageCount = 0;

      if (routeRes.status === "fulfilled") {
        const d = routeRes.value as { result?: { stats?: { totalRoutes?: number }; meta?: { totalIPv4RoutesAdvertised?: number } } };
        routes =
          d?.result?.stats?.totalRoutes ??
          d?.result?.meta?.totalIPv4RoutesAdvertised ??
          0;
      }

      if (outageRes.status === "fulfilled") {
        const d = outageRes.value as { result?: { annotations?: { outages?: unknown[] } } };
        outageCount = d?.result?.annotations?.outages?.length ?? 0;
      }

      return new Response(
        JSON.stringify({
          routes: routes > 0 ? formatRoutes(routes) : "—",
          outages: outageCount > 0 ? String(outageCount) : "0",
          updated: new Date().toUTCString(),
        }),
        { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }

    // All other requests: try agent routing first, then serve static assets
    return (
      (await routeAgentRequest(request, env)) ??
      env.ASSETS.fetch(request)
    );
  },
} satisfies ExportedHandler<Env>;
