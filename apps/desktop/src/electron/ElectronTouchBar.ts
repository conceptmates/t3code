import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

/**
 * A Touch Bar described as flat specs rather than native objects, so callers
 * never touch Electron and tests can fake the whole service.
 *
 * `key` identifies an item for later `update` calls and must be unique across
 * the strip, popovers included. Anything mutable at runtime — label, colour,
 * enabled — is reachable through `update`; everything else is part of the
 * shape, and changing it means building the bar again.
 */
export type ElectronTouchBarItemSpec =
  | {
      readonly kind: "button";
      readonly key: string;
      readonly label: string;
      readonly accessibilityLabel?: string;
      readonly backgroundColor?: string;
      readonly enabled?: boolean;
      /**
       * A macOS named template image, or a key into the registered glyphs.
       * When it resolves, the button is drawn icon-only and `label` moves to
       * the accessibility label; when it does not, the label is drawn as text
       * so a missing glyph degrades to words rather than to a blank button.
       */
      readonly icon?: ElectronTouchBarIconRef;
      /** Draw the words next to the glyph instead of letting it stand alone. */
      readonly keepLabel?: boolean;
      readonly onClick: () => void;
    }
  | {
      readonly kind: "label";
      readonly key: string;
      readonly label: string;
      readonly accessibilityLabel?: string;
      readonly textColor?: string;
    }
  | {
      readonly kind: "spacer";
      readonly key: string;
      readonly size: "small" | "large" | "flexible";
    }
  | {
      /**
       * A natively scrollable list. Unlike a row of buttons, a scrubber is not
       * bounded by the width of the strip, so every item stays reachable
       * however many there are.
       */
      readonly kind: "scrubber";
      readonly key: string;
      readonly items: readonly {
        readonly label: string;
        readonly icon?: ElectronTouchBarIconRef;
      }[];
      readonly onSelect: (index: number) => void;
    }
  | {
      readonly kind: "popover";
      readonly key: string;
      readonly label: string;
      readonly accessibilityLabel?: string;
      readonly icon?: ElectronTouchBarIconRef;
      readonly items: readonly ElectronTouchBarItemSpec[];
    };

/** Either one of macOS's own template images, or a glyph registered by the renderer. */
export type ElectronTouchBarIconRef =
  | { readonly source: "named"; readonly name: string }
  | { readonly source: "registered"; readonly key: string };

/** A property assignment onto an already-attached item. Unknown keys are ignored. */
export interface ElectronTouchBarItemUpdate {
  readonly key: string;
  readonly label?: string;
  readonly backgroundColor?: string;
  readonly textColor?: string;
  readonly enabled?: boolean;
}

const ElectronTouchBarOperation = Schema.Literals(["attach", "detach", "update", "register-icons"]);

export class ElectronTouchBarOperationError extends Schema.TaggedError<ElectronTouchBarOperationError>()(
  "ElectronTouchBarOperationError",
  {
    operation: ElectronTouchBarOperation,
    platform: Schema.String,
    windowId: Schema.NullOr(Schema.Number),
    itemCount: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const window = this.windowId === null ? "" : ` for window ${this.windowId}`;
    return `Electron Touch Bar operation ${JSON.stringify(this.operation)} failed${window} with ${this.itemCount} items on ${this.platform}.`;
  }
}

