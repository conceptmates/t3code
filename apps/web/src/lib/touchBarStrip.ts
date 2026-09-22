import type { LaunchSessionView } from "@t3tools/client-runtime/launch-sessions";
import type {
  DesktopTouchBarChoice,
  DesktopTouchBarProvider,
  DesktopTouchBarState,
  LaunchConfigEntry,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/usageLimits";

import { composerLimitWindows } from "../components/chat/ComposerUsageRow";
import {
  providerAccentColor,
  type TouchBarChipSpec,
  type TouchBarRowSpec,
  type TouchBarRowWindow,
} from "./touchBarArtwork";

/**
 * The popover row is drawn as an image with real bars. This block-character
 * version is what the strip falls back to if that image never arrives, so the
 * row degrades to something readable rather than to a blank button.
 */
const BAR_CELLS = 10;
const FILLED_CELL = "▓";
const EMPTY_CELL = "░";

export function usageBar(usedPercent: number): string {
  const used = Math.max(0, Math.min(100, usedPercent));
  const filled = Math.round((used / 100) * BAR_CELLS);
  return FILLED_CELL.repeat(filled) + EMPTY_CELL.repeat(BAR_CELLS - filled);
}

/** `5h` for the rolling session window, `Wk` for the weekly one. */
export function windowCaption(window: ServerProviderUsageWindow): string {
  return window.kind === "session" ? "5h" : window.kind === "weekly" ? "Wk" : window.label;
}

/** `2h 13m` until the window resets, `now` once it has passed, null without one. */
export function windowCountdown(window: ServerProviderUsageWindow, now: number): string | null {
  if (window.resetsAt === undefined) return null;
  const at = Date.parse(window.resetsAt);
  if (!Number.isFinite(at)) return null;
  return at <= now ? "now" : formatDuration(at - now);
}

/** `5h ▓▓▓▓▓▓░░░░ 62% · 2h 13m`, dropping the countdown when there is no reset. */
export function usageWindowText(window: ServerProviderUsageWindow, now: number): string {
  const used = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
  const parts = [`${windowCaption(window)} ${usageBar(used)} ${used}%`];
  const countdown = windowCountdown(window, now);
  if (countdown !== null) parts.push(countdown);
  return parts.join(" · ");
}

export interface TouchBarProviderInput {
  readonly instanceId: string;
  readonly displayName: string;
  readonly driverKind: string;
  readonly accentColor?: string | undefined;
  readonly usageLimits?: ServerProviderUsageLimits | undefined;
}

export interface TouchBarStripInput {
  readonly providers: readonly TouchBarProviderInput[];
  readonly selectedInstanceId: string | null;
  readonly sidebarOpen: boolean;
  /** Null outside a thread, where there is no terminal drawer. */
  readonly terminalOpen: boolean | null;
  /** Configured projects for the switcher; empty hides that button. */
  readonly projects: readonly TouchBarChoiceInput[];
  /** Sidebar scope options, including the "All projects" row. */
  readonly projectFilter: readonly TouchBarChoiceInput[];
  /**
   * Built by the chat view, because only it knows the launch configuration.
   * Null outside a thread, and the strip simply omits the button.
   */
  readonly run: DesktopTouchBarState["run"];
  readonly now: number;
}

export interface TouchBarChoiceInput {
  readonly key: string;
  readonly label: string;
  readonly selected: boolean;
}

/** Longer names crowd the strip out of the other items' room. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

const clampPercent = (value: number) => Math.round(Math.max(0, Math.min(100, value)));

function providerItem(
  provider: TouchBarProviderInput,
  selected: boolean,
  now: number,
): DesktopTouchBarProvider | null {
  // No readable percentage, no chip. A glyph with nothing beside it says the
  // provider exists but tells you nothing you came to the strip to read.
  const windows = composerLimitWindows(provider.usageLimits);
  if (windows.length === 0) return null;
  const headline = windows.find((window) => window.kind === "session") ?? windows[0];
  const spoken = windows
    .map((window) => `${windowCaption(window)} ${clampPercent(window.usedPercent)} percent used`)
    .join(", ");
  return {
    instanceId: provider.instanceId,
    driverKind: provider.driverKind,
    // The chip is drawn as an image of the glyph plus the percentage. The
    // name is never written out — the glyph carries it, and the strip has no
    // room to say it twice.
    label: headline === undefined ? "" : `${clampPercent(headline.usedPercent)}%`,
    detail: windows.map((window) => usageWindowText(window, now)).join("   "),
    selected,
    accessibilityLabel: `${provider.displayName}: ${spoken}`,
  };
}

/** The artwork spec for a provider's strip chip, or null when it has no quota. */
export function providerChipSpec(provider: TouchBarProviderInput): TouchBarChipSpec | null {
  const windows = composerLimitWindows(provider.usageLimits);
  const headline = windows.find((window) => window.kind === "session") ?? windows[0];
  if (headline === undefined) return null;
  return {
    driverKind: provider.driverKind,
    label: `${clampPercent(headline.usedPercent)}%`,
  };
}

/** The artwork spec for a provider's popover row, or null when it has no quota. */
export function providerRowSpec(
  provider: TouchBarProviderInput,
  selected: boolean,
  now: number,
): TouchBarRowSpec | null {
  const windows = composerLimitWindows(provider.usageLimits);
  if (windows.length === 0) return null;
  const rowWindows: TouchBarRowWindow[] = windows.map((window) => ({
    caption: windowCaption(window),
    usedPercent: clampPercent(window.usedPercent),
    countdown: windowCountdown(window, now),
  }));
  return {
    driverKind: provider.driverKind,
    accentColor: providerAccentColor(provider.driverKind, provider.accentColor),
    selected,
    windows: rowWindows,
  };
}

export interface RankableProject {
  readonly key: string;
  readonly label: string;
}

export interface ProjectRankingInput {
  /** Every project, in the order the sidebar itself shows them. */
  readonly projects: readonly RankableProject[];
  /**
   * Project key to when it was last worked in, as epoch milliseconds.
   * A project with no live threads is absent from the map entirely.
   */
  readonly lastActiveAt: ReadonlyMap<string, number>;
  /** The project the user is in right now, if any. */
  readonly currentKey: string | null;
}

/**
 * Decide which projects reach the Touch Bar, and in what order.
 *
 * Only the first few survive `limitChoices`, so this ranking is what decides
 * whether the project you want is one tap away or unreachable. It is pure and
 * takes no React: the caller does the data gathering, this makes the call.
 *
 * Current rule: most recently worked in first, then projects that have never
 * been opened in the sidebar's own order.
 */
export function rankProjects(input: ProjectRankingInput): readonly RankableProject[] {
  return [...input.projects].sort((a, b) => {
    const aAt = input.lastActiveAt.get(a.key);
    const bAt = input.lastActiveAt.get(b.key);
    // Never-opened projects sink below everything that has been touched, and
    // hold the sidebar's order among themselves.
    if (aAt === undefined && bAt === undefined) return 0;
    if (aAt === undefined) return 1;
    if (bAt === undefined) return -1;
    return bAt - aAt;
  });
}

/**
 * How many rows a popover can hold before it runs off the edge of the strip.
 *
 * A Touch Bar popover does not scroll, so anything past the end is simply
 * unreachable. Six rows of a truncated project name fit inside the strip's
 * width with the back button.
 */
export const MAX_POPOVER_ROWS = 6;

/**
 * Trim a popover list to what actually fits, keeping the selected row even
 * when it falls outside the cut — a filter you cannot see is a filter you
 * cannot tell is on.
 */
export function limitChoices(
  choices: readonly TouchBarChoiceInput[],
  max: number = MAX_POPOVER_ROWS,
): readonly TouchBarChoiceInput[] {
  if (choices.length <= max) return choices;
  const kept = choices.slice(0, max);
  if (kept.some((choice) => choice.selected)) return kept;
  const selected = choices.find((choice) => choice.selected);
  if (selected === undefined) return kept;
  return [...kept.slice(0, max - 1), selected];
}

/**
 * The run button as the chat view sees it: stop while a launch session is up,
 * otherwise run the primary entry, and null when there is nothing to run. Null
 * takes the button off the strip rather than greying it, because a button that
 * is dead most of the time is only clutter.
 */
export function buildRunState(input: {
  readonly primaryLaunchEntry: LaunchConfigEntry | null;
  readonly launchSessions: readonly LaunchSessionView[];
  readonly launchBlockedReason: string | null;
}): DesktopTouchBarState["run"] {
  const running = input.launchSessions.find((session) => session.running);
  if (running !== undefined) {
    return {
      label: `Stop ${truncate(running.entryName ?? running.name, 16)}`,
      state: "running",
    };
  }
  if (input.primaryLaunchEntry === null) return null;
  return {
    label: `Run ${truncate(input.primaryLaunchEntry.name, 16)}`,
    state: input.launchBlockedReason === null ? "idle" : "blocked",
  };
}

/**
 * Build the strip. Pure so the shape can be asserted without an Electron
 * shell, and so the caller can compare two snapshots to decide whether sending
 * one is worth the IPC.
 */
export function buildTouchBarState(input: TouchBarStripInput): DesktopTouchBarState {
  const providers = input.providers
    .map((provider) =>
      providerItem(provider, provider.instanceId === input.selectedInstanceId, input.now),
    )
    .filter((provider): provider is DesktopTouchBarProvider => provider !== null);

  return {
    providers,
    sidebarOpen: input.sidebarOpen,
    terminalOpen: input.terminalOpen,
    projects: input.projects.map(toChoice),
    projectFilter: input.projectFilter.map(toChoice),
    run: input.run,
  };
}

const toChoice = (choice: TouchBarChoiceInput): DesktopTouchBarChoice => ({
  key: choice.key,
  label: truncate(choice.label, 24),
  selected: choice.selected,
});

const sameChoices = (
  a: readonly DesktopTouchBarChoice[],
  b: readonly DesktopTouchBarChoice[],
): boolean =>
  a.length === b.length &&
  a.every((choice, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      choice.key === other.key &&
      choice.label === other.label &&
      choice.selected === other.selected
    );
  });

/** Whether two snapshots would draw the same strip, so identical sends are dropped. */
export function sameTouchBarState(
  a: DesktopTouchBarState | null,
  b: DesktopTouchBarState | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.run?.label !== b.run?.label || a.run?.state !== b.run?.state) return false;
  if (a.sidebarOpen !== b.sidebarOpen || a.terminalOpen !== b.terminalOpen) return false;
  if (!sameChoices(a.projects, b.projects)) return false;
  if (!sameChoices(a.projectFilter, b.projectFilter)) return false;
  if (a.providers.length !== b.providers.length) return false;
  return a.providers.every((provider, index) => {
    const other = b.providers[index];
    return (
      other !== undefined &&
      provider.instanceId === other.instanceId &&
      provider.driverKind === other.driverKind &&
      provider.label === other.label &&
      provider.detail === other.detail &&
      provider.selected === other.selected
    );
  });
}
