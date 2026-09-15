import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { composerLimitWindows } from "./ComposerUsageRow";

const window = (
  id: string,
  kind: ServerProviderUsageWindow["kind"],
  label: string,
): ServerProviderUsageWindow => ({ id, kind, label, usedPercent: 40 });

const limits = (
  windows: ServerProviderUsageWindow[],
  unavailable?: ServerProviderUsageLimits["unavailable"],
): ServerProviderUsageLimits => ({
  checkedAt: "2026-09-14T00:00:00.000Z",
  windows,
  ...(unavailable ? { unavailable } : {}),
});

describe("composerLimitWindows", () => {
  it("picks the session window and the account-wide weekly over a model-scoped one", () => {
    const picked = composerLimitWindows(
      limits([
        window("seven_day_fable", "weekly", "Weekly · Fable"),
        window("seven_day", "weekly", "Weekly"),
        window("five_hour", "session", "Session"),
      ]),
    );
    expect(picked.map((entry) => entry.id)).toEqual(["five_hour", "seven_day"]);
  });

  it("keeps the last bars through a failed probe but not for accounts without limits", () => {
    const windows = [window("primary", "session", "Session")];
    expect(composerLimitWindows(limits(windows, { reason: "probeFailed" }))).toHaveLength(1);
    expect(composerLimitWindows(limits(windows, { reason: "unsupported" }))).toEqual([]);
  });

  it("shows nothing for a monthly-only plan", () => {
    expect(composerLimitWindows(limits([window("primary", "monthly", "Monthly")]))).toEqual([]);
  });
});
