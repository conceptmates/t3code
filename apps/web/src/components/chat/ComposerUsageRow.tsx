import type {
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { formatDuration, formatResetsIn } from "@t3tools/shared/usageLimits";
import { memo, useEffect, useState } from "react";

import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { barColor } from "../usage/UsageLimits";

const MINUTE = 60_000;
const TRIGGER_CLASS_NAME =
  "flex cursor-default items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The account's 5-hour and main weekly windows. Model-scoped weekly buckets
 * (`Weekly · <model>`) stay on Usage → Limits so the row stays two bars.
 */
export function composerLimitWindows(
  limits: ServerProviderUsageLimits | undefined,
): ServerProviderUsageWindow[] {
  if (!limits || limits.unavailable?.reason === "unsupported") return [];
  const session = limits.windows.find((window) => window.kind === "session");
  const weekly =
    limits.windows.find((window) => window.kind === "weekly" && window.label === "Weekly") ??
    limits.windows.find((window) => window.kind === "weekly");
  return [session, weekly].filter((window) => window !== undefined);
}

/** `2h 13m` until reset, `now` once it has passed, null without a reset time. */
function resetCountdown(window: ServerProviderUsageWindow, now: number): string | null {
  if (window.resetsAt === undefined) return null;
  const at = Date.parse(window.resetsAt);
  if (!Number.isFinite(at)) return null;
  return at <= now ? "now" : formatDuration(at - now);
}

function LimitBar({
  window,
  color,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly color: string;
  readonly now: number;
}) {
  const used = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
  const countdown = resetCountdown(window, now);
  const resetsIn = formatResetsIn(window, now);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            tabIndex={0}
            aria-label={`${window.label} limit: ${used}% used${resetsIn ? `, ${resetsIn}` : ""}`}
            className={TRIGGER_CLASS_NAME}
          />
        }
      >
        <span>{window.kind === "session" ? "5h" : "Week"}</span>
        <span aria-hidden className="relative h-1 w-14 overflow-hidden rounded-full bg-muted">
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${used}%`,
              backgroundColor: used >= 90 ? "var(--color-error)" : color,
            }}
          />
        </span>
        <span className="text-foreground/80">{used}%</span>
        {countdown ? <span className="text-muted-foreground/70">· {countdown}</span> : null}
      </TooltipTrigger>
      <TooltipPopup side="top" className="text-xs">
        {window.label}: {used}% used{resetsIn ? ` · ${resetsIn}` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Context use, skills used, and quota spent for the selected provider, under the composer. */
export const ComposerUsageRow = memo(function ComposerUsageRow(props: {
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly skills: readonly string[];
  readonly driver: ServerProvider["driver"] | null;
  readonly windows: readonly ServerProviderUsageWindow[];
}) {
  const windows = props.driver === null ? [] : props.windows;
  const hasCountdown = windows.some((window) => window.resetsAt !== undefined);
  const [now, setNow] = useState(Date.now);
  // Countdowns only show minutes, so one tick a minute keeps them honest.
  useEffect(() => {
    if (!hasCountdown) return;
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, [hasCountdown]);

  const contextPercent = props.contextWindow?.usedPercentage ?? null;
  const showContext = contextPercent !== null && Number.isFinite(contextPercent);
  if (!showContext && props.skills.length === 0 && windows.length === 0) return null;
  const color = props.driver === null ? "var(--foreground)" : barColor(props.driver);
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-6 gap-y-1.5 px-4 pt-2.5 pb-1 text-[11px] text-muted-foreground tabular-nums">
      {showContext ? (
        <span>
          Context <span className="text-foreground/80">{Math.round(contextPercent)}%</span>
        </span>
      ) : null}
      {props.skills.length > 0 ? (
        <Popover>
          <PopoverTrigger
            openOnHover
            delay={150}
            render={
              <button
                type="button"
                aria-label={`Skills used (${props.skills.length}): ${props.skills.join(", ")}. Activate to show skills.`}
                className="flex cursor-pointer items-center gap-2 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            Skills <span className="text-foreground/80">{props.skills.length}</span>
          </PopoverTrigger>
          <PopoverPopup side="top" align="center" className="max-w-72 text-xs">
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-medium text-muted-foreground">
                Skills used · {props.skills.length}
              </div>
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {props.skills.map((skill) => (
                  <li
                    key={skill}
                    className="truncate rounded-sm border border-border/50 bg-background/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90"
                    title={skill}
                  >
                    {skill}
                  </li>
                ))}
              </ul>
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
      {windows.map((window) => (
        <LimitBar key={window.id} window={window} color={color} now={now} />
      ))}
    </div>
  );
});
