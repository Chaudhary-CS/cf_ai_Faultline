// Main chat UI — I wanted this to feel like Cloudflare's actual dashboard,
// not just another generic chat box. Dark, minimal, orange accents everywhere.

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgentChat } from "@cloudflare/agents/react";

// Suggested queries shown when chat is empty — makes it obvious what the agent can do
const SUGGESTED_QUERIES = [
  "What's broken right now?",
  "Recent BGP hijacks",
  "Traffic anomalies today",
  "Internet health status",
];

// Tool name → human-readable label for the "Querying Radar..." indicator
const TOOL_LABELS: Record<string, string> = {
  getCurrentOutages: "Fetching current outages",
  getBGPHijacks: "Scanning BGP hijack events",
  getRouteLeaks: "Checking route leak events",
  getTrafficAnomalies: "Analyzing traffic anomalies",
  getInternetHealth: "Pulling global routing stats",
};

interface StatusMetrics {
  totalRoutes: string;
  activeOutages: string;
  lastUpdated: string;
  loaded: boolean;
}

// Fetch the bottom status bar metrics on load
// I'm hitting two endpoints in parallel and combining them
async function fetchStatusMetrics(): Promise<StatusMetrics> {
  try {
    const [routeStatsRes, outagesRes] = await Promise.allSettled([
      fetch("/api/chat/status/route-stats?format=json"),
      fetch("/api/chat/status/outages?format=json"),
    ]);

    // These will fail unless I wire up proxy endpoints, so I'll show
    // live data only if they succeed, otherwise show a friendly fallback
    let totalRoutes = "—";
    let activeOutages = "—";

    if (routeStatsRes.status === "fulfilled" && routeStatsRes.value.ok) {
      const data = await routeStatsRes.value.json() as { result?: { meta?: { totalIPv4RoutesAdvertised?: number } } };
      totalRoutes =
        data?.result?.meta?.totalIPv4RoutesAdvertised?.toLocaleString() ?? "—";
    }

    if (outagesRes.status === "fulfilled" && outagesRes.value.ok) {
      const data = await outagesRes.value.json() as { result?: { annotations?: { outages?: unknown[] } } };
      activeOutages =
        String(data?.result?.annotations?.outages?.length ?? "—");
    }

    return {
      totalRoutes,
      activeOutages,
      lastUpdated: new Date().toLocaleTimeString(),
      loaded: true,
    };
  } catch {
    return {
      totalRoutes: "—",
      activeOutages: "—",
      lastUpdated: new Date().toLocaleTimeString(),
      loaded: true,
    };
  }
}

// Generate a session ID that persists in localStorage
// Each browser tab gets its own isolated chat history via DO
function getSessionId(): string {
  let id = localStorage.getItem("faultline-session");
  if (!id) {
    id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem("faultline-session", id);
  }
  return id;
}

