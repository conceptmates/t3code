import type { LaunchSessionView } from "@t3tools/client-runtime/launch-sessions";
import type { LaunchConfigEntry, ServerProviderUsageLimits } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildRunState,
  limitChoices,
  MAX_POPOVER_ROWS,
  buildTouchBarState,
  sameTouchBarState,
  usageBar,
  usageWindowText,
  type TouchBarStripInput,
} from "./touchBarStrip";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");

const limits = (session: number, weekly: number): ServerProviderUsageLimits => ({
  checkedAt: new Date(NOW).toISOString(),
  windows: [
    {
      id: "five_hour",
      kind: "session",
      label: "Session",
      usedPercent: session,
      resetsAt: new Date(NOW + 2 * 60 * 60_000 + 13 * 60_000).toISOString(),
    },
    { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: weekly },
  ],
});

const entry = (name: string): LaunchConfigEntry =>
  ({ name, kind: "configuration" }) as unknown as LaunchConfigEntry;

const session = (overrides: Partial<LaunchSessionView> = {}): LaunchSessionView => ({
  name: "dev",
  terminalId: "launch-dev",
  entryName: "dev",
  running: true,
  exitCode: null,
  hotReload: false,
  ...overrides,
});

const input = (overrides: Partial<TouchBarStripInput> = {}): TouchBarStripInput => ({
  providers: [
    {
      instanceId: "claudeAgent",
      displayName: "Claude",
      driverKind: "claudeAgent",
      usageLimits: limits(62, 31),
    },
  ],
  selectedInstanceId: "claudeAgent",
  sidebarOpen: true,
  terminalOpen: null,
  projects: [{ key: "t3code", label: "t3code", selected: false }],
  projectFilter: [
    { key: "all", label: "All projects", selected: true },
    { key: "t3code", label: "t3code", selected: false },
  ],
  run: null,
  now: NOW,
  ...overrides,
});

describe("usageBar", () => {
  it("fills one cell per tenth and clamps out-of-range percentages", () => {
    expect(usageBar(0)).toBe("░░░░░░░░░░");
    expect(usageBar(62)).toBe("▓▓▓▓▓▓░░░░");
    expect(usageBar(100)).toBe("▓▓▓▓▓▓▓▓▓▓");
    expect(usageBar(140)).toBe("▓▓▓▓▓▓▓▓▓▓");
    expect(usageBar(-20)).toBe("░░░░░░░░░░");
  });
});

describe("usageWindowText", () => {
  it("labels the session window in hours and counts down to its reset", () => {
    const [session5h] = limits(62, 31).windows;
    expect(usageWindowText(session5h!, NOW)).toBe("5h ▓▓▓▓▓▓░░░░ 62% · 2h 13m");
  });

  it("omits the countdown when the provider reports no reset time", () => {
    expect(usageWindowText(limits(62, 31).windows[1]!, NOW)).toBe("Wk ▓▓▓░░░░░░░ 31%");
  });

  it("reads a reset already in the past as due now", () => {
    const [session5h] = limits(62, 31).windows;
    expect(usageWindowText(session5h!, NOW + 10 * 60 * 60_000)).toContain("· now");
  });
});

describe("buildRunState", () => {
  it("offers the primary entry when nothing is running", () => {
    expect(
      buildRunState({
        primaryLaunchEntry: entry("dev"),
        launchSessions: [],
        launchBlockedReason: null,
      }),
    ).toEqual({ label: "Run dev", state: "idle" });
  });

  it("offers to stop once a launch session is up", () => {
    expect(
      buildRunState({
        primaryLaunchEntry: entry("dev"),
        launchSessions: [session()],
        launchBlockedReason: null,
      }),
    ).toEqual({ label: "Stop dev", state: "running" });
  });

  it("falls back to the session name when launch.json no longer has the entry", () => {
    expect(
      buildRunState({
        primaryLaunchEntry: null,
        launchSessions: [session({ entryName: null, name: "old" })],
        launchBlockedReason: null,
      })?.label,
    ).toBe("Stop old");
  });

  it("blocks the button when the entry cannot start", () => {
    expect(
      buildRunState({
        primaryLaunchEntry: entry("dev"),
        launchSessions: [],
        launchBlockedReason: "flutter is not installed",
      }),
    ).toEqual({ label: "Run dev", state: "blocked" });
  });

  it("returns null with no launch config, so the strip drops the button", () => {
    expect(
      buildRunState({ primaryLaunchEntry: null, launchSessions: [], launchBlockedReason: null }),
    ).toBeNull();
  });
});

