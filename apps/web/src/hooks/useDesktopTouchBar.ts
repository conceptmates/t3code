import type { DesktopTouchBarAction } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { createTouchBarSender, touchBarBridge } from "../lib/desktopTouchBar";
import { rasterizeSvg, renderActionGlyphs } from "../lib/touchBarArtwork";
import { buildTouchBarState, type TouchBarStripInput } from "../lib/touchBarStrip";

const MINUTE = 60_000;

/**
 * Artwork that never arrives leaves every Touch Bar button on its text
 * fallback, which reads as a design choice rather than a failure. The fallback
 * is deliberate; failing silently on the way to it is not.
 */
function reportArtworkFailure(
  what: string,
  drawn: number,
  expected: number,
  cause?: unknown,
): void {
  console.error(
    `[touch-bar] ${what}: ${drawn}/${expected} images reached the strip; falling back to text.`,
    cause ?? "",
  );
}

export interface DesktopTouchBarHandlers {
  readonly onSelectProvider: (instanceId: string) => void;
  /** Jump to a project's most recent thread, or start one if it has none. */
  readonly onOpenProject: (key: string) => void;
  /** Scope the thread sidebar; `all` clears the filter. */
  readonly onFilterProject: (key: string) => void;
  readonly onToggleRightPanel: () => void;
  readonly onToggleTerminal: () => void;
  readonly onNewProject: () => void;
  readonly onNewThread: () => void;
  /** Start the primary launch config, or stop the running one. */
  readonly onRunToggle: () => void;
}

/**
 * Mirror the chat view onto the macOS Touch Bar and route taps back into the
 * same callbacks the on-screen controls use.
 *
 * No-op everywhere but a desktop shell that offers the bridge, which means web,
 * mobile, Windows, Linux, and any desktop build older than the feature.
 */
export function useDesktopTouchBar(
  enabled: boolean,
  input: Omit<TouchBarStripInput, "now">,
  /**
   * Every image the strip needs, keyed as the main process expects. The caller
   * decides what to draw; this hook only gets it across and keeps it deduped.
   */
  artwork: readonly { readonly key: string; readonly svg: string }[],
  handlers: DesktopTouchBarHandlers,
): void {
  // Taps arrive from the main process long after render, so the subscription
  // reads the callbacks through a ref rather than resubscribing on every one.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const bridge = touchBarBridge();
  const [now, setNow] = useState(() => Date.now());

  // Quota countdowns are shown to the minute, so that is how often the strip
  // needs rebuilding when nothing else has moved.
  useEffect(() => {
    if (bridge === undefined || !enabled) return;
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, [bridge, enabled]);

  useEffect(() => {
    if (bridge === undefined) return;
    return bridge.onAction((action: DesktopTouchBarAction) => {
      const current = handlersRef.current;
      switch (action.kind) {
        case "select-provider":
          current.onSelectProvider(action.instanceId);
          return;
        case "open-project":
          current.onOpenProject(action.key);
          return;
        case "filter-project":
          current.onFilterProject(action.key);
          return;
        case "toggle-right-panel":
          current.onToggleRightPanel();
          return;
        case "toggle-terminal":
          current.onToggleTerminal();
          return;
        case "new-project":
          current.onNewProject();
          return;
        case "new-thread":
          current.onNewThread();
          return;
        case "run-toggle":
          current.onRunToggle();
          return;
      }
    });
  }, [bridge]);

  const senderRef = useRef<ReturnType<typeof createTouchBarSender> | null>(null);
  useEffect(() => {
    if (bridge === undefined) return;
    const sender = createTouchBarSender(bridge);
    senderRef.current = sender;
    return () => {
      senderRef.current = null;
      // Leave the strip detached rather than stale once the view unmounts.
      void bridge.setState(null);
      sender.dispose();
    };
  }, [bridge]);

  // `input` is expected to be memoized by the caller, so a chat view re-render
  // that changed nothing the strip shows costs one reference comparison.
  const state = useMemo(
    () => (bridge === undefined || !enabled ? null : buildTouchBarState({ ...input, now })),
    [bridge, enabled, input, now],
  );

  // The run, stop, interrupt and Run & Debug glyphs never change, so they are
  // drawn once when the bridge appears rather than alongside the quota art.
  useEffect(() => {
    if (bridge === undefined) return;
    let cancelled = false;
    void (async () => {
      const glyphs = await renderActionGlyphs();
      if (cancelled || glyphs.length === 0) {
        reportArtworkFailure("action glyphs", glyphs.length, 4);
        return;
      }
      try {
        await bridge.setIcons(glyphs);
      } catch (cause) {
        reportArtworkFailure("action glyphs", 0, glyphs.length, cause);
        return;
      }
      senderRef.current?.flush();
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const drawnRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (bridge === undefined) return;
    const changed = artwork.filter((row) => drawnRef.current[row.key] !== row.svg);
    if (changed.length === 0) return;
    let cancelled = false;
    void (async () => {
      const drawn: { key: string; bytes: Uint8Array }[] = [];
      for (const row of changed) {
        const bytes = await rasterizeSvg(row.svg);
        if (bytes !== null) drawn.push({ key: row.key, bytes });
      }
      if (cancelled) return;
      if (drawn.length === 0) {
        reportArtworkFailure("provider artwork", 0, changed.length);
        return;
      }
      for (const row of changed) drawnRef.current[row.key] = row.svg;
      try {
        await bridge.setIcons(drawn);
      } catch (cause) {
        reportArtworkFailure("provider artwork", 0, drawn.length, cause);
        return;
      }
      // Artwork is baked into the native items, so the strip has to go out
      // again after it lands or the new bars never appear.
      senderRef.current?.flush();
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, artwork]);

  useEffect(() => {
    senderRef.current?.send(state);
  }, [state]);
}