export function App() {
  const sessionId = useRef(getSessionId());
  const [input, setInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [activeTools, setActiveTools] = useState<Set<string>>(new Set());
  const [metrics, setMetrics] = useState<StatusMetrics>({
    totalRoutes: "—",
    activeOutages: "—",
    lastUpdated: "—",
    loaded: false,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // useAgentChat handles WebSocket connection to the DO, message streaming,
  // and conversation history — I don't have to manage any of that myself
  const { messages, sendMessage, isLoading } = useAgentChat({
    agent: `/api/chat/${sessionId.current}`,
    onMessage: () => {
      setIsConnected(true);
    },
    onToolCall: (toolCall: { toolName: string }) => {
      // Show which Radar endpoint is being queried
      setActiveTools((prev) => new Set([...prev, toolCall.toolName]));
    },
    onToolResult: (toolResult: { toolCallId: string; toolName: string }) => {
      // Remove the tool from active set when it finishes
      setActiveTools((prev) => {
        const next = new Set(prev);
        next.delete(toolResult.toolName);
        return next;
      });
    },
  });

  // Load status bar metrics on mount
  useEffect(() => {
    fetchStatusMetrics().then(setMetrics);
    // Mark as connected after a tick — WebSocket handshake is async
    const t = setTimeout(() => setIsConnected(true), 800);
    return () => clearTimeout(t);
  }, []);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    sendMessage(trimmed);
    setInput("");
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter, newline on Shift+Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestedQuery = (query: string) => {
    sendMessage(query);
  };

  // Auto-resize textarea as user types
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  return (
    <div className="app">
      {/* Subtle grid background — gives it that Cloudflare dashboard feel */}
      <div className="grid-bg" aria-hidden="true" />

      <div className="container">
        {/* Header */}
        <header className="header">
          <div className="header-left">
            <div className="logo">
              <svg
                className="logo-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                {/* Radar/pulse icon — felt right for an internet monitoring tool */}
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="#f6821f"
                  strokeWidth="1.5"
                  strokeDasharray="2 3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="6"
                  stroke="#f6821f"
                  strokeWidth="1.5"
                  opacity="0.6"
                />
                <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
                <path
                  d="M12 12 L18 6"
                  stroke="#f6821f"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <div>
                <h1 className="logo-title">
                  Fault<span className="logo-accent">line</span>
                </h1>
                <p className="logo-sub">
                  Powered by Cloudflare Radar + Workers AI
                </p>
              </div>
            </div>
          </div>

          <div className="header-right">
            <div className={`status-badge ${isConnected ? "connected" : "connecting"}`}>
              <span className="status-dot" />
              <span>{isConnected ? "Live" : "Connecting..."}</span>
            </div>
          </div>
        </header>

        {/* Tool call indicator — shows which Radar endpoint is being queried */}
        {activeTools.size > 0 && (
          <div className="tool-indicator">
            <div className="tool-pulse" aria-hidden="true" />
            <span>
              {[...activeTools]
                .map((t) => TOOL_LABELS[t] ?? t)
                .join(" · ")}
              {"..."}
            </span>
          </div>
        )}

        {/* Chat messages area */}
        <main className="chat-area">
          {messages.length === 0 && !isLoading ? (
            /* Empty state — show suggested queries */
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="32" cy="32" r="30" stroke="#1d1d1d" strokeWidth="2" />
                  <circle cx="32" cy="32" r="20" stroke="#1d1d1d" strokeWidth="2" />
                  <circle cx="32" cy="32" r="10" stroke="#f6821f" strokeWidth="2" opacity="0.5" />
                  <circle cx="32" cy="32" r="3" fill="#f6821f" />
                  <path d="M32 32 L48 16" stroke="#f6821f" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
                  <path d="M2 32 H62" stroke="#1d1d1d" strokeWidth="1" strokeDasharray="3 4" />
                  <path d="M32 2 V62" stroke="#1d1d1d" strokeWidth="1" strokeDasharray="3 4" />
                </svg>
              </div>
              <h2 className="empty-title">Find where the internet breaks</h2>
              <p className="empty-sub">
                Ask me about outages, BGP hijacks, route leaks, or traffic anomalies.
                I pull live data from Cloudflare Radar and explain it in plain English.
              </p>
              <div className="suggestions">
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    className="suggestion-chip"
                    onClick={() => handleSuggestedQuery(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message list */
            <div className="messages">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`message ${msg.role === "user" ? "message-user" : "message-agent"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="agent-label" aria-label="Faultline agent">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="2" strokeDasharray="2 3" />
                        <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
                      </svg>
                      <span>Faultline</span>
                    </div>
                  )}
                  <div className="message-bubble">
                    {/* Render newlines and basic markdown-ish formatting */}
                    {renderMessageContent(msg.content)}
                  </div>
                </div>
              ))}

              {/* Typing / streaming indicator */}
              {isLoading && activeTools.size === 0 && (
                <div className="message message-agent">
                  <div className="agent-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="2" strokeDasharray="2 3" />
                      <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
                    </svg>
                    <span>Faultline</span>
                  </div>
                  <div className="message-bubble">
                    <span className="typing-cursor" aria-label="Loading response" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </main>

        {/* Input area */}
        <footer className="input-area">
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Ask about internet outages, BGP hijacks, traffic anomalies..."
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              aria-label="Chat message input"
              disabled={!isConnected}
            />
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!input.trim() || isLoading || !isConnected}
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M22 2L11 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M22 2L15 22L11 13L2 9L22 2Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <p className="input-footer-text">
            Powered by Cloudflare Workers AI · Llama 3.3 · Real-time Radar data
          </p>
        </footer>

        {/* Status bar — live metrics at the bottom */}
        <div className="status-bar">
          <div className="metric-card">
            <span className="metric-label">Global BGP Routes</span>
            <span className="metric-value">
              {metrics.loaded ? metrics.totalRoutes : <span className="metric-loading" />}
            </span>
          </div>
          <div className="metric-divider" aria-hidden="true" />
          <div className="metric-card">
            <span className="metric-label">Active Outages</span>
            <span className="metric-value">
              {metrics.loaded ? metrics.activeOutages : <span className="metric-loading" />}
            </span>
          </div>
          <div className="metric-divider" aria-hidden="true" />
          <div className="metric-card">
            <span className="metric-label">Last Updated</span>
            <span className="metric-value metric-time">
              {metrics.loaded ? metrics.lastUpdated : <span className="metric-loading" />}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Render message content — handles bullet points, bold text, and newlines
// I'm keeping this simple instead of pulling in a full markdown library
function renderMessageContent(content: string): React.ReactNode {
  const lines = content.split("\n");

  return (
    <>
      {lines.map((line, i) => {
        // Bullet points
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={i} className="msg-bullet">
              <span className="bullet-dot" aria-hidden="true">▸</span>
              <span>{renderInlineMarkdown(line.slice(2))}</span>
            </div>
          );
        }
        // Numbered list
        if (/^\d+\.\s/.test(line)) {
          return (
            <div key={i} className="msg-bullet">
              <span className="bullet-dot" aria-hidden="true">{line.match(/^\d+/)?.[0]}.</span>
              <span>{renderInlineMarkdown(line.replace(/^\d+\.\s/, ""))}</span>
            </div>
          );
        }
        // Headings (##)
        if (line.startsWith("## ")) {
          return (
            <p key={i} className="msg-heading">
              {line.slice(3)}
            </p>
          );
        }
        // Empty line = visual spacer
        if (line.trim() === "") {
          return <div key={i} className="msg-spacer" />;
        }
        return <p key={i}>{renderInlineMarkdown(line)}</p>;
      })}
    </>
  );
}

// Handle **bold** and `code` inline
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
