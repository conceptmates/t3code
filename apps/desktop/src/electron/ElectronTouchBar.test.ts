import { assert, describe, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Electron from "electron";
import { beforeEach, vi } from "vite-plus/test";

const { setTouchBarMock, knownNamedImages } = vi.hoisted(() => ({
  setTouchBarMock: vi.fn(),
  knownNamedImages: new Set<string>(),
}));

vi.mock("electron", () => {
  class FakeImage {
    isTemplate = false;
    empty: boolean;
    constructor(empty: boolean) {
      this.empty = empty;
    }
    isEmpty() {
      return this.empty;
    }
    setTemplateImage(value: boolean) {
      this.isTemplate = value;
    }
  }
  class TouchBarButton {
    label: string;
    icon: unknown;
    accessibilityLabel: string | undefined;
    backgroundColor: string | undefined;
    enabled: boolean;
    click: () => void;
    constructor(options: {
      label: string;
      accessibilityLabel?: string;
      backgroundColor?: string;
      enabled?: boolean;
      icon?: unknown;
      click: () => void;
    }) {
      this.label = options.label;
      this.accessibilityLabel = options.accessibilityLabel;
      this.icon = options.icon;
      this.backgroundColor = options.backgroundColor;
      this.enabled = options.enabled ?? true;
      this.click = options.click;
    }
  }
  class TouchBarLabel {
    label: string;
    textColor: string | undefined;
    constructor(options: { label: string; textColor?: string }) {
      this.label = options.label;
      this.textColor = options.textColor;
    }
  }
  class TouchBarSpacer {
    size: string;
    constructor(options: { size: string }) {
      this.size = options.size;
    }
  }
  class TouchBarPopover {
    label: string;
    icon: unknown;
    items: unknown;
    constructor(options: { label: string; icon?: unknown; items: unknown }) {
      this.label = options.label;
      this.icon = options.icon;
      this.items = options.items;
    }
  }
  class TouchBar {
    escapeItem: unknown;
    static TouchBarButton = TouchBarButton;
    static TouchBarLabel = TouchBarLabel;
    static TouchBarSpacer = TouchBarSpacer;
    static TouchBarPopover = TouchBarPopover;
    options: { items: unknown[] };
    constructor(options: { items: unknown[] }) {
      this.options = options;
    }
  }
  return {
    TouchBar,
    nativeImage: {
      createFromNamedImage: (name: string) => new FakeImage(!knownNamedImages.has(name)),
      createFromBuffer: (buffer: Uint8Array) => new FakeImage(buffer.length === 0),
    },
  };
});

import * as ElectronTouchBar from "./ElectronTouchBar.ts";

const TestLayer = ElectronTouchBar.layer.pipe(
  Layer.provide(Layer.succeed(HostProcessPlatform, "darwin")),
);

const makeWindow = (): Electron.BrowserWindow =>
  ({ id: 7, setTouchBar: setTouchBarMock }) as unknown as Electron.BrowserWindow;

/** The items handed to `setTouchBar`, typed loosely because they are fakes. */
const attachedItems = (): Array<Record<string, unknown>> => {
  const lastCall = setTouchBarMock.mock.calls.at(-1);
  assert.isDefined(lastCall);
  const bar = lastCall[0] as { options: { items: Record<string, unknown>[] } } | null;
  assert.isNotNull(bar);
  return bar.options.items;
};

describe("ElectronTouchBar", () => {
  beforeEach(() => {
    setTouchBarMock.mockReset();
    knownNamedImages.clear();
  });

  it.effect("builds buttons, labels and popover rows from flat specs", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.attach(makeWindow(), [
        {
          kind: "button",
          key: "run",
          label: "Run dev",
          backgroundColor: "#111111",
          onClick: () => {},
        },
        { kind: "label", key: "status", label: "Working", textColor: "#222222" },
        {
          kind: "popover",
          key: "providers",
          label: "Claude 62%",
          items: [{ kind: "button", key: "provider:claude", label: "Claude", onClick: () => {} }],
        },
      ]);

      const items = attachedItems();
      assert.lengthOf(items, 3);
      assert.strictEqual(items[0]?.label, "Run dev");
      assert.strictEqual(items[0]?.backgroundColor, "#111111");
      assert.strictEqual(items[1]?.textColor, "#222222");
      assert.strictEqual(items[2]?.label, "Claude 62%");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("assigns onto the items already on the strip instead of rebuilding", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.attach(makeWindow(), [
        { kind: "button", key: "run", label: "Run dev", onClick: () => {} },
        { kind: "label", key: "status", label: "Idle" },
      ]);
      yield* touchBar.update([
        { key: "run", label: "Stop dev", backgroundColor: "#8c2f2f", enabled: false },
        { key: "status", label: "Working", textColor: "#e8b339" },
      ]);

      const items = attachedItems();
      assert.strictEqual(setTouchBarMock.mock.calls.length, 1);
      assert.strictEqual(items[0]?.label, "Stop dev");
      assert.strictEqual(items[0]?.backgroundColor, "#8c2f2f");
      assert.strictEqual(items[0]?.enabled, false);
      assert.strictEqual(items[1]?.label, "Working");
      assert.strictEqual(items[1]?.textColor, "#e8b339");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("ignores updates for keys the strip no longer holds", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.attach(makeWindow(), [
        { kind: "button", key: "run", label: "Run dev", onClick: () => {} },
      ]);
      yield* touchBar.update([{ key: "gone", label: "nothing" }]);
      assert.strictEqual(attachedItems()[0]?.label, "Run dev");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("detaches on a null spec list and forgets the old keys", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      const window = makeWindow();
      yield* touchBar.attach(window, [
        { kind: "button", key: "run", label: "Run dev", onClick: () => {} },
      ]);
      yield* touchBar.attach(window, null);
      yield* touchBar.update([{ key: "run", label: "Stop dev" }]);

      assert.strictEqual(setTouchBarMock.mock.calls.at(-1)?.[0], null);
    }).pipe(Effect.provide(TestLayer)),
  );
});

describe("ElectronTouchBar icons", () => {
  beforeEach(() => {
    setTouchBarMock.mockReset();
    knownNamedImages.clear();
  });

  it.effect("draws a button icon-only and moves its words to the accessibility label", () =>
    Effect.gen(function* () {
      knownNamedImages.add("NSTouchBarPlayTemplate");
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.attach(makeWindow(), [
        {
          kind: "button",
          key: "run",
          label: "Run dev",
          icon: { source: "named", name: "NSTouchBarPlayTemplate" },
          onClick: () => {},
        },
      ]);
      const button = attachedItems()[0];
      assert.strictEqual(button?.label, "");
      assert.strictEqual(button?.accessibilityLabel, "Run dev");
      assert.isDefined(button?.icon);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps the words when macOS has no image under that name", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.attach(makeWindow(), [
        {
          kind: "button",
          key: "run",
          label: "Run dev",
          icon: { source: "named", name: "NSNoSuchTemplate" },
          onClick: () => {},
        },
      ]);
      const button = attachedItems()[0];
      assert.strictEqual(button?.label, "Run dev");
      assert.isUndefined(button?.icon);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps the words for a registered glyph that was never registered", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.attach(makeWindow(), [
        {
          kind: "button",
          key: "row",
          label: "Claude 5h 62%",
          icon: { source: "registered", key: "row:claude" },
          onClick: () => {},
        },
      ]);
      assert.strictEqual(attachedItems()[0]?.label, "Claude 5h 62%");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("uses a registered glyph once its bytes arrive, with its colours intact", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.registerIcons([{ key: "row:claude", bytes: new Uint8Array([1, 2, 3]) }]);
      yield* touchBar.attach(makeWindow(), [
        {
          kind: "button",
          key: "row",
          label: "Claude 5h 62%",
          icon: { source: "registered", key: "row:claude" },
          onClick: () => {},
        },
      ]);
      const button = attachedItems()[0];
      assert.isDefined(button);
      assert.strictEqual(button.label, "");
      // Never a template image: macOS would flatten the brand colours and
      // the quota bars to a single tint.
      assert.strictEqual((button.icon as { isTemplate: boolean }).isTemplate, false);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("puts the escape item on the bar when one is given", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.attach(makeWindow(), [], {
        kind: "button",
        key: "launch-panel",
        label: "Run & Debug",
        onClick: () => {},
      });
      const lastCall = setTouchBarMock.mock.calls.at(-1);
      assert.isDefined(lastCall);
      const bar = lastCall[0] as { escapeItem?: { label: string } };
      assert.strictEqual(bar.escapeItem?.label, "Run & Debug");
    }).pipe(Effect.provide(TestLayer)),
  );
});

