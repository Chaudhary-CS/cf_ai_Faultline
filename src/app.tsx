// Faultline chat UI — all 6 features:
// 1. Hidden tool-call JSON messages
// 2. Suggested query chips above input
// 3. Severity badges on responses
// 4. Copy button top-right of each agent card
// 5. Live /api/stats status bar
// 6. Handled in index.html (title + favicon)

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

// All 6 chips shown above the input before first message
const QUERY_CHIPS = [
  "What's broken right now?",
  "Any BGP hijacks today?",
  "Recent route leaks",
  "Internet health status",
  "Traffic anomalies in Asia",
  "Most affected countries",
];

// Follow-ups shown after each agent reply
function getFollowUps(text: string): string[] {
  const t = text.toLowerCase();
  if (t.includes("hijack") || t.includes("bgp"))
    return ["Show route leaks too", "Which ASNs are most affected?", "How long do hijacks usually last?"];
  if (t.includes("outage") || t.includes("broken") || t.includes("disruption"))
    return ["Which regions are affected?", "Any BGP issues related?", "Show internet health status"];
  if (t.includes("health") || t.includes("routing table"))
    return ["Are there any active outages?", "Show BGP hijack events", "Traffic anomalies today"];
  if (t.includes("traffic") || t.includes("anomal") || t.includes("asia"))
    return ["Show BGP hijacks", "Any outages in those regions?", "Global internet health"];
  if (t.includes("leak") || t.includes("route leak"))
    return ["Show BGP hijacks too", "Which ASNs are leaking?", "Internet health status"];
  return ["Any BGP hijacks today?", "Show recent outages", "Global internet health"];
}

// Severity badge: parse the agent response for keywords
function getSeverity(text: string): { level: "critical" | "warning" | "normal"; label: string } {
  const t = text.toLowerCase();
  if (t.includes("hijack") || t.includes("outage") || t.includes("disruption") || t.includes("attack"))
    return { level: "critical", label: "Critical" };
  if (t.includes("anomal") || t.includes("leak") || t.includes("unusual") || t.includes("elevated"))
    return { level: "warning", label: "Warning" };
  return { level: "normal", label: "Normal" };
}

// Returns true if a message is a raw tool-call JSON blob (from before the fix)
// These should be hidden entirely from the UI
function isToolCallMessage(parts: MessagePart[]): boolean {
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("");
  return text.trimStart().startsWith('{"type": "function"') ||
    text.trimStart().startsWith('{"type":"function"');
}

function extractText(parts: MessagePart[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("\n");
}

function getSessionId(): string {
  let id = localStorage.getItem("faultline-session");
  if (!id) {
    id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("faultline-session", id);
  }
  return id;
}

function newSessionId(): string {
  const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem("faultline-session", id);
  return id;
}

interface Stats { routes: string; outages: string; updated: string }

async function fetchStats(): Promise<Stats> {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) throw new Error("stats failed");
    return await res.json() as Stats;
  } catch {
    return { routes: "—", outages: "—", updated: new Date().toLocaleTimeString() };
  }
}

