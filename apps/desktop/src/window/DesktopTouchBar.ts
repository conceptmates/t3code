import type {
  DesktopTouchBarAction,
  DesktopTouchBarIcons,
  DesktopTouchBarState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronTouchBar from "../electron/ElectronTouchBar.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

export class DesktopTouchBarActionError extends Schema.TaggedError<DesktopTouchBarActionError>()(
  "DesktopTouchBarActionError",
  {
    action: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop Touch Bar action ${JSON.stringify(this.action)} failed.`;
  }
}

export class DesktopTouchBar extends Context.Service<
  DesktopTouchBar,
  {
    /** Register the renderer's provider glyphs, before the first `apply`. */
    readonly setIcons: (icons: DesktopTouchBarIcons) => Effect.Effect<void>;
    /**
     * Put the given strip on the main window. `null` detaches the Touch Bar,
     * which is what the renderer sends when the setting is off.
     */
    readonly apply: (state: DesktopTouchBarState | null) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopTouchBar") {}

const { logError: logTouchBarError, logInfo: logTouchBarInfo } =
  makeComponentLogger("desktop-touch-bar");

// Native chrome, not app theme: these read against the Touch Bar's own dark
// strip, which does not follow the window's light or dark appearance.
const RUN_IDLE_COLOR = "#1F6F43";
const RUN_RUNNING_COLOR = "#8C2F2F";
/** A drawer that is open reads as a pressed toggle rather than a plain button. */
const TOGGLE_ON_COLOR = "#3A3A3C";

/**
 * Artwork keys, matching what the renderer registered. The action glyphs are
 * drawn by the renderer too rather than pulled from macOS: Apple ships no list
 * of `NSTouchBar*` names a compiler can check, and a name this system does not
 * have renders as nothing at all.
 */
export const actionIconKey = (action: string): string => `action:${action}`;
export const providerChipKey = (instanceId: string): string => `chip:${instanceId}`;
export const providerRowKey = (instanceId: string): string => `row:${instanceId}`;
export const projectIconKey = (projectKey: string): string => `project:${projectKey}`;

/** One item as it should currently look, flat and comparable. */
export interface ResolvedTouchBarItem {
  readonly key: string;
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly icon?: ElectronTouchBar.ElectronTouchBarIconRef;
  readonly backgroundColor?: string;
  readonly textColor?: string;
  readonly enabled?: boolean;
  readonly action?: DesktopTouchBarAction;
}

/** A scrollable list that fills a popover, keyed by the item that opens it. */
export interface ResolvedTouchBarScrubber {
  readonly key: string;
  readonly rows: readonly {
    readonly label: string;
    readonly icon?: ElectronTouchBar.ElectronTouchBarIconRef;
    readonly action: DesktopTouchBarAction;
  }[];
}

export interface ResolvedTouchBar {
  readonly main: readonly ResolvedTouchBarItem[];
  /** Detail rows keyed by the main-strip item that opens them. */
  readonly popovers: ReadonlyMap<string, readonly ResolvedTouchBarItem[]>;
  /** Scrollable lists keyed by the main-strip item that opens them. */
  readonly scrubbers: ReadonlyMap<string, ResolvedTouchBarScrubber>;
}

/**
 * Turn a state snapshot into the items the strip should show.
 *
 * Order is by how often the item is reached for, because macOS truncates from
 * the right as the strip runs out of room.
 */
export function resolveTouchBar(state: DesktopTouchBarState): ResolvedTouchBar {
  const main: ResolvedTouchBarItem[] = [];
  const popovers = new Map<string, readonly ResolvedTouchBarItem[]>();
  const scrubbers = new Map<string, ResolvedTouchBarScrubber>();

  // One chip per provider rather than a picker: the glyph and the percentage
  // are what the user is watching, and a chip that only said "Providers" would
  // hide both behind a tap.
  for (const provider of state.providers) {
    main.push({
      key: `provider:${provider.instanceId}`,
      // The glyph and the percentage share one image, because a popover
      // collapses to its image or its label and never to both. `label` is
      // what shows if that image never arrives, so it names the provider.
      label: provider.label,
      accessibilityLabel: `${provider.accessibilityLabel}. Show all provider limits.`,
      icon: { source: "registered", key: providerChipKey(provider.instanceId) },
    });
    // Every chip opens the same detail: the point of tapping one is to compare
    // the providers, not to look at the one already on the strip.
    popovers.set(
      `provider:${provider.instanceId}`,
      state.providers.map((row) => ({
        key: `row:${provider.instanceId}:${row.instanceId}`,
        label: row.detail,
        accessibilityLabel: `${row.accessibilityLabel}. Switch to this provider.`,
        icon: { source: "registered", key: providerRowKey(row.instanceId) } as const,
        action: { kind: "select-provider", instanceId: row.instanceId } as const,
      })),
    );
  }

  if (state.projects.length > 0) {
    main.push({
      key: "switch-project",
      label: "Projects",
      accessibilityLabel: "Open a project",
      icon: { source: "registered", key: actionIconKey("switch-project") },
    });
    // A scrubber rather than a row of buttons: the popover is only as wide as
    // the strip, so a button per project puts everything past the sixth out of
    // reach. A scrubber scrolls, so every project stays reachable.
    scrubbers.set("switch-project", {
      key: "switch-project-list",
      rows: state.projects.map((project) => ({
        label: project.label,
        icon: { source: "registered", key: projectIconKey(project.key) } as const,
        action: { kind: "open-project", key: project.key } as const,
      })),
    });
  }

  main.push({
    key: "new-project",
    label: "New project",
    icon: { source: "registered", key: actionIconKey("new-project") },
    action: { kind: "new-project" },
  });

  main.push({
    key: "new-thread",
    label: "New thread",
    icon: { source: "registered", key: actionIconKey("new-thread") },
    enabled: state.projects.length > 0,
    action: { kind: "new-thread" },
  });

  main.push({
    key: "sidebar",
    label: "Sidebar",
    icon: { source: "registered", key: actionIconKey("sidebar") },
    ...(state.sidebarOpen ? { backgroundColor: TOGGLE_ON_COLOR } : {}),
    action: { kind: "toggle-sidebar" },
  });

  // Absent outside a thread, where there is no terminal drawer to open.
  if (state.terminalOpen !== null) {
    main.push({
      key: "terminal",
      label: "Terminal",
      icon: { source: "registered", key: actionIconKey("terminal") },
      ...(state.terminalOpen ? { backgroundColor: TOGGLE_ON_COLOR } : {}),
      action: { kind: "toggle-terminal" },
    });
  }

  // Run is the only thread-scoped item: absent outside a thread, and absent in
  // a project with no launch configuration, so the strip never carries a
  // button that cannot do anything.
  if (state.run !== null) {
    const running = state.run.state === "running";
    main.push({
      key: "run",
      label: state.run.label,
      icon: { source: "registered", key: actionIconKey(running ? "stop" : "run") },
      backgroundColor: running ? RUN_RUNNING_COLOR : RUN_IDLE_COLOR,
      enabled: state.run.state !== "blocked",
      action: { kind: "run-toggle" },
    });
  }

  return { main, popovers, scrubbers };
}

/**
 * Everything that cannot be changed by assignment: which items exist and in
 * what order. A popover's contents are fixed at construction, so its rows
 * count too.
 */
export function touchBarShapeKey(resolved: ResolvedTouchBar): string {
  const main = resolved.main.map((item) => item.key).join(",");
  const popovers = [...resolved.popovers]
    .map(([owner, rows]) => `${owner}>${rows.map((row) => row.key).join(",")}`)
    .join(";");
  const scrubbers = [...resolved.scrubbers]
    .map(([owner, list]) => `${owner}>${list.rows.map((row) => row.label).join(",")}`)
    .join(";");
  return `${main}|${popovers}|${scrubbers}`;
}

const allItems = (resolved: ResolvedTouchBar): readonly ResolvedTouchBarItem[] => [
  ...resolved.main,
  ...[...resolved.popovers.values()].flat(),
];

/** Only the properties that actually moved, so a steady strip costs nothing. */
export function touchBarUpdates(
  previous: ResolvedTouchBar,
  next: ResolvedTouchBar,
): ElectronTouchBar.ElectronTouchBarItemUpdate[] {
  const previousByKey = new Map(allItems(previous).map((item) => [item.key, item]));
  const updates: ElectronTouchBar.ElectronTouchBarItemUpdate[] = [];

  for (const item of allItems(next)) {
    const before = previousByKey.get(item.key);
    if (before === undefined) continue;
    const update: {
      -readonly [
        K in keyof ElectronTouchBar.ElectronTouchBarItemUpdate
      ]: ElectronTouchBar.ElectronTouchBarItemUpdate[K];
    } = { key: item.key };
    let changed = false;
    if (item.label !== before.label) {
      update.label = item.label;
      changed = true;
    }
    if (item.backgroundColor !== undefined && item.backgroundColor !== before.backgroundColor) {
      update.backgroundColor = item.backgroundColor;
      changed = true;
    }
    if (item.textColor !== undefined && item.textColor !== before.textColor) {
      update.textColor = item.textColor;
      changed = true;
    }
    if (item.enabled !== undefined && item.enabled !== before.enabled) {
      update.enabled = item.enabled;
      changed = true;
    }
    if (changed) updates.push(update);
  }

  return updates;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronTouchBar = yield* ElectronTouchBar.ElectronTouchBar;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const context = yield* Effect.context<DesktopWindow.DesktopWindow>();
  const runPromise = Effect.runPromiseWith(context);

  let attached: {
    readonly windowId: number;
    readonly shapeKey: string;
    readonly resolved: ResolvedTouchBar;
  } | null = null;

  const dispatch = (action: DesktopTouchBarAction) => {
    void runPromise(
      Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.dispatchTouchBarAction(action);
      }).pipe(
        Effect.annotateLogs({ action: action.kind }),
        Effect.withSpan("desktop.touchBar.action"),
        Effect.catchCause((cause) => {
          const error = new DesktopTouchBarActionError({ action: action.kind, cause });
          return logTouchBarError(error.message, { error });
        }),
      ),
    );
  };

  const toSpec = (item: ResolvedTouchBarItem): ElectronTouchBar.ElectronTouchBarItemSpec => {
    if (item.action === undefined) {
      return {
        kind: "label",
        key: item.key,
        label: item.label,
        ...(item.accessibilityLabel === undefined
          ? {}
          : { accessibilityLabel: item.accessibilityLabel }),
        ...(item.textColor === undefined ? {} : { textColor: item.textColor }),
      };
    }
    const action = item.action;
    return {
      kind: "button",
      key: item.key,
      label: item.label,
      ...(item.accessibilityLabel === undefined
        ? {}
        : { accessibilityLabel: item.accessibilityLabel }),
      ...(item.icon === undefined ? {} : { icon: item.icon }),
      ...(item.backgroundColor === undefined ? {} : { backgroundColor: item.backgroundColor }),
      ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
      onClick: () => dispatch(action),
    };
  };

  const toSpecs = (resolved: ResolvedTouchBar): ElectronTouchBar.ElectronTouchBarItemSpec[] =>
    resolved.main.map((item) => {
      const scrubber = resolved.scrubbers.get(item.key);
      if (scrubber !== undefined) {
        return {
          kind: "popover",
          key: item.key,
          label: item.label,
          ...(item.accessibilityLabel === undefined
            ? {}
            : { accessibilityLabel: item.accessibilityLabel }),
          ...(item.icon === undefined ? {} : { icon: item.icon }),
          items: [
            {
              kind: "scrubber",
              key: scrubber.key,
              items: scrubber.rows.map((row) => ({
                label: row.label,
                ...(row.icon === undefined ? {} : { icon: row.icon }),
              })),
              onSelect: (index: number) => {
                const row = scrubber.rows[index];
                if (row !== undefined) dispatch(row.action);
              },
            },
          ],
        } satisfies ElectronTouchBar.ElectronTouchBarItemSpec;
      }
      const rows = resolved.popovers.get(item.key);
      if (rows === undefined) return toSpec(item);
      return {
        kind: "popover",
        key: item.key,
        label: item.label,
        ...(item.accessibilityLabel === undefined
          ? {}
          : { accessibilityLabel: item.accessibilityLabel }),
        ...(item.icon === undefined ? {} : { icon: item.icon }),
        items: rows.map(toSpec),
      } satisfies ElectronTouchBar.ElectronTouchBarItemSpec;
    });

  const apply = Effect.fn("desktop.touchBar.apply")(function* (state: DesktopTouchBarState | null) {
    // Every other platform has no Touch Bar to put anything on.
    if (environment.platform !== "darwin") return;
    const window = yield* electronWindow.main;
    if (Option.isNone(window) || window.value.isDestroyed()) return;

    if (state === null) {
      if (attached === null) return;
      attached = null;
      yield* electronTouchBar.attach(window.value, null);
      return;
    }

    const windowId = window.value.id;
    const resolved = resolveTouchBar(state);
    yield* Effect.annotateCurrentSpan({ items: resolved.main.length });
    const shapeKey = touchBarShapeKey(resolved);
    // A recreated window starts with no Touch Bar, so its items must be built
    // again even when the strip looks identical to the one before it.
    if (attached === null || attached.windowId !== windowId || attached.shapeKey !== shapeKey) {
      attached = { windowId, shapeKey, resolved };
      yield* electronTouchBar.attach(window.value, toSpecs(resolved));
      return;
    }

    const updates = touchBarUpdates(attached.resolved, resolved);
    attached = { windowId, shapeKey, resolved };
    yield* electronTouchBar.update(updates);
  });

  const setIcons = Effect.fn("desktop.touchBar.setIcons")(function* (icons: DesktopTouchBarIcons) {
    if (environment.platform !== "darwin") return;
    const report = yield* electronTouchBar.registerIcons(icons);
    // Annotated onto the span, not logged: a packaged app's stdout goes
    // nowhere, while spans are written to desktop.trace.ndjson on disk. This
    // is the only channel that can be read back out of a shipped build.
    yield* Effect.annotateCurrentSpan({
      received: icons.length,
      registered: report.registered.length,
      rejected: report.rejected.join(",") || "none",
      bytes: icons.reduce((total, icon) => total + icon.bytes.length, 0),
      keys: report.registered.join(","),
    });
    yield* logTouchBarInfo("registered touch bar artwork", {
      received: icons.length,
      registered: report.registered.length,
      rejected: report.rejected,
    });
    // Glyphs are baked into the native items at build time, so a strip that is
    // already up has to be rebuilt to pick them up.
    attached = null;
  });

  return DesktopTouchBar.of({ setIcons, apply });
});

export const layer = Layer.effect(DesktopTouchBar, make);