describe("ElectronTouchBar labels", () => {
  beforeEach(() => {
    setTouchBarMock.mockReset();
    knownNamedImages.clear();
  });

  it.effect("keeps the words beside the glyph when the spec asks for both", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.registerIcons([{ key: "action:run", bytes: new Uint8Array([1]) }]);
      yield* touchBar.attach(makeWindow(), [
        {
          kind: "button",
          key: "run",
          label: "Run dev",
          icon: { source: "registered", key: "action:run" },
          keepLabel: true,
          onClick: () => {},
        },
      ]);
      assert.strictEqual(attachedItems()[0]?.label, "Run dev");
    }).pipe(Effect.provide(TestLayer)),
  );
});

describe("ElectronTouchBar icon reporting", () => {
  beforeEach(() => {
    setTouchBarMock.mockReset();
    knownNamedImages.clear();
  });

  it.effect("reports which artwork decoded and which macOS refused", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      // An empty buffer is what a failed rasterization looks like by the
      // time it reaches here; it must be reported, not silently skipped.
      const report = yield* touchBar.registerIcons([
        { key: "chip:claude", bytes: new Uint8Array([1, 2, 3]) },
        { key: "chip:broken", bytes: new Uint8Array() },
      ]);
      assert.deepStrictEqual(report.registered, ["chip:claude"]);
      assert.deepStrictEqual(report.rejected, ["chip:broken"]);
    }).pipe(Effect.provide(TestLayer)),
  );
});

describe("ElectronTouchBar popovers", () => {
  beforeEach(() => {
    setTouchBarMock.mockReset();
    knownNamedImages.clear();
  });

  it.effect("drops the label once an image draws it, so nothing prints twice", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.registerIcons([{ key: "chip:codex", bytes: new Uint8Array([1, 2, 3]) }]);
      yield* touchBar.attach(makeWindow(), [
        {
          kind: "popover",
          key: "provider:codex",
          label: "18%",
          icon: { source: "registered", key: "chip:codex" },
          items: [],
        },
      ]);
      const popover = attachedItems()[0];
      assert.isDefined(popover);
      // The image already carries the glyph and the percentage.
      assert.strictEqual(popover.label, "");
      assert.isDefined(popover.icon);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps the label when the image never arrived", () =>
    Effect.gen(function* () {
      const touchBar = yield* ElectronTouchBar.ElectronTouchBar;
      yield* touchBar.attach(makeWindow(), [
        {
          kind: "popover",
          key: "provider:codex",
          label: "18%",
          icon: { source: "registered", key: "chip:missing" },
          items: [],
        },
      ]);
      assert.strictEqual(attachedItems()[0]?.label, "18%");
    }).pipe(Effect.provide(TestLayer)),
  );
});
