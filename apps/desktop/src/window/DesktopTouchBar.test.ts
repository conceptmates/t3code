import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { DesktopTouchBarAction, DesktopTouchBarState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronTouchBar from "../electron/ElectronTouchBar.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopTouchBar from "./DesktopTouchBar.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const environmentInput = (platform: DesktopEnvironment.MakeDesktopEnvironmentInput["platform"]) =>
  ({
    dirname: "/repo/apps/desktop/dist-electron",
    homeDirectory: "/Users/alice",
    platform,
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: false,
    resourcesPath: "/repo/resources",
    runningUnderArm64Translation: false,
  }) satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

interface Recorder {
  readonly attaches: (readonly ElectronTouchBar.ElectronTouchBarItemSpec[] | null)[];
  readonly updates: (readonly ElectronTouchBar.ElectronTouchBarItemUpdate[])[];
  readonly actions: DesktopTouchBarAction[];
}

const makeRecorder = (): Recorder => ({ attaches: [], updates: [], actions: [] });

const makeWindow = (id = 7): Electron.BrowserWindow =>
  ({ id, isDestroyed: () => false }) as unknown as Electron.BrowserWindow;

const layerFor = (
  recorder: Recorder,
  platform: DesktopEnvironment.MakeDesktopEnvironmentInput["platform"],
  window: Electron.BrowserWindow | null,
) =>
  DesktopTouchBar.layer.pipe(
    Layer.provideMerge(
      Layer.succeed(ElectronTouchBar.ElectronTouchBar, {
        registerIcons: () => Effect.succeed({ registered: [], rejected: [] }),
        attach: (_window, items) =>
          Effect.sync(() => {
            recorder.attaches.push(items);
          }),
        update: (updates) =>
          Effect.sync(() => {
            recorder.updates.push(updates);
          }),
      } satisfies ElectronTouchBar.ElectronTouchBar["Service"]),
    ),
    Layer.provideMerge(
      Layer.succeed(ElectronWindow.ElectronWindow, {
        create: () => Effect.die("unexpected window create"),
        main: Effect.succeed(window === null ? Option.none() : Option.some(window)),
        currentMainOrFirst: Effect.succeed(Option.none()),
        focusedMainOrFirst: Effect.succeed(Option.none()),
        setMain: () => Effect.void,
        clearMain: () => Effect.void,
        prepareReveal: () => Effect.succeed(false),
        reveal: () => Effect.void,
        sendAll: () => Effect.void,
        destroyAll: Effect.void,
        syncAllAppearance: () => Effect.void,
      } satisfies ElectronWindow.ElectronWindow["Service"]),
    ),
    Layer.provideMerge(
      Layer.succeed(DesktopWindow.DesktopWindow, {
        createMain: Effect.die("unexpected createMain"),
        ensureMain: Effect.die("unexpected ensureMain"),
        revealOrCreateMain: Effect.die("unexpected revealOrCreateMain"),
        activate: Effect.void,
        createMainIfBackendReady: Effect.void,
        showConnectingSplash: Effect.void,
        handleBackendReady: () => Effect.void,
        handleBackendNotReady: Effect.void,
        flushMainWindowBounds: Effect.void,
        prepareCaptureReveal: Effect.void,
        dispatchMenuAction: () => Effect.void,
        dispatchSnapShotEvent: () => Effect.void,
        dispatchTouchBarAction: (action) =>
          Effect.sync(() => {
            recorder.actions.push(action);
          }),
        zoomMain: () => Effect.void,
        syncAppearance: Effect.void,
      } satisfies DesktopWindow.DesktopWindow["Service"]),
    ),
    Layer.provideMerge(
      DesktopEnvironment.layer(environmentInput(platform)).pipe(
        Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
      ),
    ),
  );

const provider = (instanceId: string, driverKind: string, label: string, selected: boolean) => ({
  instanceId,
  driverKind,
  label,
  detail: `${label} detail`,
  selected,
  accessibilityLabel: label,
});

const state = (overrides: Partial<DesktopTouchBarState> = {}): DesktopTouchBarState => ({
  providers: [provider("claudeAgent", "claudeAgent", "Claude 62%", true)],
  sidebarOpen: false,
  terminalOpen: null,
  projects: [{ key: "t3code", label: "t3code", selected: false }],
  projectFilter: [
    { key: "all", label: "All projects", selected: true },
    { key: "t3code", label: "t3code", selected: false },
  ],
  run: null,
  ...overrides,
});

describe("resolveTouchBar", () => {
  it("lays the strip out chips, projects, then run", () => {
    const resolved = DesktopTouchBar.resolveTouchBar(
      state({
        providers: [
          provider("claudeAgent", "claudeAgent", "Claude 62%", true),
          provider("codex", "codex", "Codex 18%", false),
        ],
        run: { label: "Run dev", state: "idle" },
      }),
    );
    assert.deepStrictEqual(
      resolved.main.map((item) => item.key),
      [
        "provider:claudeAgent",
        "provider:codex",
        "switch-project",
        "new-project",
        "new-thread",
        "sidebar",
        "run",
      ],
    );
  });

  it("leaves the Escape key alone", () => {
    assert.isFalse("escape" in DesktopTouchBar.resolveTouchBar(state()));
  });

  it("drops the run button when there is nothing to run", () => {
    const resolved = DesktopTouchBar.resolveTouchBar(state());
    assert.isUndefined(resolved.main.find((item) => item.key === "run"));
  });

  it("gives each project control its own glyph, so no two look alike", () => {
    const resolved = DesktopTouchBar.resolveTouchBar(state());
    const keys = ["switch-project", "new-project", "new-thread"];
    const icons = keys.map((key) => resolved.main.find((item) => item.key === key)?.icon);
    for (const [index, key] of keys.entries()) {
      assert.deepStrictEqual(icons[index], {
        source: "registered",
        key: DesktopTouchBar.actionIconKey(key),
      });
    }
    assert.strictEqual(new Set(icons.map((icon) => JSON.stringify(icon))).size, keys.length);
  });

  it("opens the same provider detail from whichever chip is tapped", () => {
    const resolved = DesktopTouchBar.resolveTouchBar(
      state({
        providers: [
          provider("claudeAgent", "claudeAgent", "Claude 62%", true),
          provider("codex", "codex", "Codex 18%", false),
        ],
      }),
    );
    for (const owner of ["provider:claudeAgent", "provider:codex"]) {
      assert.deepStrictEqual(
        resolved.popovers.get(owner)?.map((row) => row.action),
        [
          { kind: "select-provider", instanceId: "claudeAgent" },
          { kind: "select-provider", instanceId: "codex" },
        ],
      );
    }
  });

  it("puts the projects in a scrollable scrubber, not a row of buttons", () => {
    const resolved = DesktopTouchBar.resolveTouchBar(state());
    // A popover is only as wide as the strip; a scrubber scrolls, so every
    // project stays reachable however many there are.
    const scrubber = resolved.scrubbers.get("switch-project");
    assert.isDefined(scrubber);
    assert.deepStrictEqual(
      scrubber?.rows.map((row) => row.action),
      [{ kind: "open-project", key: "t3code" }],
    );
    assert.isUndefined(resolved.popovers.get("switch-project"));
    // The filter button was removed from the strip; only the switcher remains.
    assert.isUndefined(resolved.popovers.get("filter-project"));
  });

  it("hides the project buttons entirely when nothing is configured", () => {
    const resolved = DesktopTouchBar.resolveTouchBar(state({ projects: [], projectFilter: [] }));
    assert.isUndefined(resolved.main.find((item) => item.key === "switch-project"));
    assert.strictEqual(resolved.scrubbers.size, 0);
    assert.strictEqual(resolved.main.find((item) => item.key === "new-thread")?.enabled, false);
  });

  it("gives every icon-only control words for VoiceOver", () => {
    const resolved = DesktopTouchBar.resolveTouchBar(
      state({ run: { label: "Run dev", state: "idle" } }),
    );
    for (const item of resolved.main) {
      if (item.icon === undefined) continue;
      assert.isNotEmpty(item.accessibilityLabel ?? item.label);
    }
  });

  it("reddens the run button while a launch session is up", () => {
    const idle = DesktopTouchBar.resolveTouchBar(
      state({ run: { label: "Run dev", state: "idle" } }),
    ).main.at(-1);
    const running = DesktopTouchBar.resolveTouchBar(
      state({ run: { label: "Stop dev", state: "running" } }),
    ).main.at(-1);
    assert.notStrictEqual(running?.backgroundColor, idle?.backgroundColor);
    assert.deepStrictEqual(running?.icon, {
      source: "registered",
      key: DesktopTouchBar.actionIconKey("stop"),
    });
  });
});

describe("touchBarUpdates", () => {
  it("reports only the properties that moved", () => {
    const before = DesktopTouchBar.resolveTouchBar(state());
    const after = DesktopTouchBar.resolveTouchBar(
      state({ providers: [provider("claudeAgent", "claudeAgent", "Claude 71%", true)] }),
    );
    assert.deepStrictEqual(DesktopTouchBar.touchBarUpdates(before, after), [
      { key: "provider:claudeAgent", label: "Claude 71%" },
      { key: "row:claudeAgent:claudeAgent", label: "Claude 71% detail" },
    ]);
  });

  it("reports nothing when the strip is unchanged", () => {
    const resolved = DesktopTouchBar.resolveTouchBar(state());
    assert.deepStrictEqual(DesktopTouchBar.touchBarUpdates(resolved, resolved), []);
  });
});

describe("DesktopTouchBar", () => {
  it.effect("attaches once, then updates in place while the shape holds", () =>
    Effect.gen(function* () {
      const recorder = makeRecorder();
      yield* Effect.gen(function* () {
        const touchBar = yield* DesktopTouchBar.DesktopTouchBar;
        yield* touchBar.apply(state());
        yield* touchBar.apply(
          state({ providers: [provider("claudeAgent", "claudeAgent", "Claude 71%", true)] }),
        );
      }).pipe(Effect.provide(layerFor(recorder, "darwin", makeWindow())));

      assert.lengthOf(recorder.attaches, 1);
      assert.deepStrictEqual(recorder.updates, [
        [
          { key: "provider:claudeAgent", label: "Claude 71%" },
          { key: "row:claudeAgent:claudeAgent", label: "Claude 71% detail" },
        ],
      ]);
    }),
  );

  it.effect("rebuilds the strip when the provider list changes", () =>
    Effect.gen(function* () {
      const recorder = makeRecorder();
      yield* Effect.gen(function* () {
        const touchBar = yield* DesktopTouchBar.DesktopTouchBar;
        yield* touchBar.apply(state());
        yield* touchBar.apply(state({ providers: [] }));
      }).pipe(Effect.provide(layerFor(recorder, "darwin", makeWindow())));

      assert.lengthOf(recorder.attaches, 2);
      assert.lengthOf(recorder.updates, 0);
    }),
  );

  it.effect("detaches on a null state, and only when something is attached", () =>
    Effect.gen(function* () {
      const recorder = makeRecorder();
      yield* Effect.gen(function* () {
        const touchBar = yield* DesktopTouchBar.DesktopTouchBar;
        yield* touchBar.apply(null);
        yield* touchBar.apply(state());
        yield* touchBar.apply(null);
      }).pipe(Effect.provide(layerFor(recorder, "darwin", makeWindow())));

      assert.deepStrictEqual(
        recorder.attaches.map((items) => (items === null ? null : items.length)),
        [5, null],
      );
    }),
  );

  it.effect("sends taps to the renderer as actions", () =>
    Effect.gen(function* () {
      const recorder = makeRecorder();
      yield* Effect.gen(function* () {
        const touchBar = yield* DesktopTouchBar.DesktopTouchBar;
        yield* touchBar.apply(state());
      }).pipe(Effect.provide(layerFor(recorder, "darwin", makeWindow())));

      const items = recorder.attaches[0];
      assert.isNotNull(items);
      for (const item of items ?? []) {
        if (item.kind === "button") item.onClick();
        if (item.kind === "popover") {
          for (const row of item.items) if (row.kind === "button") row.onClick();
        }
      }
      // The dispatch is fire-and-forget, so let the runtime drain it.
      yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));

      // Walk order, not strip order: a popover's rows are visited with the
      // chip that holds them. The project list is a scrubber, not buttons, so
      // this walk does not reach it.
      assert.deepStrictEqual(recorder.actions, [
        { kind: "select-provider", instanceId: "claudeAgent" },
        { kind: "new-project" },
        { kind: "new-thread" },
        { kind: "toggle-sidebar" },
      ]);
    }),
  );

  it.effect("does nothing at all off macOS", () =>
    Effect.gen(function* () {
      const recorder = makeRecorder();
      yield* Effect.gen(function* () {
        const touchBar = yield* DesktopTouchBar.DesktopTouchBar;
        yield* touchBar.apply(state());
      }).pipe(Effect.provide(layerFor(recorder, "win32", makeWindow())));

      assert.lengthOf(recorder.attaches, 0);
    }),
  );

  it.effect("waits for a main window before building anything", () =>
    Effect.gen(function* () {
      const recorder = makeRecorder();
      yield* Effect.gen(function* () {
        const touchBar = yield* DesktopTouchBar.DesktopTouchBar;
        yield* touchBar.apply(state());
      }).pipe(Effect.provide(layerFor(recorder, "darwin", null)));

      assert.lengthOf(recorder.attaches, 0);
    }),
  );
});

