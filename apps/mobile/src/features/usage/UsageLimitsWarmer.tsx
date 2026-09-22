import { useAtomValue } from "@effect/atom-react";
import { warmUsageLimits } from "@t3tools/client-runtime/state/usage";
import { useEffect, useEffectEvent } from "react";

import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * Fetches provider limits once per environment as it connects, matching the
 * web client, so the usage screens open warm instead of empty.
 *
 * Renders nothing. The connected ids are joined into a string so a reconnect or
 * an unrelated presentation update does not re-run the effect; `warmUsageLimits`
 * throttles per environment on top of that.
 */
export function UsageLimitsWarmer() {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const connected = [...presentations]
    .filter(([, presentation]) => presentation.connection.phase === "connected")
    .map(([environmentId]) => environmentId)
    .sort();
  // The effect keys off the joined ids so an unrelated presentation update, or
  // a reconnect that changes nothing, does not re-run it.
  const connectedKey = connected.join(",");

  const warmConnected = useEffectEvent(() => {
    if (connected.length === 0) return;
    void warmUsageLimits({
      environmentIds: connected,
      refresh: (environmentId) => refreshProviders({ environmentId, input: {} }),
    });
  });

  useEffect(() => {
    warmConnected();
  }, [connectedKey]);

  return null;
}
