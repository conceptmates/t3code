import type { DesktopTouchBarState } from "@t3tools/contracts";
import { create } from "zustand";

/**
 * The part of the Touch Bar strip that only a mounted chat view can supply.
 *
 * The strip itself is driven app-wide, so it keeps working on the project
 * picker and in settings. Run and the provider selection are the exception:
 * they need a thread, so the chat view publishes them here while it is mounted
 * and clears them on the way out, and the strip simply omits what is absent.
 */
export interface TouchBarThreadSlice {
  readonly run: DesktopTouchBarState["run"];
  readonly selectedInstanceId: string | null;
  /** Null outside a thread, where these drawers do not exist. */
  readonly terminalOpen: boolean | null;
  readonly rightPanelOpen: boolean | null;
  readonly onRunToggle: (() => void) | null;
  readonly onSelectProvider: ((instanceId: string) => void) | null;
  readonly onToggleTerminal: (() => void) | null;
  readonly onToggleRightPanel: (() => void) | null;
}

const EMPTY_SLICE: TouchBarThreadSlice = {
  run: null,
  selectedInstanceId: null,
  terminalOpen: null,
  rightPanelOpen: null,
  onRunToggle: null,
  onSelectProvider: null,
  onToggleTerminal: null,
  onToggleRightPanel: null,
};

interface TouchBarThreadStore extends TouchBarThreadSlice {
  readonly publish: (slice: TouchBarThreadSlice) => void;
  readonly clear: () => void;
}

export const useTouchBarThreadStore = create<TouchBarThreadStore>()((set) => ({
  ...EMPTY_SLICE,
  publish: (slice) => {
    set((current) =>
      // The chat view republishes on every render it survives, so an unchanged
      // slice must not produce a new object: the strip's own equality check is
      // downstream of this one.
      current.run?.label === slice.run?.label &&
      current.run?.state === slice.run?.state &&
      current.selectedInstanceId === slice.selectedInstanceId &&
      current.terminalOpen === slice.terminalOpen &&
      current.rightPanelOpen === slice.rightPanelOpen &&
      current.onRunToggle === slice.onRunToggle &&
      current.onSelectProvider === slice.onSelectProvider &&
      current.onToggleTerminal === slice.onToggleTerminal &&
      current.onToggleRightPanel === slice.onToggleRightPanel
        ? current
        : slice,
    );
  },
  clear: () => {
    set((current) =>
      current.run === null && current.selectedInstanceId === null ? current : EMPTY_SLICE,
    );
  },
}));

export const emptyTouchBarThreadSlice = (): TouchBarThreadSlice => EMPTY_SLICE;
