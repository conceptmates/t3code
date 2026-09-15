import { launchTerminalId, type LaunchConfigEntry, type TerminalSummary } from "@t3tools/contracts";

export interface LaunchSessionView {
  readonly name: string;
  readonly terminalId: string;
  /** Entry that restarts this session, or null when launch.json no longer has it. */
  readonly entryName: string | null;
  readonly running: boolean;
  readonly exitCode: number | null;
  readonly hotReload: boolean;
}

const LAUNCH_TERMINAL_ID_PREFIX = "launch-";

export const isLaunchTerminalId = (terminalId: string) =>
  terminalId.startsWith(LAUNCH_TERMINAL_ID_PREFIX);

/** A thread's launch terminals, in terminal order, joined with the entries that started them. */
export function selectLaunchSessions(
  entries: ReadonlyArray<LaunchConfigEntry>,
  terminals: ReadonlyArray<TerminalSummary>,
): Array<LaunchSessionView> {
  const entriesByTerminalId = new Map(
    entries.map((entry) => [launchTerminalId(entry.name), entry] as const),
  );
  return terminals
    .filter((terminal) => isLaunchTerminalId(terminal.terminalId))
    .map((terminal) => {
      const entry = entriesByTerminalId.get(terminal.terminalId);
      return {
        name: entry?.name ?? (terminal.label.trim() || terminal.terminalId),
        terminalId: terminal.terminalId,
        entryName: entry?.name ?? null,
        running: terminal.status === "running" || terminal.status === "starting",
        exitCode: terminal.exitCode,
        hotReload: entry?.hotReload === true,
      };
    });
}

/** The entry the Run button starts: the last one run, else the first that can run. */
export function primaryLaunchEntry(
  entries: ReadonlyArray<LaunchConfigEntry>,
  lastRunName: string | null,
): LaunchConfigEntry | null {
  const lastRun =
    lastRunName === null ? undefined : entries.find((entry) => entry.name === lastRunName);
  return lastRun ?? entries.find((entry) => entry.status._tag === "runnable") ?? entries[0] ?? null;
}

/**
 * Why an entry can't run, or null when it can. Entries that need `${input:…}`
 * values can run: the client asks for them first.
 */
export function launchEntryBlockedReason(entry: LaunchConfigEntry): string | null {
  switch (entry.status._tag) {
    case "runnable":
    case "needs-inputs":
      return null;
    case "unsupported":
      return entry.status.reason;
    case "missing-toolchain":
      return `${entry.status.binary} isn't installed on this machine.`;
  }
}

/** Ids of the `inputs` this entry needs values for before it runs. */
export function launchEntryMissingInputIds(entry: LaunchConfigEntry): ReadonlyArray<string> {
  return entry.status._tag === "needs-inputs" ? entry.status.inputIds : [];
}

/** The toolchain the entry needs on PATH, for the "Ask agent to install" action. */
export function launchEntryMissingBinary(entry: LaunchConfigEntry): string | null {
  return entry.status._tag === "missing-toolchain" ? entry.status.binary : null;
}
