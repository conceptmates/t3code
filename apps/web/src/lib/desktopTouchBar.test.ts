import type { DesktopTouchBarState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createTouchBarSender, type TouchBarBridge } from "./desktopTouchBar";

const state = (label: string): DesktopTouchBarState => ({
  providers: [],
  rightPanelOpen: null,
  terminalOpen: null,
  projects: [],
  projectFilter: [],
  run: { label, state: "idle" },
});

/** A bridge plus a hand-cranked clock and timer queue, so nothing waits. */
function harness(minIntervalMs = 1_000) {
  const sent: (DesktopTouchBarState | null)[] = [];
  const timers = new Map<number, { readonly run: () => void; readonly at: number }>();
  let nextTimerId = 1;
  let clock = 0;

  const bridge: TouchBarBridge = {
    setIcons: () => Promise.resolve(),
    setState: (next) => {
      sent.push(next);
      return Promise.resolve();
    },
    onAction: () => () => {},
  };

  const sender = createTouchBarSender(bridge, {
    minIntervalMs,
    now: () => clock,
    setTimeout: ((run: () => void, delay: number) => {
      const id = nextTimerId++;
      timers.set(id, { run, at: clock + delay });
      return id;
    }) as unknown as typeof globalThis.setTimeout,
    clearTimeout: ((id: number) => {
      timers.delete(id);
    }) as unknown as typeof globalThis.clearTimeout,
  });

  return {
    sent,
    sender,
    advance: (ms: number) => {
      clock += ms;
      // Snapshot first: running a timer may schedule or clear another.
      for (const [id, timer] of Array.from(timers)) {
        if (timer.at <= clock) {
          timers.delete(id);
          timer.run();
        }
      }
    },
    pendingTimers: () => timers.size,
  };
}

describe("createTouchBarSender", () => {
  it("sends the first strip immediately", () => {
    const { sender, sent } = harness();
    sender.send(state("Run dev"));
    expect(sent).toEqual([state("Run dev")]);
  });

  it("drops a repeat of the strip already on screen", () => {
    const { sender, sent, advance } = harness();
    sender.send(state("Run dev"));
    advance(5_000);
    sender.send(state("Run dev"));
    expect(sent).toHaveLength(1);
  });

  it("holds a change back until the interval has passed, then sends the newest", () => {
    const { sender, sent, advance } = harness();
    sender.send(state("Run dev"));
    sender.send(state("Run build"));
    sender.send(state("Run test"));
    expect(sent).toHaveLength(1);
    advance(1_000);
    expect(sent).toEqual([state("Run dev"), state("Run test")]);
  });

  it("sends straight away once the strip has been quiet longer than the interval", () => {
    const { sender, sent, advance } = harness();
    sender.send(state("Run dev"));
    advance(2_000);
    sender.send(state("Run build"));
    expect(sent).toHaveLength(2);
  });

  it("detaching is a change like any other", () => {
    const { sender, sent, advance } = harness();
    sender.send(state("Run dev"));
    advance(2_000);
    sender.send(null);
    expect(sent).toEqual([state("Run dev"), null]);
  });

  it("resends the last strip on flush, so new artwork gets picked up", () => {
    const { sender, sent, advance } = harness();
    sender.send(state("Run dev"));
    advance(2_000);
    sender.flush();
    expect(sent).toEqual([state("Run dev"), state("Run dev")]);
  });

  it("flushing before anything was sent does nothing", () => {
    const { sender, sent } = harness();
    sender.flush();
    expect(sent).toEqual([]);
  });

  it("forgets queued work and refuses further sends after dispose", () => {
    const { sender, sent, advance, pendingTimers } = harness();
    sender.send(state("Run dev"));
    sender.send(state("Run build"));
    sender.dispose();
    expect(pendingTimers()).toBe(0);
    advance(5_000);
    sender.send(state("Run test"));
    expect(sent).toEqual([state("Run dev")]);
  });
});
