import type { Observation } from "../lib/api";
import { ObservationCard } from "./ObservationCard";

export function Timeline({ observations }: { observations: Observation[] }) {
  if (observations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <svg className="w-12 h-12 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <p className="text-sm">No observations yet</p>
        <p className="text-xs text-gray-600 mt-1">Point your camera at something interesting</p>
      </div>
    );
  }

  // Sort newest first
  const sorted = [...observations].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="space-y-3">
      {sorted.map((obs) => (
        <ObservationCard key={obs.id} observation={obs} />
      ))}
    </div>
  );
}
