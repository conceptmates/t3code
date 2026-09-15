import { launchTerminalId, type LaunchConfigEntry, type TerminalSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  launchEntryBlockedReason,
  launchEntryMissingBinary,
  launchEntryMissingInputIds,
  primaryLaunchEntry,
  selectLaunchSessions,
} from "./launchSessions.ts";

const entry = (
  name: string,
  status: LaunchConfigEntry["status"] = { _tag: "runnable", steps: [] },
  hotReload = false,
): LaunchConfigEntry => ({
  name,
  kind: "configuration",
  type: "node",
  request: "launch",
  configurations: [],
  hotReload,
  warnings: [],
  status,
});

const terminal = (
  terminalId: string,
  overrides: Partial<TerminalSummary> = {},
): TerminalSummary => ({
  threadId: "thread-1",
  terminalId,
  cwd: "/work/app",
  worktreePath: null,
  status: "running",
  pid: 42,
  exitCode: null,
  exitSignal: null,
  hasRunningSubprocess: true,
  label: "",
  updatedAt: "2026-09-14T00:00:00.000Z",
  ...overrides,
});

describe("selectLaunchSessions", () => {
  it("joins launch terminals with their entries and ignores other terminals", () => {
    const entries = [entry("Server"), entry("Mobile", undefined, true)];

    expect(
      selectLaunchSessions(entries, [
        terminal("term-1"),
        terminal(launchTerminalId("Mobile")),
        terminal(launchTerminalId("Server"), { status: "exited", exitCode: 1 }),
      ]),
    ).toEqual([
      {
        name: "Mobile",
        terminalId: launchTerminalId("Mobile"),
        entryName: "Mobile",
        running: true,
        exitCode: null,
        hotReload: true,
      },
      {
        name: "Server",
        terminalId: launchTerminalId("Server"),
        entryName: "Server",
        running: false,
        exitCode: 1,
        hotReload: false,
      },
    ]);
  });

  it("keeps sessions whose entry was renamed or removed, without a restart target", () => {
    expect(
      selectLaunchSessions([], [terminal("launch-old-1234abcd", { label: "node" })]),
    ).toMatchObject([{ name: "node", entryName: null, hotReload: false }]);
  });
});

describe("primaryLaunchEntry", () => {
  const entries = [
    entry("Attach", { _tag: "unsupported", reason: "Needs a debugger." }),
    entry("Server"),
    entry("Worker"),
  ];

  it("prefers the last entry run, then the first runnable one", () => {
    expect(primaryLaunchEntry(entries, "Worker")?.name).toBe("Worker");
    expect(primaryLaunchEntry(entries, "Deleted")?.name).toBe("Server");
    expect(primaryLaunchEntry(entries, null)?.name).toBe("Server");
  });

  it("falls back to the first entry when none can run, and to null when there are none", () => {
    expect(primaryLaunchEntry([entries[0]!], null)?.name).toBe("Attach");
    expect(primaryLaunchEntry([], null)).toBeNull();
  });
});

describe("launchEntryBlockedReason", () => {
  it("explains each status that blocks a run", () => {
    expect(launchEntryBlockedReason(entry("A"))).toBeNull();
    expect(
      launchEntryBlockedReason(entry("A", { _tag: "missing-toolchain", binary: "flutter" })),
    ).toBe("flutter isn't installed on this machine.");
    expect(
      launchEntryBlockedReason(entry("A", { _tag: "unsupported", reason: "Needs a debugger." })),
    ).toBe("Needs a debugger.");
  });

  it("lets entries that only need input values run", () => {
    const needsInputs = entry("A", { _tag: "needs-inputs", inputIds: ["port", "host"] });

    expect(launchEntryBlockedReason(needsInputs)).toBeNull();
    expect(launchEntryMissingInputIds(needsInputs)).toEqual(["port", "host"]);
    expect(launchEntryMissingInputIds(entry("A"))).toEqual([]);
  });

  it("names the toolchain to install", () => {
    expect(launchEntryMissingBinary(entry("A", { _tag: "missing-toolchain", binary: "go" }))).toBe(
      "go",
    );
    expect(launchEntryMissingBinary(entry("A"))).toBeNull();
  });
});