export class ElectronTouchBar extends Context.Service<
  ElectronTouchBar,
  {
    /**
     * Decode PNG bytes into retina glyphs the specs can then refer to by key.
     * Registering the same key again replaces it.
     */
    readonly registerIcons: (
      icons: readonly { readonly key: string; readonly bytes: Uint8Array }[],
    ) => Effect.Effect<ElectronTouchBarIconReport>;
    /**
     * Build the strip and put it on the window, replacing whatever was there.
     * A null spec list detaches the Touch Bar and forgets every item key.
     */
    readonly attach: (
      window: Electron.BrowserWindow,
      items: readonly ElectronTouchBarItemSpec[] | null,
      escapeItem?: ElectronTouchBarItemSpec,
    ) => Effect.Effect<void>;
    /** Assign onto attached items in place. Cheap: no bar is rebuilt. */
    readonly update: (updates: readonly ElectronTouchBarItemUpdate[]) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/electron/ElectronTouchBar") {}

/** What actually decoded, so a silent artwork failure cannot stay silent. */
export interface ElectronTouchBarIconReport {
  readonly registered: readonly string[];
  /** Keys whose bytes macOS refused to decode into an image. */
  readonly rejected: readonly string[];
}

type NativeItem =
  | Electron.TouchBarButton
  | Electron.TouchBarLabel
  | Electron.TouchBarPopover
  | Electron.TouchBarScrubber;

/**
 * The Touch Bar is a 2x display about 30pt tall, so glyphs arrive as 36x36 px
 * and are declared at half that in points.
 */
const ICON_SCALE_FACTOR = 2;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  // Native items outlive each `attach`, so `update` can assign onto them
  // without rebuilding anything. Cleared whenever the bar is rebuilt.
  const itemsByKey = new Map<string, NativeItem>();
  const registeredIcons = new Map<string, Electron.NativeImage>();
  // macOS returns an empty image for a name it does not know, and the set of
  // NSTouchBar template names is not something the type system can check, so
  // each lookup is memoized alongside whether it actually produced anything.
  const namedIcons = new Map<string, Electron.NativeImage | null>();

  const namedIcon = (name: string): Electron.NativeImage | null => {
    const cached = namedIcons.get(name);
    if (cached !== undefined) return cached;
    let resolved: Electron.NativeImage | null = null;
    try {
      const image = Electron.nativeImage.createFromNamedImage(name);
      resolved = image.isEmpty() ? null : image;
    } catch {
      resolved = null;
    }
    namedIcons.set(name, resolved);
    return resolved;
  };

  const resolveIcon = (icon: ElectronTouchBarIconRef | undefined): Electron.NativeImage | null => {
    if (icon === undefined) return null;
    if (icon.source === "named") return namedIcon(icon.name);
    return registeredIcons.get(icon.key) ?? null;
  };

  const buildItem = (
    spec: ElectronTouchBarItemSpec,
  ):
    | Electron.TouchBarButton
    | Electron.TouchBarLabel
    | Electron.TouchBarPopover
    | Electron.TouchBarScrubber
    | Electron.TouchBarSpacer => {
    switch (spec.kind) {
      case "button": {
        const icon = resolveIcon(spec.icon);
        const button = new Electron.TouchBar.TouchBarButton({
          // A glyph replaces the words unless the spec asks to keep both, and
          // a glyph that never arrived always leaves the words, so a missing
          // image degrades to a readable button rather than a blank one.
          label: icon === null || spec.keepLabel === true ? spec.label : "",
          accessibilityLabel: spec.accessibilityLabel ?? spec.label,
          ...(icon === null ? {} : { icon, iconPosition: "left" as const }),
          ...(spec.backgroundColor === undefined ? {} : { backgroundColor: spec.backgroundColor }),
          enabled: spec.enabled ?? true,
          click: spec.onClick,
        });
        itemsByKey.set(spec.key, button);
        return button;
      }
      case "label": {
        const label = new Electron.TouchBar.TouchBarLabel({
          label: spec.label,
          ...(spec.accessibilityLabel === undefined
            ? {}
            : { accessibilityLabel: spec.accessibilityLabel }),
          ...(spec.textColor === undefined ? {} : { textColor: spec.textColor }),
        });
        itemsByKey.set(spec.key, label);
        return label;
      }
      case "spacer":
        return new Electron.TouchBar.TouchBarSpacer({ size: spec.size });
      case "scrubber": {
        const scrubber = new Electron.TouchBar.TouchBarScrubber({
          items: spec.items.map((item) => {
            const icon = resolveIcon(item.icon);
            // Same rule as a popover: an image that already draws the text
            // must not have the text printed beside it.
            return icon === null ? { label: item.label } : { icon };
          }),
          select: spec.onSelect,
          mode: "free",
          showArrowButtons: true,
          selectedStyle: "outline",
          continuous: false,
        });
        return scrubber;
      }
      case "popover": {
        // A popover's items are fixed at construction, which is why a changed
        // provider list rebuilds the whole bar rather than updating in place.
        const icon = resolveIcon(spec.icon);
        const popover = new Electron.TouchBar.TouchBarPopover({
          // A popover shows its image AND its label side by side, so an image
          // that already draws the text would print it twice. The label is
          // only ever the fallback for a missing image.
          label: icon === null ? spec.label : "",
          ...(icon === null ? {} : { icon }),
          items: new Electron.TouchBar({ items: spec.items.map(buildItem) }),
        });
        itemsByKey.set(spec.key, popover);
        return popover;
      }
    }
  };

  return ElectronTouchBar.of({
    registerIcons: (icons) =>
      Effect.try({
        try: (): ElectronTouchBarIconReport => {
          const registered: string[] = [];
          const rejected: string[] = [];
          for (const { key, bytes } of icons) {
            const image = Electron.nativeImage.createFromBuffer(Buffer.from(bytes), {
              scaleFactor: ICON_SCALE_FACTOR,
            });
            if (image.isEmpty()) {
              rejected.push(key);
              continue;
            }
            // Deliberately not a template image: macOS flattens those to one
            // tint, which would wipe out the brand colours and the quota bars.
            // The strip is always dark, so the artwork ships its final colours.
            registeredIcons.set(key, image);
            registered.push(key);
          }
          return { registered, rejected };
        },
        catch: (cause) =>
          new ElectronTouchBarOperationError({
            operation: "register-icons",
            platform,
            windowId: null,
            itemCount: icons.length,
            cause,
          }),
      }).pipe(Effect.orDie),
    attach: (window, items, escapeItem) =>
      Effect.try({
        try: () => {
          itemsByKey.clear();
          if (items === null) {
            window.setTouchBar(null);
            return;
          }
          const bar = new Electron.TouchBar({ items: items.map(buildItem) });
          if (escapeItem !== undefined) {
            // Assigned as well as passed: the constructor form does not take on
            // every macOS build, and the property assignment always does.
            const built = buildItem(escapeItem);
            if (!(built instanceof Electron.TouchBar.TouchBarSpacer)) bar.escapeItem = built;
          }
          window.setTouchBar(bar);
        },
        catch: (cause) =>
          new ElectronTouchBarOperationError({
            operation: items === null ? "detach" : "attach",
            platform,
            windowId: window.id,
            itemCount: items?.length ?? 0,
            cause,
          }),
      }).pipe(Effect.orDie),
    update: (updates) =>
      updates.length === 0
        ? Effect.void
        : Effect.try({
            try: () => {
              for (const update of updates) {
                const item = itemsByKey.get(update.key);
                if (item === undefined) continue;
                // A scrubber has no label of its own; its items carry theirs.
                if (update.label !== undefined && "label" in item) item.label = update.label;
                if (update.backgroundColor !== undefined && "backgroundColor" in item) {
                  item.backgroundColor = update.backgroundColor;
                }
                if (update.textColor !== undefined && "textColor" in item) {
                  item.textColor = update.textColor;
                }
                if (update.enabled !== undefined && "enabled" in item) {
                  item.enabled = update.enabled;
                }
              }
            },
            catch: (cause) =>
              new ElectronTouchBarOperationError({
                operation: "update",
                platform,
                windowId: null,
                itemCount: updates.length,
                cause,
              }),
          }).pipe(Effect.orDie),
  });
});

export const layer = Layer.effect(ElectronTouchBar, make);
