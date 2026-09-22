import type { DeviceServiceState, EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { deviceEnvironment } from "~/state/device";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";

/** Shared by setup, Settings, and the Device panel so automatic updates stay visible. */
export function DeviceHostUpdates({
  state,
  environmentId,
}: {
  state: DeviceServiceState;
  environmentId: EnvironmentId;
}) {
  const retry = useAtomCommand(deviceEnvironment.list);
  const [pending, setPending] = useState<string | null>(null);
  if (state.hostStatus === "disabled") return null;
  return (
    <div className="space-y-2">
      {state.hosts.map((host) => {
        const status = state.hostStatuses[host.id];
        if (!status || !["installing", "starting", "failed"].includes(status.status)) return null;
        const failed = status.status === "failed";
        return (
          <div
            key={host.id}
            role={failed ? "alert" : "status"}
            className={cn(
              "flex items-start gap-3 rounded-md border px-3 py-2 text-xs",
              failed ? "border-destructive/50 bg-destructive/5" : "border-border/60",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className={cn("font-medium", failed && "text-destructive")}>{host.label}</p>
              <p
                className={cn(
                  "whitespace-pre-wrap break-words",
                  failed ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {status.detail ??
                  (failed
                    ? "Device support could not start."
                    : status.status === "installing"
                      ? "Installing device tools…"
                      : "Starting device tools…")}
              </p>
              {failed ? (
                <p className="mt-1 text-muted-foreground">
                  Check the host connection and network access, then retry. Your device settings are
                  saved.
                </p>
              ) : null}
            </div>
            {failed ? (
              <Button
                size="compact"
                variant="outline"
                disabled={pending !== null}
                onClick={() => {
                  setPending(host.id);
                  // An environment too old to advertise per-host retry still
                  // re-runs readiness for every host on a plain list, so the
                  // way out of a failure never depends on the capability.
                  void retry({
                    environmentId,
                    input: state.supportsHostRetry ? { retryHostId: host.id } : {},
                  }).finally(() => setPending(null));
                }}
              >
                {pending === host.id ? "Retrying…" : "Retry"}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
