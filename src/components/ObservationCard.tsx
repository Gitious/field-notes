import { useState } from "react";
import type { Observation } from "../lib/api";
import { correctObservation } from "../lib/api";

const categoryColors: Record<string, string> = {
  hackathon_project: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  technology: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  signage: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  food: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  architecture: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  person: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  presentation: "bg-red-500/20 text-red-300 border-red-500/30",
  equipment: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  environment: "bg-teal-500/20 text-teal-300 border-teal-500/30",
};

function getCategoryStyle(cat: string) {
  return categoryColors[cat] || "bg-gray-500/20 text-gray-300 border-gray-500/30";
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

export function ObservationCard({
  observation,
  compact = false,
}: {
  observation: Observation;
  compact?: boolean;
}) {
  const [showCorrection, setShowCorrection] = useState(false);
  const [correction, setCorrection] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCorrect = async () => {
    if (!correction.trim()) return;
    setSubmitting(true);
    await correctObservation(observation.id, correction);
    setCorrection("");
    setShowCorrection(false);
    setSubmitting(false);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/10">
        <div className="flex-shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-sm text-gray-300 truncate">
          {observation.visual_description}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${getCategoryStyle(observation.category)}`}>
          {observation.category}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 p-4 backdrop-blur-sm hover:border-white/20 transition-all">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${getCategoryStyle(observation.category)}`}>
          {observation.category}
        </span>
        <div className="flex items-center gap-2">
          <div
            className="w-16 h-1.5 rounded-full bg-gray-700 overflow-hidden"
            title={`Confidence: ${(observation.confidence * 100).toFixed(0)}%`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400"
              style={{ width: `${observation.confidence * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{timeAgo(observation.timestamp)}</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-200 leading-relaxed mb-3">
        {observation.visual_description}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {observation.tags.map((tag) => (
          <span
            key={tag}
            className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 text-gray-400 border border-white/5"
          >
            #{tag}
          </span>
        ))}
      </div>

      {/* Web enrichment */}
      {observation.web_enrichment && (
        <div className="mt-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <div className="flex items-center gap-1.5 mb-1">
            <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span className="text-xs font-medium text-blue-300">{observation.web_enrichment.source}</span>
          </div>
          <p className="text-xs text-blue-200/70">{observation.web_enrichment.summary}</p>
          {observation.web_enrichment.url && (
            <a
              href={observation.web_enrichment.url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-blue-400 hover:underline mt-1 block"
            >
              {observation.web_enrichment.url}
            </a>
          )}
        </div>
      )}

      {/* Pattern note */}
      {observation.pattern_note && (
        <div className="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-xs text-amber-300">🔄 {observation.pattern_note}</p>
        </div>
      )}

      {/* Corrections */}
      {observation.corrections && observation.corrections.length > 0 && (
        <div className="mt-2 space-y-1">
          {observation.corrections.map((c, i) => (
            <div key={i} className="text-xs text-gray-400 italic">
              ✏️ Correction: {c}
            </div>
          ))}
        </div>
      )}

      {/* Correction input */}
      <div className="mt-2 pt-2 border-t border-white/5">
        {showCorrection ? (
          <div className="flex gap-2">
            <input
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCorrect()}
              placeholder="What should I learn?"
              className="flex-1 text-xs px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-white/20"
              autoFocus
            />
            <button
              onClick={handleCorrect}
              disabled={submitting}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50"
            >
              {submitting ? "..." : "Save"}
            </button>
            <button
              onClick={() => setShowCorrection(false)}
              className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-300"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowCorrection(true)}
            className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Correct this observation →
          </button>
        )}
      </div>
    </div>
  );
}
