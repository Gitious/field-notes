import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocalRuntime, AssistantRuntimeProvider } from "@assistant-ui/react";
import { Thread } from "@assistant-ui/react-ui";
import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/themes/default.css";
import {
  fetchObservations,
  fetchStats,
  queryObservations,
  type Observation,
  type Stats,
} from "../lib/api";
import { Timeline } from "../components/Timeline";
import type { ChatModelAdapter } from "@assistant-ui/react";

const fieldNotesAdapter: ChatModelAdapter = {
  async *run({ messages }) {
    const lastMessage = messages[messages.length - 1];
    const userText = lastMessage.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join(" ") || "";
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: userText }),
    });
    const data = await res.json();
    yield { content: [{ type: "text" as const, text: data.answer }] };
  },
};

export function Dashboard() {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "timeline" | "report" | "stats">("timeline");
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [report, setReport] = useState<string>("");
  const [reportLoading, setReportLoading] = useState(false);

  const runtime = useLocalRuntime(fieldNotesAdapter);

  // Load initial data
  useEffect(() => {
    fetchObservations().then(setObservations).catch(() => {});
    fetchStats().then(setStats).catch(() => {});
    fetch("/api/activity").then(r => r.json()).then(setActivity).catch(() => {});
  }, []);

  // Live WebSocket updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/live?mode=dashboard`);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "init") {
            setObservations(msg.observations);
          } else if (msg.type === "new_observation") {
            setObservations((prev) => [msg.observation, ...prev]);
          }
        } catch {}
      };

      ws.onerror = () => {};
    } catch {}

    return () => {
      try {
        ws?.close();
      } catch {}
    };
  }, []);

  // Refresh stats periodically
  useEffect(() => {
    const id = setInterval(() => {
      fetchStats().then(setStats).catch(() => {});
      fetch("/api/activity").then(r => r.json()).then(setActivity).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const handleExport = async () => {
    // Download CSV
    const link = document.createElement("a");
    link.href = "/api/export/csv";
    link.download = "field-notes-observations.csv";
    link.click();
    // Open Nexla Express.Dev
    window.open("https://express.dev", "_blank");
  };

  const generateReport = async () => {
    setReportLoading(true);
    try {
      const res = await fetch("/api/report", { method: "POST" });
      const data = await res.json();
      setReport(data.report);
      setActiveTab("chat"); // Switch to show report
    } catch {
      setReport("Error generating report.");
    } finally {
      setReportLoading(false);
    }
  };

  const filteredObservations = useMemo(
    () =>
      filterCategory
        ? observations.filter((o) => o.category === filterCategory)
        : observations,
    [observations, filterCategory]
  );

  const categories = stats?.categories || {};

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold">
              FN
            </div>
            <div>
              <h1 className="text-lg font-bold">Field Notes</h1>
              <p className="text-xs text-gray-500">Autonomous Field Research Agent</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {stats?.totalObservations || 0} observations
            </div>
            <button
              onClick={generateReport}
              disabled={reportLoading}
              className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-colors disabled:opacity-50"
            >
              {reportLoading ? "Generating..." : "Generate Report"}
            </button>
            <button
              onClick={handleExport}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
            >
              Export CSV + Nexla
            </button>
            <a
              href="/camera"
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
            >
              Open Camera
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto flex gap-6 p-6 h-[calc(100vh-73px)]">
        {/* Left — Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center gap-1 mb-4">
            {(["timeline", "chat", "report", "stats"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab
                    ? "bg-white/10 text-white"
                    : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Category filters */}
          {activeTab === "timeline" && Object.keys(categories).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              <button
                onClick={() => setFilterCategory(null)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  !filterCategory
                    ? "bg-white/10 text-white border-white/20"
                    : "text-gray-500 border-white/5 hover:border-white/10"
                }`}
              >
                All ({observations.length})
              </button>
              {Object.entries(categories).map(([cat, count]) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat === filterCategory ? null : cat)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    filterCategory === cat
                      ? "bg-white/10 text-white border-white/20"
                      : "text-gray-500 border-white/5 hover:border-white/10"
                  }`}
                >
                  {cat} ({count})
                </button>
              ))}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === "timeline" && (
              <div className="h-full overflow-y-auto">
                <Timeline observations={filteredObservations} />
              </div>
            )}

            {activeTab === "chat" && (
              <AssistantRuntimeProvider runtime={runtime}>
                <div className="aui-root h-full" style={{ colorScheme: "dark" }}>
                  <style>{`
                    .aui-root { --aui-background: transparent; height: 100%; display: flex; flex-direction: column; }
                    .aui-thread-root { background: transparent !important; flex: 1; overflow-y: auto; }
                    .aui-composer-root { background: rgba(255,255,255,0.05) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 12px !important; }
                    .aui-composer-input { color: white !important; }
                    .aui-composer-input::placeholder { color: #666 !important; }
                    .aui-assistant-message-content { color: #e5e7eb !important; }
                    .aui-user-message-content { background: rgba(59,130,246,0.2) !important; color: #bfdbfe !important; }
                    .aui-composer-send { background: #3b82f6 !important; }
                  `}</style>
                  <Thread />
                </div>
              </AssistantRuntimeProvider>
            )}

            {activeTab === "report" && (
              <div className="h-full overflow-y-auto">
                {report ? (
                  <div className="prose prose-invert prose-sm max-w-none p-4 bg-white/5 rounded-xl border border-white/10">
                    <div className="whitespace-pre-wrap text-sm text-gray-200">{report}</div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-600">
                    <p className="text-sm mb-4">Generate a synthesized field research report from all observations</p>
                    <button
                      onClick={generateReport}
                      disabled={reportLoading}
                      className="px-6 py-2 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 disabled:opacity-50"
                    >
                      {reportLoading ? "Generating..." : "Generate Report"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === "stats" && stats && (
              <div className="space-y-6 overflow-y-auto h-full">
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-2xl font-bold">{stats.totalObservations}</div>
                    <div className="text-xs text-gray-500 mt-1">Total Observations</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-2xl font-bold">{stats.sessions}</div>
                    <div className="text-xs text-gray-500 mt-1">Sessions</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-2xl font-bold">{Object.keys(stats.categories).length}</div>
                    <div className="text-xs text-gray-500 mt-1">Categories</div>
                  </div>
                </div>

                {/* Category breakdown */}
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <h3 className="text-sm font-semibold mb-3">Categories</h3>
                  <div className="space-y-2">
                    {Object.entries(stats.categories)
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, count]) => (
                        <div key={cat} className="flex items-center gap-3">
                          <span className="text-xs text-gray-400 w-32 truncate">{cat}</span>
                          <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
                              style={{
                                width: `${(count / stats.totalObservations) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Export history */}
                {stats.exports.length > 0 && (
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <h3 className="text-sm font-semibold mb-3">Exports (via Nexla)</h3>
                    <div className="space-y-2">
                      {stats.exports.map((exp: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 text-xs text-gray-400">
                          <span className="text-green-400">✓</span>
                          <span>
                            {exp.recordCount} records → {exp.destination}
                          </span>
                          <span className="text-gray-600">
                            {new Date(exp.timestamp).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar — Autonomous Activity */}
        <div className="w-80 flex-shrink-0 flex flex-col overflow-hidden border-l border-white/10 pl-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Autonomous Activity
          </h3>
          <div className="flex-1 overflow-y-auto space-y-2">
            {activity.length === 0 && observations.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-8">
                No activity yet. Open the camera to start.
              </p>
            )}
            {[...activity].reverse().slice(0, 30).map((evt: any) => {
              const icons: Record<string, string> = {
                session_start: "🟢",
                session_end: "🔴",
                ai_spoke: "🗣️",
                observation: "👁️",
                export: "📤",
                enrichment: "🌐",
                correction: "✏️",
              };
              return (
                <div key={evt.id} className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.03] text-xs">
                  <span className="flex-shrink-0">{icons[evt.type] || "⚡"}</span>
                  <div className="min-w-0">
                    <span className="text-gray-300">{evt.summary.slice(0, 80)}</span>
                    <div className="text-[10px] text-gray-600 mt-0.5">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