describe("buildTouchBarState", () => {
  it("never writes the provider name: the glyph carries it", () => {
    const state = buildTouchBarState(input());
    expect(state.providers).toEqual([
      {
        instanceId: "claudeAgent",
        driverKind: "claudeAgent",
        label: "62%",
        detail: "5h ▓▓▓▓▓▓░░░░ 62% · 2h 13m   Wk ▓▓▓░░░░░░░ 31%",
        selected: true,
        accessibilityLabel: "Claude: 5h 62 percent used, Wk 31 percent used",
      },
    ]);
  });

  it("drops a provider that can never report quota", () => {
    // An API-key connection is `unsupported`: a chip for it would be blank
    // forever, so it earns no space on the strip.
    const unsupported: ServerProviderUsageLimits = {
      checkedAt: new Date(NOW).toISOString(),
      windows: [],
      unavailable: { reason: "unsupported" },
    };
    expect(
      buildTouchBarState(
        input({
          providers: [
            {
              instanceId: "claude_api",
              displayName: "Claude",
              driverKind: "claudeAgent",
              usageLimits: unsupported,
            },
          ],
        }),
      ).providers,
    ).toEqual([]);
  });

  it("drops a provider whose probe failed, rather than showing an empty chip", () => {
    // A chip with no percentage is the one thing the strip exists to show;
    // without it the provider earns no space.
    const probeFailed: ServerProviderUsageLimits = {
      checkedAt: new Date(NOW).toISOString(),
      windows: [],
      unavailable: { reason: "probeFailed" },
    };
    expect(
      buildTouchBarState(
        input({
          providers: [
            {
              instanceId: "claudeAgent",
              displayName: "Claude",
              driverKind: "claudeAgent",
              usageLimits: probeFailed,
            },
          ],
        }),
      ).providers,
    ).toEqual([]);
  });

  it("carries the project and filter choices through, truncating long names", () => {
    const state = buildTouchBarState(
      input({
        projects: [
          { key: "p", label: "a-very-long-project-name-that-will-not-fit", selected: true },
        ],
      }),
    );
    expect(state.projects[0]?.label.length).toBeLessThanOrEqual(24);
    expect(state.projects[0]?.selected).toBe(true);
    expect(state.projectFilter.map((choice) => choice.key)).toEqual(["all", "t3code"]);
  });

  it("passes the run slot straight through, including absent", () => {
    expect(buildTouchBarState(input()).run).toBeNull();
    expect(buildTouchBarState(input({ run: { label: "Run dev", state: "idle" } })).run).toEqual({
      label: "Run dev",
      state: "idle",
    });
  });
});

describe("sameTouchBarState", () => {
  it("treats a rebuild of unchanged state as identical", () => {
    expect(sameTouchBarState(buildTouchBarState(input()), buildTouchBarState(input()))).toBe(true);
  });

  it("notices a quota move, a provider switch, a filter change, and a run change", () => {
    const base = buildTouchBarState(input());
    const moved = buildTouchBarState(
      input({
        providers: [
          {
            instanceId: "claudeAgent",
            displayName: "Claude",
            driverKind: "claudeAgent",
            usageLimits: limits(71, 31),
          },
        ],
      }),
    );
    expect(sameTouchBarState(base, moved)).toBe(false);
    expect(sameTouchBarState(base, buildTouchBarState(input({ selectedInstanceId: null })))).toBe(
      false,
    );
    expect(
      sameTouchBarState(
        base,
        buildTouchBarState(
          input({
            projectFilter: [
              { key: "all", label: "All projects", selected: false },
              { key: "t3code", label: "t3code", selected: true },
            ],
          }),
        ),
      ),
    ).toBe(false);
    expect(
      sameTouchBarState(
        base,
        buildTouchBarState(input({ run: { label: "Run dev", state: "idle" } })),
      ),
    ).toBe(false);
  });

  it("compares null against a strip without crashing", () => {
    expect(sameTouchBarState(null, null)).toBe(true);
    expect(sameTouchBarState(null, buildTouchBarState(input()))).toBe(false);
  });
});

describe("limitChoices", () => {
  const choice = (key: string, selected = false) => ({ key, label: key, selected });

  it("leaves a list that already fits alone", () => {
    const choices = [choice("a"), choice("b")];
    expect(limitChoices(choices)).toBe(choices);
  });

  it("keeps the first rows when nothing past the cut is selected", () => {
    const choices = Array.from({ length: 10 }, (_, index) => choice(`p${index}`));
    expect(limitChoices(choices).map((c) => c.key)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("pulls the selected row in when it falls past the cut", () => {
    const choices = Array.from({ length: 10 }, (_, index) => choice(`p${index}`, index === 9));
    const limited = limitChoices(choices);
    expect(limited).toHaveLength(MAX_POPOVER_ROWS);
    expect(limited.at(-1)?.key).toBe("p9");
    // A filter you cannot see is a filter you cannot tell is on.
    expect(limited.some((c) => c.selected)).toBe(true);
  });

  it("does not displace a selection that already fits", () => {
    const choices = Array.from({ length: 10 }, (_, index) => choice(`p${index}`, index === 2));
    expect(limitChoices(choices).map((c) => c.key)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("honours a smaller cap, as the filter list uses", () => {
    const choices = Array.from({ length: 10 }, (_, index) => choice(`p${index}`));
    expect(limitChoices(choices, 3)).toHaveLength(3);
  });
});

describe("drawer toggles", () => {
  it("carries the sidebar state, and omits the terminal outside a thread", () => {
    const state = buildTouchBarState(input());
    expect(state.sidebarOpen).toBe(true);
    // Null, not false: there is no terminal drawer to be closed.
    expect(state.terminalOpen).toBeNull();
  });

  it("notices either drawer opening or closing", () => {
    const base = buildTouchBarState(input());
    expect(sameTouchBarState(base, buildTouchBarState(input({ sidebarOpen: false })))).toBe(false);
    expect(sameTouchBarState(base, buildTouchBarState(input({ terminalOpen: false })))).toBe(false);
    expect(sameTouchBarState(base, buildTouchBarState(input({ terminalOpen: true })))).toBe(false);
  });
});