describe("project scrubber", () => {
  it("carries every project, however many, since it scrolls", () => {
    const many = Array.from({ length: 24 }, (_, index) => ({
      key: `p${index}`,
      label: `project-${index}`,
      selected: false,
    }));
    const resolved = DesktopTouchBar.resolveTouchBar(state({ projects: many }));
    assert.lengthOf(resolved.scrubbers.get("switch-project")?.rows ?? [], 24);
  });

  it("gives each row the project's own artwork", () => {
    const resolved = DesktopTouchBar.resolveTouchBar(state());
    assert.deepStrictEqual(resolved.scrubbers.get("switch-project")?.rows[0]?.icon, {
      source: "registered",
      key: DesktopTouchBar.projectIconKey("t3code"),
    });
  });
});

describe("drawer toggles", () => {
  it("tints a drawer that is already open", () => {
    const closed = DesktopTouchBar.resolveTouchBar(state({ sidebarOpen: false }));
    const open = DesktopTouchBar.resolveTouchBar(state({ sidebarOpen: true }));
    assert.isUndefined(closed.main.find((i) => i.key === "sidebar")?.backgroundColor);
    assert.isDefined(open.main.find((i) => i.key === "sidebar")?.backgroundColor);
  });

  it("omits the terminal button outside a thread, and shows it inside one", () => {
    assert.isUndefined(
      DesktopTouchBar.resolveTouchBar(state({ terminalOpen: null })).main.find(
        (i) => i.key === "terminal",
      ),
    );
    assert.isDefined(
      DesktopTouchBar.resolveTouchBar(state({ terminalOpen: false })).main.find(
        (i) => i.key === "terminal",
      ),
    );
  });
});
