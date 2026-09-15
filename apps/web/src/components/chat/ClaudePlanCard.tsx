import { memo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, CircleDot, ListChecks } from "lucide-react";

import { cn } from "~/lib/utils";

export interface ClaudePlanStep {
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
  readonly durationMs?: number | undefined;
}

/**
 * Floating goal/plan checklist. Renders the active `turn.plan.updated`
 * payload (Claude TaskCreate/Update/List) the way Claude shows it:
 * seeded steps with pending → active → done states. Overlaps the timeline
 * top-right so it never pushes messages; collapses to a side pill.
 */
export const ClaudePlanCard = memo(function ClaudePlanCard({
  explanation,
  steps,
  live,
}: {
  explanation?: (string | null) | undefined;
  steps: ReadonlyArray<ClaudePlanStep>;
  live?: boolean | undefined;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (steps.length === 0) return null;
  const done = steps.filter((step) => step.status === "completed").length;
  const active = steps.filter((step) => step.status === "inProgress").length;
  if (collapsed) {
    return (
      <div className="pointer-events-none absolute top-2 right-3 z-20 flex justify-end">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label={`Expand plan, ${done} of ${steps.length} done`}
          className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/60 bg-card/95 px-2.5 py-1 font-mono text-[.65rem] tabular-nums text-muted-foreground shadow-lg backdrop-blur transition-colors duration-150 hover:text-foreground"
        >
          <ListChecks aria-hidden className="size-3.5" />
          Plan {done}/{steps.length}
          <ChevronDown aria-hidden className="size-3" />
        </button>
      </div>
    );
  }
  return (
    <section
      aria-label={explanation?.trim() ? `Plan: ${explanation.trim()}` : "Plan"}
      className="absolute top-2 right-3 z-20 max-h-72 w-[320px] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border border-border/60 bg-card/95 p-2.5 shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        <ListChecks aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 truncate">
          {explanation?.trim() ? explanation.trim() : "Plan"}
        </span>
        {live ? (
          <span className="inline-flex items-center gap-1 font-mono text-[.65rem] text-info-foreground">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-info" />
            active
          </span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[.65rem] tabular-nums text-muted-foreground">
          {done}/{steps.length} done{active > 0 ? ` · ${active} active` : ""}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-expanded={true}
          aria-label="Collapse plan to side pill"
          className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ChevronUp aria-hidden className="size-3.5" />
        </button>
      </div>
      <ol className="mt-1.5 flex flex-col gap-1">
        {steps.map((step) => (
          <li key={step.step} className="flex items-start gap-2 text-xs">
            {step.status === "completed" ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
            ) : step.status === "inProgress" ? (
              <CircleDot aria-hidden className="mt-0.5 size-3.5 shrink-0 text-info" />
            ) : (
              <Circle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 leading-relaxed",
                step.status === "completed"
                  ? "text-muted-foreground line-through decoration-muted-foreground/50"
                  : "text-foreground/90",
              )}
            >
              {step.step}
            </span>
            <span className="sr-only">
              {step.status === "completed"
                ? "completed"
                : step.status === "inProgress"
                  ? "in progress"
                  : "pending"}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
});
