import type { DesktopBridge, DesktopTouchBarState } from "@t3tools/contracts";

import { sameTouchBarState } from "./touchBarStrip";

export type TouchBarBridge = NonNullable<DesktopBridge["touchBar"]>;

/**
 * Countdowns move by the minute and percentages far more slowly, so one send a
 * second is already more than the strip can show. Anything faster is the chat
 * view re-rendering, not the Touch Bar changing.
 */
const MIN_SEND_INTERVAL_MS = 1_000;

export interface TouchBarSender {
  /** Queue a strip. Identical consecutive states never reach the main process. */
  readonly send: (state: DesktopTouchBarState | null) => void;
  /**
   * Resend the last strip even though nothing in it changed. Registering new
   * artwork drops whatever the main process had built, so the strip has to go
   * back out for the new images to appear.
   */
  readonly flush: () => void;
  readonly dispose: () => void;
}

/**
 * Push strips to the desktop shell, dropping no-ops and rate-limiting the rest.
 * Takes the bridge as an argument so it can be driven by a fake in tests.
 */
export function createTouchBarSender(
  bridge: TouchBarBridge,
  options: {
    readonly minIntervalMs?: number;
    readonly now?: () => number;
    readonly setTimeout?: typeof globalThis.setTimeout;
    readonly clearTimeout?: typeof globalThis.clearTimeout;
  } = {},
): TouchBarSender {
  const minIntervalMs = options.minIntervalMs ?? MIN_SEND_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const unschedule = options.clearTimeout ?? globalThis.clearTimeout;

  let lastSent: DesktopTouchBarState | null = null;
  let hasSent = false;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: { state: DesktopTouchBarState | null } | null = null;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let disposed = false;

  const flush = (state: DesktopTouchBarState | null) => {
    lastSent = state;
    hasSent = true;
    lastSentAt = now();
    void bridge.setState(state);
  };

  const send = (state: DesktopTouchBarState | null) => {
    if (disposed) return;
    if (hasSent && sameTouchBarState(lastSent, state)) return;
    const wait = minIntervalMs - (now() - lastSentAt);
    if (wait <= 0) {
      if (timer !== null) {
        unschedule(timer);
        timer = null;
        pending = null;
      }
      flush(state);
      return;
    }
    pending = { state };
    if (timer !== null) return;
    timer = schedule(() => {
      timer = null;
      const queued = pending;
      pending = null;
      if (disposed || queued === null) return;
      flush(queued.state);
    }, wait);
  };

  return {
    send,
    flush: () => {
      if (disposed || !hasSent) return;
      flush(lastSent);
    },
    dispose: () => {
      disposed = true;
      if (timer !== null) {
        unschedule(timer);
        timer = null;
      }
      pending = null;
    },
  };
}

/** The Touch Bar bridge, or undefined on web and on desktop builds without it. */
export function touchBarBridge(): TouchBarBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.desktopBridge?.touchBar;
}
