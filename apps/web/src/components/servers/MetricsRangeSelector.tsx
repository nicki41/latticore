import type { MetricsRange } from "@latticore/shared";
import { cn } from "@/lib/utils";

const RANGES: { value: MetricsRange; label: string }[] = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
];

export function MetricsRangeSelector({ value, onChange }: { value: MetricsRange; onChange: (v: MetricsRange) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-1">
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => onChange(r.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === r.value ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