export function App() {
  const [sessionId, setSessionId] = useState(getSessionId);
  const [input, setInput] = useState("");
  const [hasSent, setHasSent] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats & { loaded: boolean }>({
    routes: "—", outages: "—", updated: "—", loaded: false,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent({ agent: "ChatAgent", name: sessionId });
  const { messages, sendMessage, status, clearHistory } = useAgentChat({ agent });

  const isLoading = status === "submitted" || status === "streaming";
  const isConnected = status !== "error";

  // Hide chips once the user has sent at least one real message
  const visibleMessages = messages.filter(
    (m) => !(m.role === "assistant" && isToolCallMessage(m.parts as MessagePart[]))
  );
  const showChips = !hasSent && visibleMessages.length === 0 && !isLoading;

  // Load + auto-refresh stats
  useEffect(() => {
    const load = () => fetchStats().then((s) => setStats({ ...s, loaded: true }));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Show a brief toast notification
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleSend = useCallback((text?: string) => {
    const t = (text ?? input).trim();
    if (!t || isLoading) return;
    sendMessage({ text: t });
    setInput("");
    setHasSent(true);
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  const handleNewChat = useCallback(() => {
    clearHistory();
    setSessionId(newSessionId());
    setInput("");
    setHasSent(false);
  }, [clearHistory]);

  const handleCopy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      showToast("Copied to clipboard!");
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  // Last completed agent message (for follow-up chips)
  const lastAgentMsg = !isLoading
    ? [...visibleMessages].reverse().find((m) => m.role === "assistant")
    : null;
  const followUps = lastAgentMsg
    ? getFollowUps(extractText(lastAgentMsg.parts as MessagePart[]))
    : null;

  return (
    <div className="app">
      <div className="grid-bg" aria-hidden="true" />

      {/* Toast notification */}
      {toast && <div className="toast">{toast}</div>}

      <div className="container">

        {/* ── Header ──────────────────────────────────── */}
        <header className="header">
          <div className="logo">
            <svg className="logo-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="1.5" strokeDasharray="2 3" />
              <circle cx="12" cy="12" r="6" stroke="#f6821f" strokeWidth="1.5" opacity="0.5" />
              <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
              <path d="M12 12 L18 6" stroke="#f6821f" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div>
              <h1 className="logo-title">Fault<span className="logo-accent">line</span></h1>
              <p className="logo-sub">Powered by Cloudflare Radar + Workers AI</p>
            </div>
          </div>

          <div className="header-actions">
            {visibleMessages.length > 0 && (
              <button className="new-chat-btn" onClick={handleNewChat} aria-label="New chat">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                New Chat
              </button>
            )}
            <div className={`status-badge ${isConnected ? "connected" : "connecting"}`}>
              <span className="status-dot" />
              <span>{isConnected ? "Live" : "Connecting..."}</span>
            </div>
          </div>
        </header>

        {/* ── Radar loading indicator ──────────────────── */}
        {isLoading && (
          <div className="tool-indicator">
            <div className="tool-pulse" aria-hidden="true" />
            <span>Querying Cloudflare Radar...</span>
          </div>
        )}

        {/* ── Chat area ────────────────────────────────── */}
        <main className="chat-area">
          {visibleMessages.length === 0 && !isLoading ? (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none">
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
                {QUERY_CHIPS.slice(0, 4).map((q) => (
                  <button key={q} className="suggestion-chip" onClick={() => handleSend(q)}>{q}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {visibleMessages.map((msg, idx) => {
                const isLastMsg = idx === visibleMessages.length - 1;
                const parts = msg.parts as MessagePart[];
                const plainText = extractText(parts);
                const severity = msg.role === "assistant" ? getSeverity(plainText) : null;

                return (
                  <React.Fragment key={msg.id}>
                    <div className={`message ${msg.role === "user" ? "message-user" : "message-agent"}`}>
                      {msg.role === "assistant" && (
                        <div className="agent-header">
                          <div className="agent-label">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="2" strokeDasharray="2 3" />
                              <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
                            </svg>
                            <span>Faultline</span>
                          </div>
                          <div className="agent-actions">
                            {severity && (
                              <span className={`severity-badge severity-${severity.level}`}>
                                {severity.level === "critical" && (
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M12 2L2 22h20L12 2zm0 4l7.5 14h-15L12 6z" />
                                    <rect x="11" y="10" width="2" height="5" />
                                    <rect x="11" y="17" width="2" height="2" />
                                  </svg>
                                )}
                                {severity.level === "warning" && (
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <circle cx="12" cy="12" r="10" />
                                    <rect x="11" y="7" width="2" height="6" fill="white" />
                                    <rect x="11" y="15" width="2" height="2" fill="white" />
                                  </svg>
                                )}
                                {severity.level === "normal" && (
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                                {severity.label}
                              </span>
                            )}
                            {plainText && (
                              <button
                                className="copy-btn"
                                onClick={() => handleCopy(msg.id, plainText)}
                                aria-label="Copy response"
                                title="Copy"
                              >
                                {copiedId === msg.id ? (
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M20 6L9 17L4 12" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                ) : (
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2" />
                                  </svg>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="message-bubble">
                        {renderParts(parts)}
                      </div>
                    </div>

                    {/* Follow-up chips after the last agent message */}
                    {msg.role === "assistant" && isLastMsg && !isLoading && followUps && (
                      <div className="followup-row">
                        {followUps.map((q) => (
                          <button key={q} className="followup-chip" onClick={() => handleSend(q)}>{q}</button>
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}

              {isLoading && (
                <div className="message message-agent">
                  <div className="agent-header">
                    <div className="agent-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="#f6821f" strokeWidth="2" strokeDasharray="2 3" />
                        <circle cx="12" cy="12" r="2.5" fill="#f6821f" />
                      </svg>
                      <span>Faultline</span>
                    </div>
                  </div>
                  <div className="message-bubble">
                    <span className="typing-cursor" aria-label="Loading" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </main>

        {/* ── Input + chips ────────────────────────────── */}
        <footer className="input-area">
          {/* 6 query chips shown above input before first message */}
          {showChips && (
            <div className="query-chips">
              {QUERY_CHIPS.map((q) => (
                <button key={q} className="query-chip" onClick={() => handleSend(q)}>{q}</button>
              ))}
            </div>
          )}

          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Ask about internet outages, BGP hijacks, traffic anomalies..."
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              aria-label="Chat message"
            />
            <button
              className="send-btn"
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              aria-label="Send"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <p className="input-footer-text">
            Powered by Cloudflare Workers AI · Llama 3.3 · Real-time Radar data
          </p>
        </footer>

        {/* ── Status bar ───────────────────────────────── */}
        <div className="status-bar">
          <div className="metric-card">
            <span className="metric-label">Global BGP Routes</span>
            <span className="metric-value">
              {stats.loaded ? stats.routes : <span className="metric-loading" />}
            </span>
          </div>
          <div className="metric-divider" aria-hidden="true" />
          <div className="metric-card">
            <span className="metric-label">Active Outages</span>
            <span className="metric-value">
              {stats.loaded ? stats.outages : <span className="metric-loading" />}
            </span>
          </div>
          <div className="metric-divider" aria-hidden="true" />
          <div className="metric-card">
            <span className="metric-label">Last Updated</span>
            <span className="metric-value metric-time">
              {stats.loaded
                ? new Date(stats.updated).toLocaleTimeString()
                : <span className="metric-loading" />}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Types + rendering ────────────────────────────────────────────────────────

type MessagePart =
  | { type: "text"; text: string }
  | { type: "step-start" }
  | { type: "reasoning" }
  | { type: string; toolName?: string; state?: string };

function renderParts(parts: MessagePart[]): React.ReactNode {
  return parts.map((part, i) => {
    if (part.type === "text") {
      const text = (part as { type: "text"; text: string }).text;
      // Safety net: skip any leftover raw tool-call JSON
      if (text.trimStart().startsWith('{"type": "function') || text.trimStart().startsWith('{"type":"function')) {
        return null;
      }
      return <div key={i} className="part-text">{renderFormattedText(text)}</div>;
    }
    return null;
  });
}

function renderFormattedText(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return (
        <div key={i} className="msg-bullet">
          <span className="bullet-dot" aria-hidden="true">▸</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    }
    if (/^\d+\.\s/.test(line)) {
      return (
        <div key={i} className="msg-bullet">
          <span className="bullet-dot" aria-hidden="true">{line.match(/^\d+/)?.[0]}.</span>
          <span>{renderInline(line.replace(/^\d+\.\s/, ""))}</span>
        </div>
      );
    }
    if (line.startsWith("## ") || line.startsWith("### ")) {
      return <p key={i} className="msg-heading">{line.replace(/^#{2,3}\s/, "")}</p>;
    }
    if (line.trim() === "") return <div key={i} className="msg-spacer" />;
    return <p key={i}>{renderInline(line)}</p>;
  });
}

function renderInline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    return part;
  });
}
