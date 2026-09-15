import { memo } from "react";
import { ArrowLeft, Bot } from "lucide-react";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { formatSubagentTokenCount } from "@t3tools/client-runtime/state/subagentRuntime";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";

function statusLabelFor(status: RuntimeSubagent["status"]): string {
  if (status === "pending" || status === "running" || status === "waiting") return "Working";
  if (status === "idle") return "Idle · resumable";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Stopped";
}

function dotClassFor(status: RuntimeSubagent["status"]): string {
  if (status === "pending" || status === "running" || status === "waiting") return "bg-info";
  if (status === "idle") return "bg-muted-foreground/50";
  if (status === "completed") return "bg-success";
  if (status === "failed") return "bg-destructive";
  return "bg-muted-foreground/60";
}

/**
 * Desktop-only selected sub-agent view. Replaces the main timeline when a row
 * in the Agents panel is picked (Claude-style): header with Back, then the
 * agent's goal/plan, live activity, and metrics from existing `task.*` fields.
 * Full text transcript is Stage 2 — narration is dropped server-side today.
 */
export const SubagentDetailView = memo(function SubagentDetailView({
  agent,
  onBack,
  canStop = false,
  stopping = false,
  onStop,
}: {
  agent: RuntimeSubagent;
  onBack: () => void;
  canStop?: boolean | undefined;
  stopping?: boolean | undefined;
  onStop?: (() => void) | undefined;
}) {
  const goal = agent.progress ?? agent.result ?? null;
  const live =
    agent.status === "pending" || agent.status === "running" || agent.status === "waiting";
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label="Back to main thread"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to main
        </Button>
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", dotClassFor(agent.status))}
        />
        <span className="min-w-0 truncate text-sm font-medium">{agent.title}</span>
        {agent.role ? (
          <span className="max-w-28 shrink-0 truncate rounded-sm border border-border/60 px-1 font-mono text-[.65rem] text-muted-foreground">
            {agent.role}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {statusLabelFor(agent.status)}
        </span>
        {live && canStop && onStop ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={stopping}
            onClick={() => onStop()}
            aria-label={stopping ? `Stopping ${agent.title}` : `Stop ${agent.title}`}
            title="Stop this agent"
          >
            {stopping ? "Stopping..." : "Stop"}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          <section aria-label="Goal" className="rounded-lg border border-border/60 bg-card/40 p-3">
            <div className="flex items-center gap-2 text-[.65rem] font-medium uppercase tracking-wider text-muted-foreground">
              <Bot aria-hidden className="size-3.5" />
              Goal
            </div>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
              {goal ?? "No goal reported yet — live activity appears below as it runs."}
            </p>
            {agent.phases.length > 0 ? (
              <ol className="mt-2 flex flex-col gap-1">
                {agent.phases.map((phase) => (
                  <li key={phase.index} className="font-mono text-[.7rem] text-muted-foreground">
                    Phase {phase.index + 1} · {phase.title}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
          <section
            aria-label="Activity"
            className="rounded-lg border border-border/60 bg-card/40 p-3"
          >
            <div className="text-[.65rem] font-medium uppercase tracking-wider text-muted-foreground">
              Activity
            </div>
            {agent.lastToolName ? (
              <p className="mt-1.5 font-mono text-xs text-foreground/90">▸ {agent.lastToolName}</p>
            ) : null}
            {agent.recentActivity.length > 0 ? (
              <ol className="mt-1.5 flex flex-col gap-1.5">
                {agent.recentActivity.map((entry, index) => (
                  <li
                    key={`${entry.at}-${index}`}
                    className="text-xs leading-relaxed text-muted-foreground"
                  >
                    {entry.summary}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">No activity yet.</p>
            )}
            {agent.error ? (
              <p className="mt-2 text-xs text-destructive-foreground">{agent.error}</p>
            ) : null}
          </section>
          <section
            aria-label="Metrics"
            className="rounded-lg border border-border/60 bg-card/40 p-3"
          >
            <div className="text-[.65rem] font-medium uppercase tracking-wider text-muted-foreground">
              Metrics
            </div>
            <p className="mt-1.5 font-mono text-[.7rem] tabular-nums text-muted-foreground/80">
              {agent.usage ? `${formatSubagentTokenCount(agent.usage.totalTokens)} tok` : "— tok"}
              {agent.usage?.toolUses !== undefined ? ` · ${agent.usage.toolUses} tools` : ""}
              {agent.activationCount > 1 ? ` · run ${agent.activationCount}` : ""}
            </p>
          </section>
          <p className="text-center text-[.65rem] text-muted-foreground/70">
            Full message transcript ships in Stage 2 — sub-agent narration is dropped server-side
            today, so this view shows plan, tools, and outcome.
          </p>
        </div>
      </div>
    </div>
  );
});
